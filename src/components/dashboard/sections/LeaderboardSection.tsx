import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Medal, Crown, Sparkles, Loader2, User, Users, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface TutorLeaderboardEntry {
  user_id: string;
  xp_total: number;
  level: string;
  streak_days: number;
  badges: unknown[];
  full_name: string | null;
  email: string | null;
  funding_readiness_score: number;
  composite_score: number;
}

interface ChallengeHistoryEntry {
  season_id: string;
  season_name: string;
  ended_at: string;
  rank: number;
  funding_readiness_score: number;
  xp_total: number;
  composite_score: number;
}

interface ReferralLeaderboardEntry {
  user_id: string;
  full_name: string | null;
  referral_count: number;
  total_earnings: number;
  rank: number;
}

const levelColors: Record<string, string> = {
  beginner: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  intermediate: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  advanced: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

function TutorLeaderboard({ entries }: { entries: TutorLeaderboardEntry[] }) {
  const { user } = useAuth();

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Crown className="w-5 h-5 text-amber-400" />;
      case 2: return <Medal className="w-5 h-5 text-slate-300" />;
      case 3: return <Medal className="w-5 h-5 text-amber-600" />;
      default: return <Trophy className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getDisplayName = (entry: TutorLeaderboardEntry) => {
    if (entry.full_name && entry.full_name.trim()) return entry.full_name.trim();
    if (entry.email) return entry.email.split("@")[0];
    return "Anonymous User";
  };

  const initials = (entry: TutorLeaderboardEntry) => {
    const name = getDisplayName(entry);
    return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          Top Performers
        </CardTitle>
        <CardDescription>
          Ranked by funding readiness score (heavier) + AI Tutor XP (lighter)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="text-center py-12">
            <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">No performers yet. Save a business plan or complete a lesson to join the challenge!</p>
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
                    isCurrentUser ? "bg-primary/5 border-primary/30" : "bg-card border-border hover:border-muted-foreground/20"
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
                      {displayName}{isCurrentUser && " (You)"}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className={cn("text-xs border-0", levelColors[entry.level] || "bg-muted text-muted-foreground")}>
                        {entry.level}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Funding {(entry.funding_readiness_score ?? 0)}/100</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{entry.xp_total.toLocaleString()} XP</span>
                      {entry.streak_days > 0 && (
                        <span className="text-xs text-muted-foreground">🔥 {entry.streak_days}d</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-foreground">{(entry.composite_score ?? 0).toLocaleString()} pts</p>
                    {Array.isArray(entry.badges) && entry.badges.length > 0 && (
                      <p className="text-xs text-muted-foreground">{entry.badges.length} badge{entry.badges.length !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PastChallenges({ history }: { history: ChallengeHistoryEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          Your Past Challenge Results
        </CardTitle>
        <CardDescription>Scores from challenges that have already ended</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">No past challenge results yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <div key={entry.season_id} className="flex items-center justify-between p-3 rounded-xl border bg-card">
                <div>
                  <p className="font-medium">{entry.season_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.ended_at ? new Date(entry.ended_at).toLocaleDateString() : "Ended"}
                    {" · "}Rank #{entry.rank}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{(entry.composite_score ?? 0).toLocaleString()} pts</p>
                  <p className="text-xs text-muted-foreground">Funding {entry.funding_readiness_score ?? 0}/100 · {entry.xp_total ?? 0} XP</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReferralLeaderboard() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ReferralLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLeaderboard = async () => {
    try {
      const { data, error } = await supabase.rpc("get_referral_leaderboard");
      if (error) {
        console.error("Error fetching referral leaderboard:", error);
        return;
      }
      setEntries((data || []) as ReferralLeaderboardEntry[]);
    } catch (err) {
      console.error("Referral leaderboard fetch failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const channel = supabase
      .channel("referral-leaderboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "referral_stats" }, () => fetchLeaderboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Top Followers
        </CardTitle>
        <CardDescription>Ranked by number of followers</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">No followers yet. Share your link to get started!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, index) => {
              const rank = index + 1;
              const isCurrentUser = user?.id === entry.user_id;
              const displayName = entry.full_name?.trim() || "Anonymous User";
              return (
                <motion.div
                  key={entry.user_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className={cn(
                    "flex items-center gap-4 p-3 rounded-xl border transition-colors",
                    isCurrentUser ? "bg-primary/5 border-primary/30" : "bg-card border-border hover:border-muted-foreground/20"
                  )}
                >
                  <div className="w-8 text-center font-bold text-sm text-muted-foreground">
                    {rank <= 3 ? (
                      rank === 1 ? <Crown className="w-5 h-5 text-amber-400 mx-auto" /> :
                      rank === 2 ? <Medal className="w-5 h-5 text-slate-300 mx-auto" /> :
                      <Medal className="w-5 h-5 text-amber-600 mx-auto" />
                    ) : <span>#{rank}</span>}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    {displayName !== "Anonymous User" ? (
                      <span className="text-xs font-bold text-muted-foreground">
                        {displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    ) : (
                      <User className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium truncate", isCurrentUser && "text-primary")}>
                      {displayName}{isCurrentUser && " (You)"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-foreground">{entry.referral_count} follower{entry.referral_count !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-muted-foreground">₦{entry.total_earnings.toLocaleString()} earned</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LeaderboardSection() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("tutor");
  const [entries, setEntries] = useState<TutorLeaderboardEntry[]>([]);
  const [history, setHistory] = useState<ChallengeHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLeaderboard = async () => {
    try {
      const { data, error } = await supabase.rpc("get_tutor_leaderboard");
      if (!error) {
        setEntries((data || []) as TutorLeaderboardEntry[]);
      }
    } catch (err) {
      console.error("Leaderboard fetch failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.rpc("get_challenge_history", { p_user_id: user.id });
      if (!error) {
        setHistory((data || []) as ChallengeHistoryEntry[]);
      }
    } catch (err) {
      console.error("Challenge history fetch failed:", err);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    fetchHistory();
    const channel = supabase
      .channel("ai-challenger-leaderboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "challenge_leaderboard" }, () => fetchLeaderboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const myEntry = user ? entries.find((e) => e.user_id === user.id) : undefined;
  const myRank = myEntry ? entries.findIndex((e) => e.user_id === user.id) + 1 : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">AI Challenger Leaderboard</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Top performers and followers compete for rewards
          </p>
        </div>
        {user && (
          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your Score</p>
                <p className="text-lg font-bold text-foreground">
                  {myEntry ? `${(myEntry.composite_score ?? 0).toLocaleString()} pts` : "0 pts"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {myRank ? `Current rank #${myRank}` : "Not ranked yet"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="tutor" className="flex-1">
            <Trophy className="w-4 h-4 mr-2" />
            AI Challengers
          </TabsTrigger>
          <TabsTrigger value="referral" className="flex-1">
            <Users className="w-4 h-4 mr-2" />
            Referral
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tutor" className="mt-4 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <TutorLeaderboard entries={entries} />
          )}
          <PastChallenges history={history} />
        </TabsContent>
        <TabsContent value="referral" className="mt-4">
          <ReferralLeaderboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
