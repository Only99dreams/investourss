import { useEffect, useState } from "react";
import { Crown, Loader2, Medal, Trophy, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchLeaderboard, fetchVotedCategories, type LeaderboardEntry } from "@/lib/voting";

interface CategoryLeaderboardProps {
  /** Active categories, to label slugs the same way the filter row does. */
  categories: { name: string; label: string }[];
  /** Category the feed is currently filtered to, if any. */
  activeCategory: string;
  onSelectCategory?: (name: string) => void;
}

/**
 * Top voters, one leaderboard per category.
 *
 * Only categories that actually have a vote are offered, so a community that
 * has not voted anywhere does not show a wall of empty rankings. Tapping a
 * category also filters the feed, so the ranking and the posts it refers to are
 * always the same set.
 */
export function CategoryLeaderboard({
  categories,
  activeCategory,
  onSelectCategory,
}: CategoryLeaderboardProps) {
  const [voted, setVoted] = useState<{ category: string; total_votes: number }[] | null>(null);
  const [selected, setSelected] = useState<string>("all");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  const labelFor = (slug: string) =>
    categories.find((c) => c.name === slug)?.label ?? slug.replace(/_/g, " ");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const data = await fetchVotedCategories();
      if (cancelled) return;
      setVoted(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setEntries(null);
      setLoading(true);
      const data = await fetchLeaderboard(selected === "all" ? null : selected, 20);
      if (cancelled) return;
      setEntries(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Nothing has been voted on yet, so there is no leaderboard to show. Kept
  // entirely out of the way rather than rendered empty.
  if (voted && voted.length === 0) return null;

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
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Vote leaderboard">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          Vote Leaderboard
        </h3>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {voted && voted.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Button
            size="sm"
            variant={selected === "all" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setSelected("all")}
          >
            All categories
          </Button>
          {voted.map((c) => (
            <Button
              key={c.category}
              size="sm"
              variant={selected === c.category ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => {
                setSelected(c.category);
                if (onSelectCategory && c.category !== "all") onSelectCategory(c.category);
              }}
            >
              {labelFor(c.category)}
              <span className="ml-1 opacity-70">{c.total_votes}</span>
            </Button>
          ))}
        </div>
      )}

      {entries && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No votes yet{selected !== "all" ? ` in ${labelFor(selected)}` : ""}. Paid members cast the
          first one.
        </p>
      ) : (
        <ol className="space-y-1">
          {(entries ?? []).map((e) => (
            <li
              key={e.user_id}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2",
                e.rank <= 3 && "bg-muted/50",
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
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  backed {e.posts_backed} post{e.posts_backed === 1 ? "" : "s"}
                </p>
              </div>
              <Badge variant={e.rank === 1 ? "default" : "secondary"} className="shrink-0 tabular-nums">
                {e.total_votes} vote{e.total_votes === 1 ? "" : "s"}
              </Badge>
            </li>
          ))}
        </ol>
      )}

      {activeCategory !== "all" && onSelectCategory && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing all categories. The feed is filtered to {labelFor(activeCategory)}.
        </p>
      )}
    </section>
  );
}
