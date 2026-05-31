import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Medal, Crown, Sparkles, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  user_id: string;
  xp_total: number;
  level: string;
  streak_days: number;
  badges: any;
  full_name: string | null;
  email: string | null;
}

const levelColors: Record<string, string> = {
  beginner: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  intermediate: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  advanced: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

export function LeaderboardSection() {
  const { user, profile } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"all" | "weekly" | "monthly">("all");

  const fetchLeaderboard = async () => {
    try {
      const { data, error } = await supabase.rpc("get_tutor_leaderboard");

      if (error) {
        console.error("Error fetching leaderboard:", error);
        return;
      }

      const typedData = (data || []) as LeaderboardEntry[];
      setEntries(typedData);

      const currentIndex = typedData.findIndex((e) => e.user_id === user?.id);
      setMyRank(currentIndex >= 0 ? currentIndex + 1 : null);
    } catch (err) {
      console.error("Leaderboard fetch failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();

    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tutor_user_levels",
        },
        () => fetchLeaderboard()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tutor_user_levels",
        },
        () => fetchLeaderboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-amber-400" />;
      case 2:
        return <Medal className="w-5 h-5 text-slate-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <Trophy className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getDisplayName = (entry: LeaderboardEntry) => {
    if (entry.full_name && entry.full_name.trim()) return entry.full_name.trim();
    if (entry.email) return entry.email.split("@")[0];
    return "Anonymous User";
  };

  const initials = (entry: LeaderboardEntry) => {
    const name = getDisplayName(entry);
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Financial Tutor Leaderboard</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Top learners ranked by XP earned across all lessons
          </p>
        </div>
        {profile && (
          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your XP</p>
                <p className="text-lg font-bold text-foreground">{profile.ai_tutor_used || 0} XP</p>
              </div>
              {myRank && myRank <= 100 && (
                <Badge variant="secondary" className="ml-2">
                  #{myRank}
                </Badge>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="all" value={timeframe} onValueChange={(v) => setTimeframe(v as "all" | "weekly" | "monthly")}>
        <TabsList>
          <TabsTrigger value="all">All Time</TabsTrigger>
          <TabsTrigger value="weekly">This Week</TabsTrigger>
          <TabsTrigger value="monthly">This Month</TabsTrigger>
        </TabsList>
        <TabsContent value={timeframe} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                Top Learners
              </CardTitle>
              <CardDescription>
                {timeframe === "all" && "All-time highest achievers"}
                {timeframe === "weekly" && "Top performers this week"}
                {timeframe === "monthly" && "Top performers this month"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : entries.length === 0 ? (
                <div className="text-center py-12">
                  <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">No learners yet. Be the first to complete a lesson!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map((entry, index) => {
                    const rank = index + 1;
                    const isCurrentUser = user?.id === entry.user_id;
                    const displayName = getDisplayName(entry);

                    return (
                      <motion.div
                        key={entry.user_id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-xl border transition-colors",
                          isCurrentUser
                            ? "bg-primary/5 border-primary/30"
                            : "bg-card border-border hover:border-muted-foreground/20"
                        )}
                      >
                        <div className="w-8 text-center font-bold text-sm text-muted-foreground">
                          {rank <= 3 ? getRankIcon(rank) : <span>#{rank}</span>}
                        </div>

                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          {entry.full_name ? (
                            <span className="text-xs font-bold text-muted-foreground">{initials(entry)}</span>
                          ) : (
                            <User className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className={cn("font-medium truncate", isCurrentUser && "text-primary")}>
                            {displayName}
                            {isCurrentUser && " (You)"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={cn("text-xs border-0", levelColors[entry.level] || "bg-muted text-muted-foreground")}>
                              {entry.level}
                            </Badge>
                            {entry.streak_days > 0 && (
                              <span className="text-xs text-muted-foreground">
                                🔥 {entry.streak_days}d
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-foreground">{entry.xp_total.toLocaleString()} XP</p>
                          {Array.isArray(entry.badges) && entry.badges.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {entry.badges.length} badge{entry.badges.length !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}