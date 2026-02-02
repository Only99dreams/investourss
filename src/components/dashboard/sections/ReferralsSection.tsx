import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Users, MousePointer, UserCheck, Crown, TrendingUp, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReferralsSection() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stats, setStats] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [followers, setFollowers] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [showReferralCode, setShowReferralCode] = useState(false);

  const referralLink = `${window.location.origin}/signup/individual?ref=${profile?.referral_code}`;

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

      // Fetch referred users (now called followers)
      const { data: followersData } = await supabase
        .from("profiles")
        .select("id, full_name, user_tier, created_at")
        .eq("referred_by", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      setFollowers(followersData || []);
    };

    fetchData();
  }, [user]);

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const statCards = [
    { label: "Total Clicks", value: stats?.total_clicks || 0, icon: MousePointer },
    { label: "Sign-ups", value: stats?.total_signups || 0, icon: Users },
    { label: "Verified Users", value: stats?.total_verified || 0, icon: UserCheck },
    { label: "Subscribed", value: stats?.total_subscribed || 0, icon: Crown },
    { label: "Investing", value: stats?.total_investing || 0, icon: TrendingUp },
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
                <h3 className="text-lg font-semibold mb-1">Share Education Videos</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Share free education videos to earn followers and commissions automatically.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-background/80 rounded-lg px-4 py-2 text-sm font-mono truncate">
                    {showReferralCode ? profile?.referral_code : "••••••••"}
                  </div>
                  <Button 
                    onClick={() => setShowReferralCode(!showReferralCode)} 
                    variant="outline"
                    size="icon"
                  >
                    {showReferralCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                  ₦{(stats?.total_earnings || 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Lifetime referral earnings
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="font-semibold">40%</p>
                  <p className="text-muted-foreground">Direct Earnings</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="font-semibold">5%</p>
                  <p className="text-muted-foreground">Indirect Earnings</p>
                </div>
              </div>
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
