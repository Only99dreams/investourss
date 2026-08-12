import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Users, MousePointer, UserCheck, Crown, TrendingUp, Eye, EyeOff, Link2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActiveSubscriber, isPremiumTier } from "@/lib/subscription";

export function ReferralsSection() {
  const { user, profile } = useAuth();
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
  const [copied, setCopied] = useState(false);
  const [showReferralCode, setShowReferralCode] = useState(false);

  const referralLink = `${window.location.origin}/signup?ref=${profile?.referral_code}`;

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
      const { data: followersData } = await supabase
        .from("profiles")
        .select("id, full_name, user_tier, created_at, has_active_subscription, subscription_expires_at, audit_credits, audit_credits_expires_at")
        .eq("referred_by", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      setFollowers(followersData || []);

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

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(profile?.referral_code || "");
    setCopied(true);
    toast({ title: "Copied!", description: "Referral code copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const referredCount = followers.length;

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
      {/* Referral Link - Hidden by default */}
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
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-background/80 rounded-lg px-4 py-2 text-sm font-mono truncate">
                        {showReferralCode ? referralLink : "••••••••"}
                      </div>
                      <Button 
                        onClick={() => setShowReferralCode(!showReferralCode)} 
                        variant="outline"
                        size="icon"
                      >
                        {showReferralCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                    {showReferralCode && (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={copyLink} variant="default" size="sm" className="gap-2">
                          {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                          {copied ? "Copied" : "Copy Link"}
                        </Button>
                        <Button onClick={copyCode} variant="outline" size="sm" className="gap-2">
                          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copied ? "Copied" : "Copy Code"}
                        </Button>
                      </div>
                    )}
                  </div>
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
                      <p className="font-semibold">2%</p>
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
                    2% indirect bonus on purchases by your followers&apos; own referrals. Rates apply to
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
