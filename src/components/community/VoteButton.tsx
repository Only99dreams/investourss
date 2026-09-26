import { useState } from "react";
import { Check, Loader2, TrendingUp, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { VotingPower } from "@/lib/voting";

interface VoteButtonProps {
  /** Votes on the post, from `posts.votes_count`. */
  votesCount: number;
  /** What the signed-in user has on this post, 0 if none. */
  myVote: number;
  power: VotingPower | null;
  /** True when the signed-in user wrote this post. */
  isOwnPost: boolean;
  busy: boolean;
  onVote: (amount: number) => void;
  onRequirePayment: () => void;
  className?: string;
}

/**
 * The vote control, sitting beside Share on every post.
 *
 * A paid user can put any number of their remaining votes on a post, up to
 * their tier, and can change or withdraw that number. A user who cannot vote
 * still sees the count - hiding it would look like the feature is missing - but
 * tapping it explains what voting requires instead of silently doing nothing.
 */
export function VoteButton({
  votesCount,
  myVote,
  power,
  isOwnPost,
  busy,
  onVote,
  onRequirePayment,
  className,
}: VoteButtonProps) {
  const [open, setOpen] = useState(false);

  const canVote = Boolean(power) && !isOwnPost;
  const maxOnThisPost = power ? power.votes_remaining + myVote : 0;
  const remaining = power?.votes_remaining ?? 0;

  const label = cn(
    "flex items-center gap-1.5 transition-colors",
    myVote > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
    canVote && "hover:text-emerald-600 dark:hover:text-emerald-400",
    isOwnPost && "cursor-default",
    className,
  );

  // The author cannot back their own post, so the control is inert for them.
  if (isOwnPost) {
    return (
      <span className={cn(label, "opacity-70")} title="You cannot vote for your own post">
        <Vote className="w-4 h-4" />
        {votesCount > 0 ? votesCount : "Vote"}
      </span>
    );
  }

  // Not a paid user: the count is still useful, so keep it visible and explain
  // the requirement on tap rather than showing a dead button.
  if (!power) {
    return (
      <button
        type="button"
        onClick={onRequirePayment}
        className={label}
        title="Voting is for subscribers and credit pack holders"
      >
        <Vote className="w-4 h-4" />
        {votesCount > 0 ? votesCount : "Vote"}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={label} disabled={busy} title={`Vote on this post`}>
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Vote className={cn("w-4 h-4", myVote > 0 && "fill-current")} />
          )}
          {votesCount > 0 ? votesCount : "Vote"}
          {myVote > 0 && (
            <span className="text-[10px] font-semibold px-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              +{myVote}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" />
            Cast your vote
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {power.source_label} &middot; {power.stage_name} &middot; {remaining} of{" "}
            {power.votes_per_stage} left
          </p>
        </div>

        {maxOnThisPost <= 0 ? (
          <p className="text-sm text-muted-foreground">
            You have used all your votes for this stage.
          </p>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Votes on this post
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: maxOnThisPost }, (_, i) => i + 1).map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={myVote === n ? "default" : "outline"}
                  className="h-8 min-w-9"
                  disabled={busy}
                  onClick={() => {
                    onVote(n);
                    setOpen(false);
                  }}
                >
                  {myVote === n && <Check className="w-3 h-3 mr-1" />}
                  {n}
                </Button>
              ))}
            </div>
            {myVote > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full h-8 text-xs"
                disabled={busy}
                onClick={() => {
                  onVote(0);
                  setOpen(false);
                }}
              >
                Remove my vote
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
