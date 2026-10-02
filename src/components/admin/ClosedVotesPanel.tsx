import { useEffect, useState } from "react";
import { Crown, Loader2, Medal, Trophy, Vote } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  fetchClosedStages,
  fetchStageLeaderboard,
  type ClosedStage,
  type LeaderboardEntry,
} from "@/lib/voting";

/**
 * Admin view of a closed stage's final standings.
 *
 * The user-facing community page no longer shows closed-vote history, but
 * admins still need the results of a stage that has ended. This lists every
 * closed stage and renders the same "creators ranked by the votes their posts
 * received" board as the live leaderboard - scoped to the chosen stage.
 *
 * The backing RPC (get_stage_leaderboard) is admin-only server-side, so an
 * empty board here for a non-admin is a permission outcome, not a data gap.
 */
export function ClosedVotesPanel() {
  const [stages, setStages] = useState<ClosedStage[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loadingStages, setLoadingStages] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingStages(true);
      const data = await fetchClosedStages();
      if (cancelled) return;
      setStages(data);
      setSelectedId((prev) => prev ?? data[0]?.stage_id ?? null);
      setLoadingStages(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingBoard(true);
      const data = await fetchStageLeaderboard(selectedId, 50);
      if (cancelled) return;
      setEntries(data);
      setLoadingBoard(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedStage = stages?.find((s) => s.stage_id === selectedId) ?? null;

  const medal = (rank: number) =>
    rank === 1 ? (
      <Crown className="w-4 h-4 text-amber-500" />
    ) : rank === 2 ? (
      <Medal className="w-4 h-4 text-slate-400" />
    ) : rank === 3 ? (
      <Medal className="w-4 h-4 text-amber-700" />
    ) : (
      <span className="w-4 h-4 text-center text-xs text-muted-foreground tabular-nums">{rank}</span>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Vote className="w-5 h-5" /> Closed Votes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingStages ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !stages || stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No closed stages yet. Results appear here once a stage ends.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s) => (
                <Button
                  key={s.stage_id}
                  size="sm"
                  variant={selectedId === s.stage_id ? "default" : "outline"}
                  className="h-auto py-1.5 text-xs"
                  onClick={() => setSelectedId(s.stage_id)}
                >
                  <span className="font-medium">{s.stage_name}</span>
                  <span className="ml-1 opacity-70">
                    · {s.total_votes} vote{s.total_votes === 1 ? "" : "s"}
                    {s.stage_category ? ` · ${s.stage_category.replace(/_/g, " ")}` : ""}
                  </span>
                </Button>
              ))}
            </div>

            {selectedStage && (
              <p className="text-xs text-muted-foreground">
                Stage {selectedStage.stage_number}
                {selectedStage.stage_category
                  ? ` · ${selectedStage.stage_category.replace(/_/g, " ")}`
                  : ""}{" "}
                · {selectedStage.total_votes} vote
                {selectedStage.total_votes === 1 ? "" : "s"} across{" "}
                {selectedStage.total_posts_voted} post
                {selectedStage.total_posts_voted === 1 ? "" : "s"}
                {selectedStage.closes_at
                  ? ` · closed ${new Date(selectedStage.closes_at).toLocaleDateString()}`
                  : ""}
              </p>
            )}

            <div className="rounded-md border">
              {loadingBoard ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : entries && entries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No votes were cast in this stage.
                </p>
              ) : (
                <ol className="divide-y">
                  {(entries ?? []).map((e) => (
                    <li
                      key={e.user_id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2",
                        e.rank <= 3 && "bg-muted/40",
                      )}
                    >
                      <div className="flex w-4 justify-center shrink-0">{medal(e.rank)}</div>
                      <Avatar className="w-8 h-8 shrink-0">
                        <AvatarImage src={e.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {e.full_name?.charAt(0) || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{e.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.posts_count} post{e.posts_count === 1 ? "" : "s"} earning votes
                        </p>
                      </div>
                      <Badge
                        variant={e.rank === 1 ? "default" : "secondary"}
                        className="shrink-0 tabular-nums"
                      >
                        <Trophy className="w-3 h-3 mr-1" />
                        {e.total_votes} vote{e.total_votes === 1 ? "" : "s"}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ClosedVotesPanel;
