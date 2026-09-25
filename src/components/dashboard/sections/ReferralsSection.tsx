import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, Check, Users, MousePointer, UserCheck, Crown, Link2, UserPlus,
  MessageCircle, Twitter, Facebook, RefreshCw, AlertCircle,
} from "lucide-react";
import { isActiveSubscriber, isPremiumTier } from "@/lib/subscription";
import { buildReferralLink, callReferralRpc, normalizeReferralCode } from "@/lib/referral";

export function ReferralsSection() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stats, setStats] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [followers, setFollowers] = useState<any[]>([]);
  const [earningsBreakdown, setEarningsBreakdown] = useState({
    first_time: 0,
    recurring: 0,
    indirect: 0,
  });
  const [hasAmbassador, setHasAmbassador] = useState(false);
  const [followerEarnings, setFollowerEarnings] = useState<Record<string, number>>({});
  const [followerCount, setFollowerCount] = useState(0);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const referralCode = normalizeReferralCode(profile?.referral_code);
  const referralLink = buildReferralLink(referralCode);

  const copyText = useCallback(
    async (text: string, label: string, which: "link" | "code") => {
      if (!text) {
        toast({ title: "Nothing to copy", description: "Your referral code is missing.", variant: "destructive" });
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API needs a secure context; fall back to a temporary input.
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(which);
      toast({ title: "Copied!", description: `${label} copied to clipboard` });
      setTimeout(() => setCopied(null), 2000);
    },
    [toast],
  );

  const copyLink = () => copyText(referralLink, "Referral link", "link");
  const copyCode = () => copyText(referralCode, "Referral code", "code");

  const shareUrl = (channel: "whatsapp" | "x" | "facebook") => {
    const text = "Join me on Investours — the AI Financial Auditor that shows you where your money is leaking.";
    const urls = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${referralLink}`)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(referralLink)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`,
    };
    window.open(urls[channel], "_blank", "noopener,noreferrer,width=600,height=500");
  };

  /** Only needed if a profile predates referral codes. */
  const regenerateCode = async () => {
    setRegenerating(true);
    try {
      const res = await callReferralRpc("regenerate_referral_code", {});
      if (res.error) throw new Error("The server could not create a code.");
      const code = normalizeReferralCode(res.data as string | null);
      if (!code) throw new Error("No code was returned. Please contact support.");
      await refreshProfile();
      toast({
        title: "Referral code ready",
        description: `Your new code is ${code}. Share it with your link.`,
      });
    } catch (err) {
      toast({
        title: "Could not create a code",
        description:
          err instanceof Error ? err.message : "Please contact support and we'll fix it.",
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
    }
  };

  const fetchFollowers = async (userId: string) => {
    // Exact count is fetched separately: a limit() on the list query would cap
    // "People Referred" at 10 and make the dashboard look out of date.
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", userId);
    setFollowerCount(count ?? 0);

    const { data: followersData } = await supabase
      .from("profiles")
      .select("id, full_name, user_tier, created_at, has_active_subscription, subscription_expires_at, audit_credits, audit_credits_expires_at")
      .eq("referred_by", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    setFollowers(followersData || []);
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      // Fetch referral stats
      const { data: statsData } = await supabase
        .from("referral_stats")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      setStats(statsData);

      // Fetch referred users (now called followers) with subscription/credit fields
      await fetchFollowers(user.id);

      // Fetch earnings breakdown from commissions (first_time / recurring / indirect)
      const { data: ambassador } = await supabase
        .from("ambassadors")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (ambassador) {
        setHasAmbassador(true);
        const { data: commissions } = await supabase
          .from("commissions")
          .select("commission_type, amount")
          .eq("ambassador_id", ambassador.id);

        const breakdown = { first_time: 0, recurring: 0, indirect: 0 };
        (commissions || []).forEach((c: { commission_type: string; amount: number }) => {
          if (c.commission_type === "first_time") breakdown.first_time += Number(c.amount) || 0;
          else if (c.commission_type === "recurring") breakdown.recurring += Number(c.amount) || 0;
          else if (c.commission_type === "indirect") breakdown.indirect += Number(c.amount) || 0;
        });
        setEarningsBreakdown(breakdown);

        // Per-follower earnings: total commission earned from each referred user
        const { data: perFollowerRows } = await supabase
          .from("commissions")
          .select("amount, referrals(referred_user_id)")
          .eq("ambassador_id", ambassador.id);

        const perFollower: Record<string, number> = {};
        (perFollowerRows as Array<{ amount: number; referrals: { referred_user_id: string } | null }> | null)?.forEach((c) => {
          const uid = c.referrals?.referred_user_id;
          if (uid) perFollower[uid] = (perFollower[uid] || 0) + (Number(c.amount) || 0);
        });
        setFollowerEarnings(perFollower);
      } else {
        setHasAmbassador(false);
      }
    };

    fetchData();
  }, [user]);

  // Live refresh: when a new follower signs up (or a profile changes), refetch
  // so the dashboard reflects new referrals without a manual reload.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`followers-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => fetchFollowers(user.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const referredCount = followerCount;

  const totalEarnings = hasAmbassador
    ? earningsBreakdown.first_time + earningsBreakdown.recurring + earningsBreakdown.indirect
    : (stats?.total_earnings || 0);

  const now = Date.now();
  const activeSubscribers = followers.filter((f) =>
    isActiveSubscriber(f) || isPremiumTier(f),
  ).length;

  const activeAuditUsers = followers.filter((f) =>
    (f.audit_credits ?? 0) > 0 &&
    (!f.audit_credits_expires_at || new Date(f.audit_credits_expires_at).getTime() > now),
  ).length;

  const statCards = [
    { label: "People Referred", value: referredCount, icon: UserPlus },
    { label: "Total Clicks", value: stats?.total_clicks || 0, icon: MousePointer },
    { label: "Active Subscribers", value: activeSubscribers, icon: Crown },
    { label: "Audit Credit Users", value: activeAuditUsers, icon: UserCheck },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Referral Link — always visible so it can be copied in one tap */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
          <Card className="bg-gradient-to-r from-primary/5 to-accent/5">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-1">Share Your Referral Link</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Share your referral link or code to earn followers and 30% commission automatically.
                  </p>

                  {referralCode ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 bg-background/80 rounded-lg px-4 py-2 text-sm font-mono truncate">
                          {referralLink}
                        </div>
                        <Button
                          onClick={copyLink}
                          variant="outline"
                          size="icon"
                          title="Copy referral link"
                        >
                          {copied === "link" ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground mr-1">Your code:</span>
                        <Badge variant="secondary" className="font-mono">{referralCode}</Badge>
                        <Button onClick={copyCode} variant="outline" size="sm" className="gap-2">
                          {copied === "code" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copied === "code" ? "Copied" : "Copy Code"}
                        </Button>
                        <span className="text-muted-foreground mx-1" aria-hidden>·</span>
                        <Button
                          onClick={() => shareUrl("whatsapp")}
                          variant="outline"
                          size="icon"
                          title="Share on WhatsApp"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => shareUrl("x")}
                          variant="outline"
                          size="icon"
                          title="Share on X"
                        >
                          <Twitter className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => shareUrl("facebook")}
                          variant="outline"
                          size="icon"
                          title="Share on Facebook"
                        >
                          <Facebook className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="flex-1">
                        Your profile has no referral code yet, so links you share would not work.
                      </span>
                      <Button
                        onClick={regenerateCode}
                        variant="outline"
                        size="sm"
                        disabled={regenerating}
                        className="shrink-0"
                      >
                        {regenerating ? (
                          <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        Create Code
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card>
              <CardContent className="p-4 text-center">
                <stat.icon className="w-6 h-6 mx-auto mb-2 text-primary" />
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Earnings & Referrals */}
      <div className="grid md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Total Earnings</CardTitle>
              <CardDescription>From your referral network</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-4">
                <p className="text-4xl font-bold text-primary">
                  ₦{totalEarnings.toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Lifetime referral earnings
                </p>
              </div>
                  <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="font-semibold">30%</p>
                      <p className="text-muted-foreground">First-time</p>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="font-semibold">15%</p>
                      <p className="text-muted-foreground">Recurring</p>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="font-semibold">5%</p>
                      <p className="text-muted-foreground">Indirect</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                    <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/10">
                      <p className="font-semibold">₦{earningsBreakdown.first_time.toLocaleString()}</p>
                      <p className="text-muted-foreground">First-time earned</p>
                    </div>
                    <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/10">
                      <p className="font-semibold">₦{earningsBreakdown.recurring.toLocaleString()}</p>
                      <p className="text-muted-foreground">Recurring earned</p>
                    </div>
                    <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/10">
                      <p className="font-semibold">₦{earningsBreakdown.indirect.toLocaleString()}</p>
                      <p className="text-muted-foreground">Indirect earned</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-3 text-center">
                    Direct commissions on first-time purchases (30%) and repurchases/renewals (15%).
                    5% indirect bonus on purchases by your followers&apos; own referrals. Rates apply to
                    the actual price (VAT excluded).
                  </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Recent Followers</CardTitle>
              <CardDescription>Users who signed up through your shared content</CardDescription>
            </CardHeader>
            <CardContent>
              {followers.length > 0 ? (
                <div className="space-y-3">
                  {followers.map((follower) => (
                    <div key={follower.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          {follower.full_name?.charAt(0) || "U"}
                        </div>
                        <div>
                          <p className="font-medium">{follower.full_name || "User"}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(follower.created_at).toLocaleDateString()}
                          </p>
                          {(followerEarnings[follower.id] ?? 0) > 0 && (
                            <p className="text-xs font-semibold text-primary mt-0.5">
                              ₦{(followerEarnings[follower.id] ?? 0).toLocaleString()} earned
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant={
                        follower.user_tier === "exclusive" ? "default" :
                        follower.user_tier === "premium" ? "secondary" :
                        "outline"
                      }>
                        {follower.user_tier}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No followers yet</p>
                  <p className="text-sm">Share education videos to grow your network!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
