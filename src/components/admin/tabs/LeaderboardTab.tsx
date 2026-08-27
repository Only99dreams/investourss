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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trophy, RotateCcw, Users, CalendarRange } from "lucide-react";
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

interface ReferralEntry {
  user_id: string;
  full_name: string | null;
  email: string | null;
  referral_count: number;
  total_earnings: number;
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LeaderboardTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [entries, setEntries] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [referralEntries, setReferralEntries] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [season, setSeason] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savingWindow, setSavingWindow] = useState(false);
  const [windowStart, setWindowStart] = useState("");
  const [windowClose, setWindowClose] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newClose, setNewClose] = useState("");
  const { toast } = useToast();
  const { user: adminUser } = useAuth();

  const fetchData = async () => {
    try {
      const { data: seasonData } = await supabase
        .from("challenge_seasons")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seasonRow = (seasonData ?? null) as any;
      setSeason(seasonRow);
      setWindowStart(toLocalInput(seasonRow ? (seasonRow.starts_at ?? seasonRow.started_at) : null));
      setWindowClose(toLocalInput(seasonRow?.closes_at ?? null));

      const { data } = await supabase.rpc("get_tutor_leaderboard");
      setEntries((data || []) as LeaderboardEntry[]);

      const { data: referralData } = await supabase.rpc("get_referral_challenge_leaderboard");
      setReferralEntries((referralData || []) as ReferralEntry[]);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveWindow = async () => {
    try {
      if (!adminUser) {
        toast({ title: "Error", description: "Admin session not found", variant: "destructive" });
        return;
      }
      setSavingWindow(true);
      const { error } = await supabase.rpc("set_challenge_window", {
        p_admin_id: adminUser.id,
        p_starts_at: windowStart ? new Date(windowStart).toISOString() : null,
        p_closes_at: windowClose ? new Date(windowClose).toISOString() : null,
      });
      if (error) throw error;

      toast({
        title: "Challenge Window Updated",
        description: `Start: ${windowStart ? new Date(windowStart).toLocaleString() : "unchanged"} · Close: ${windowClose ? new Date(windowClose).toLocaleString() : "open-ended"}`,
      });
      fetchData();
    } catch (error) {
      console.error("Error updating challenge window:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update challenge window",
        variant: "destructive",
      });
    } finally {
      setSavingWindow(false);
    }
  };

  const handleClearLeaderboard = async () => {
    try {
      if (!adminUser) {
        toast({ title: "Error", description: "Admin session not found", variant: "destructive" });
        return;
      }
      setClearing(true);
      const { data, error } = await supabase.rpc("clear_leaderboard", {
        p_admin_id: adminUser.id,
        p_starts_at: newStart ? new Date(newStart).toISOString() : null,
        p_closes_at: newClose ? new Date(newClose).toISOString() : null,
      });
      if (error) throw error;

      const result = (data ?? {}) as { success?: boolean; name?: string };
      if (!result.success) throw new Error("Failed to clear leaderboard");

      toast({
        title: "New Challenge Started",
        description: `${result.name || "Challenge"} is now live. Both leaderboards were wiped and previous standings archived.`,
      });
      setConfirmClear(false);
      setNewStart("");
      setNewClose("");
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
        <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              AI Challenge Control
            </CardTitle>
            {season && (
              <p className="text-sm text-muted-foreground mt-2">
                Current challenge: <Badge variant="secondary">{season.name}</Badge>{" "}
                <span className="text-xs">
                  started {new Date(season.starts_at || season.started_at).toLocaleDateString()}
                  {season.closes_at ? ` · closes ${new Date(season.closes_at).toLocaleDateString()}` : " · no closing date"}
                </span>
              </p>
            )}
          </div>
          <Button
            variant="destructive"
            onClick={() => setConfirmClear(true)}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Wipe & Start New Challenge
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="flex items-center gap-2 text-sm font-medium mb-3">
              <CalendarRange className="w-4 h-4 text-primary" />
              Challenge Start & Closing Dates
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="window-start" className="text-xs text-muted-foreground">Starting Date</Label>
                <Input
                  id="window-start"
                  type="datetime-local"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="window-close" className="text-xs text-muted-foreground">Closing Date</Label>
                <Input
                  id="window-close"
                  type="datetime-local"
                  value={windowClose}
                  onChange={(e) => setWindowClose(e.target.value)}
                />
              </div>
            </div>
            <Button
              size="sm"
              className="mt-3"
              onClick={handleSaveWindow}
              disabled={savingWindow || !season}
            >
              {savingWindow ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Dates
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Referral Leaderboard (decides AI Challenge winners)
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rank</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Followers (this challenge)</TableHead>
                        <TableHead>Lifetime Earnings</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {referralEntries.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center h-24">
                            No referral followers recorded for this challenge yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        referralEntries.map((entry, index) => (
                          <TableRow key={entry.user_id}>
                            <TableCell className="font-bold">#{index + 1}</TableCell>
                            <TableCell>
                              <p className="font-medium">{entry.full_name || "Anonymous"}</p>
                              <p className="text-xs text-muted-foreground">{entry.email}</p>
                            </TableCell>
                            <TableCell>{entry.referral_count}</TableCell>
                            <TableCell>₦{(entry.total_earnings ?? 0).toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-primary" />
                  AI Challenge Standings (Funding Score + XP)
                </p>
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
                            <TableCell>{entry.funding_readiness_score ?? 0}/100</TableCell>
                            <TableCell>{(entry.xp_total ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="font-bold">{(entry.composite_score ?? 0).toLocaleString()} pts</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe & Start a New Challenge?</DialogTitle>
            <DialogDescription>
              This wipes BOTH leaderboards (AI Challenge standings and the Referral leaderboard that decides
              the winners), archives the current standings, and starts a fresh challenge. Users' underlying XP,
              plan scores and followers are not deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-start" className="text-xs text-muted-foreground">New Starting Date (optional)</Label>
              <Input
                id="new-start"
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-close" className="text-xs text-muted-foreground">New Closing Date (optional)</Label>
              <Input
                id="new-close"
                type="datetime-local"
                value={newClose}
                onChange={(e) => setNewClose(e.target.value)}
              />
            </div>
          </div>
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
              Yes, Wipe & Start New Challenge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeaderboardTab;
