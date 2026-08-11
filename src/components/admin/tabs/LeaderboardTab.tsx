import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trophy, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface LeaderboardEntry {
  user_id: string;
  full_name: string | null;
  email: string | null;
  xp_total: number;
  funding_readiness_score: number;
  composite_score: number;
}

const LeaderboardTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [entries, setEntries] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [season, setSeason] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const { toast } = useToast();
  const { user: adminUser } = useAuth();

  const fetchData = async () => {
    try {
      const { data: seasonData } = await supabase
        .from("challenge_seasons")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      setSeason(seasonData || null);

      const { data } = await supabase.rpc("get_tutor_leaderboard");
      setEntries((data || []) as LeaderboardEntry[]);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleClearLeaderboard = async () => {
    try {
      if (!adminUser) {
        toast({ title: "Error", description: "Admin session not found", variant: "destructive" });
        return;
      }
      setClearing(true);
      const { data, error } = await supabase.rpc("clear_leaderboard", { p_admin_id: adminUser.id });
      if (error) throw error;

      const result = (data ?? {}) as { success?: boolean; name?: string };
      if (!result.success) throw new Error("Failed to clear leaderboard");

      toast({
        title: "New Challenge Started",
        description: `${result.name || "Challenge"} is now live. Previous scores were archived.`,
      });
      setConfirmClear(false);
      fetchData();
    } catch (error) {
      console.error("Error clearing leaderboard:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to clear leaderboard",
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              AI Challenger Leaderboard
            </CardTitle>
            <CardDescription>
              Ranked by funding readiness score (heavier) + AI Tutor XP (lighter)
            </CardDescription>
            {season && (
              <p className="text-sm text-muted-foreground mt-2">
                Current challenge: <Badge variant="secondary">{season.name}</Badge>{" "}
                <span className="text-xs">
                  started {new Date(season.started_at).toLocaleDateString()}
                </span>
              </p>
            )}
          </div>
          <Button
            variant="destructive"
            onClick={() => setConfirmClear(true)}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Start New Challenge
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Funding Score</TableHead>
                    <TableHead>AI Tutor XP</TableHead>
                    <TableHead>Composite</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-24">
                        No performers yet for this challenge.
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((entry, index) => (
                      <TableRow key={entry.user_id}>
                        <TableCell className="font-bold">#{index + 1}</TableCell>
                        <TableCell>
                          <p className="font-medium">{entry.full_name || "Anonymous"}</p>
                          <p className="text-xs text-muted-foreground">{entry.email}</p>
                        </TableCell>
                        <TableCell>{entry.funding_readiness_score}/100</TableCell>
                        <TableCell>{entry.xp_total.toLocaleString()}</TableCell>
                        <TableCell className="font-bold">{entry.composite_score.toLocaleString()} pts</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a New Challenge?</DialogTitle>
            <DialogDescription>
              This will archive the current standings and start a fresh, empty leaderboard.
              Users' previous scores stay on their personal dashboards and their XP and
              business plan scores are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearLeaderboard}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Yes, Start New Challenge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeaderboardTab;
