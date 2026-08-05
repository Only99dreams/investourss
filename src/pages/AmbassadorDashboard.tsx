import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Crown, Copy, Check, Users, BarChart3, Trophy, Share2, ExternalLink, Loader2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Footer } from "@/components/ui/Footer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  AMBASSADOR_TIERS, tierProgress, formatNaira,
} from "@/lib/ambassadorTiers";
import investoursLogo from "@/assets/investours-logo.png";

interface AmbassadorStats {
  ambassador_id: string;
  user_id: string;
  referral_code: string;
  tier: string;
  lifetime_earnings: number;
  is_active: boolean;
  full_name: string | null;
  email: string | null;
  active_businesses: number;
  active_individuals: number;
  monthly_commission: number;
}

interface AmbassadorLeaderboardEntry {
  rank: number;
  ambassador_id: string;
  user_id: string;
  full_name: string;
  email: string;
  referral_code: string;
  tier: string;
  total_earnings: number;
  active_businesses: number;
  active_individuals: number;
  monthly_commission: number;
}

const AmbassadorDashboard = () => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stats, setStats] = useState<AmbassadorStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<AmbassadorLeaderboardEntry[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?mode=login", { replace: true });
    }
  }, [user, authLoading, navigate]);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("ambassador_stats")
        .select("ambassador_id,user_id,referral_code,tier,total_earnings,lifetime_earnings,is_active,full_name,email,active_businesses,active_individuals,monthly_commission")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      setStats((data ?? null) as AmbassadorStats | null);
    } catch (err) {
      console.error("Failed to load ambassador stats:", err);
    } finally {
      setLoadingStats(false);
    }
  }, [user]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_ambassador_leaderboard");
      if (error) throw error;
      setLeaderboard((data as AmbassadorLeaderboardEntry[]) ?? []);
    } catch (err) {
      console.error("Failed to load ambassador leaderboard:", err);
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchLeaderboard();

    if (!user) return;

    const channel = supabase
      .channel("ambassador-dashboard-changes")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "commissions",
      }, () => { fetchStats(); fetchLeaderboard(); })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "referrals",
      }, () => { fetchStats(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchStats, fetchLeaderboard, user]);

  const referralLink = useMemo(() => {
    const code = stats?.referral_code ?? profile?.referral_code;
    return code ? `${window.location.origin}/signup?ref=${code}` : "";
  }, [stats, profile]);

  const copyReferralLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const isEligible =
    (profile?.has_active_subscription === true) || (profile?.audit_credits ?? 0) > 0;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={investoursLogo} alt="Investours" className="w-9 h-9" />
            <span className="text-lg font-bold text-foreground">Investours</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/ambassador" className="text-muted-foreground hover:text-foreground transition-colors">Program</Link>
            <Link to="/ambassador-dashboard" className="text-primary font-medium">Dashboard</Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 relative z-10 flex-1">
        {/* Not yet an ambassador */}
        {loadingStats ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !stats ? (
          <Card className="mb-8 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-primary" />
                Become a Financial Health Ambassador
              </CardTitle>
              <CardDescription>
                {isEligible
                  ? "You're eligible to join the FHA programme. Activate your status and start earning."
                  : "Maintain an active subscription or an audit credit pack to qualify for the ambassador program."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="hero" disabled={!isEligible}>
                <Link to="/ambassador">Apply Now</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardContent className="p-4 text-center">
                  <Users className="w-6 h-6 mx-auto mb-2 text-primary" />
                  <p className="text-3xl font-bold">{stats.active_businesses}</p>
                  <p className="text-xs text-muted-foreground">Active Businesses</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Users className="w-6 h-6 mx-auto mb-2 text-accent" />
                  <p className="text-3xl font-bold">{stats.active_individuals}</p>
                  <p className="text-xs text-muted-foreground">Active Individuals</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <BarChart3 className="w-6 h-6 mx-auto mb-2 text-primary" />
                  <p className="text-3xl font-bold">{formatNaira(stats.monthly_commission)}</p>
                  <p className="text-xs text-muted-foreground">Monthly Commission</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Crown className="w-6 h-6 mx-auto mb-2 text-yellow-400" />
                  <p className="text-3xl font-bold">{formatNaira(stats.lifetime_earnings)}</p>
                  <p className="text-xs text-muted-foreground">Lifetime Earnings</p>
                </CardContent>
              </Card>
            </div>

            {/* Tier Progress */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Tier Progress</span>
                  <Badge variant="default" className="text-base">
                    {stats.tier}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Combined portfolio: {stats.active_businesses * 2 + stats.active_individuals} pts
                  (Businesses ×2 + Individuals). Any combination qualifies.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TierProgressBar
                  businesses={stats.active_businesses}
                  individuals={stats.active_individuals}
                />
              </CardContent>
            </Card>

            {/* Referral Link */}
            <Card className="mb-8 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-primary" />
                  Your Referral Link
                </CardTitle>
                <CardDescription>
                  Share this link to earn 30% first-time and 15% recurring commissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {referralLink ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 bg-background/80 rounded-lg px-4 py-2 text-sm font-mono truncate border">
                      {referralLink}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={copyReferralLink}
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? "Copied" : "Copy Link"}
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={referralLink} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No referral code available. Ensure your profile is complete.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Leaderboard */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-primary" />
                  Ambassador Leaderboard
                </CardTitle>
                <CardDescription>
                  Ranked by monthly recurring commission generated
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingLeaderboard ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : leaderboard.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No ambassadors yet. Be the first to apply!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => {
                      const isCurrentUser = user?.id === entry.user_id;
                      const initials = (entry.full_name || "??")
                        .split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <motion.div
                          key={entry.ambassador_id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: entry.rank * 0.03 }}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-xl border transition-colors",
                            isCurrentUser
                              ? "bg-primary/5 border-primary/30"
                              : "bg-card border-border hover:border-muted-foreground/20",
                          )}
                        >
                          <div className="w-8 text-center font-bold text-sm text-muted-foreground">
                            #{entry.rank}
                          </div>
                          <Avatar className="w-10 h-10">
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {entry.full_name || "Anonymous"}
                              {isCurrentUser && " (You)"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {entry.active_businesses} businesses · {entry.active_individuals} individuals
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <Badge variant="outline" className="mb-1">{entry.tier}</Badge>
                            <p className="text-sm font-semibold">{formatNaira(entry.monthly_commission)}/mo</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
};

const TierProgressBar = ({ businesses, individuals }: { businesses: number; individuals: number }) => {
  const progress = tierProgress(businesses, individuals);
  const { currentTier, currentScore, nextTier, progress: pct, remaining, nextThreshold } = progress;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Badge variant="default" className="text-lg px-3 py-1">
            {currentTier.starIcon} {currentTier.name}
          </Badge>
          <p className="text-sm text-muted-foreground mt-1">
            {currentScore} / {nextThreshold ?? "—"} points
          </p>
        </div>
        <div className="text-right">
          {nextTier ? (
            <>
              <Badge variant="outline" className="text-lg">
                {nextTier.starIcon} {nextTier.name}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">
                {remaining} pts to go
              </p>
            </>
          ) : (
            <Badge variant="default" className="text-lg">🏆 Top Tier</Badge>
          )}
        </div>
      </div>

      <Progress value={pct} className="h-4" />

      <div className="grid grid-cols-5 gap-1 text-center">
        {AMBASSADOR_TIERS.map((tier) => {
          const isActive = currentTier.name === tier.name;
          return (
            <div key={tier.name} className="flex flex-col items-center">
              <Badge
                variant={isActive ? "default" : "outline"}
                className={cn("mb-1", isActive && "bg-primary text-primary-foreground")}
              >
                {tier.starIcon} {tier.name}
              </Badge>
              <p className="text-xs text-muted-foreground">{tier.threshold} pts</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AmbassadorDashboard;