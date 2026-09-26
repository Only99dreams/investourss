import { useNavigate } from "react-router-dom";
import { Coins, CreditCard, Sparkles, TrendingUp, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VOTING_TIERS } from "@/lib/voting";

/** The subscribe page selects a plan by substring match on this parameter. */
const planSlug: Record<string, string> = {
  monthly: "premium-monthly",
  quarterly: "premium-quarterly",
  biennial: "premium-biennial",
  annual: "premium-annual",
};

interface VoteUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown when someone without a subscription or credit pack tries to vote.
 *
 * Two routes in, because they are genuinely different products: a subscription
 * is recurring and unlocks the rest of the platform, while a credit pack is
 * pay-as-you-go. It deliberately does not quote prices - those live in the
 * pricing pages and a copy here would drift out of date. What it does show is
 * the voting allowance, which is the reason they are being asked.
 *
 * Each tier row deep-links to that exact plan via the `plan` parameter, so
 * choosing "Annual" lands on Annual rather than making them pick again.
 */
export function VoteUpgradeDialog({ open, onOpenChange }: VoteUpgradeDialogProps) {
  const navigate = useNavigate();

  const subscriptions = VOTING_TIERS.filter((t) => t.source === "subscription");
  const packs = VOTING_TIERS.filter((t) => t.source === "credit_pack");

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Vote className="w-5 h-5 text-primary" />
            Voting is for paid members
          </DialogTitle>
          <DialogDescription>
            Subscribers and credit pack holders can vote on community posts. Your
            allowance refreshes at the start of every stage, and higher tiers get
            more votes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Subscription */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <p className="font-semibold text-sm">Subscribe</p>
            </div>
            <div className="space-y-1">
              {subscriptions.map((t) => (
                <button
                  key={t.plan_key}
                  type="button"
                  onClick={() => go(`/subscribe?plan=${planSlug[t.plan_key] ?? t.plan_key}`)}
                  className="w-full flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  <span>{t.label}</span>
                  <span className="text-muted-foreground">
                    {t.votes_per_stage} vote{t.votes_per_stage === 1 ? "" : "s"} / stage
                  </span>
                </button>
              ))}
            </div>
            <Button className="w-full mt-3" onClick={() => go("/subscribe")}>
              <Sparkles className="w-4 h-4 mr-2" />
              Choose a subscription
            </Button>
          </div>

          {/* Credit packs */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-primary" />
              <p className="font-semibold text-sm">Buy credit</p>
            </div>
            <div className="space-y-1">
              {packs.map((t) => (
                <button
                  key={t.plan_key}
                  type="button"
                  onClick={() => go("/auditor/packs")}
                  className="w-full flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  <span>{t.label}</span>
                  <span className="text-muted-foreground">
                    {t.votes_per_stage} vote{t.votes_per_stage === 1 ? "" : "s"} / stage
                  </span>
                </button>
              ))}
            </div>
            <Button variant="outline" className="w-full mt-3" onClick={() => go("/auditor/packs")}>
              <Coins className="w-4 h-4 mr-2" />
              Buy a credit pack
            </Button>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Your votes are weighted by tier, and a single post can take more than one
            vote — so a higher tier genuinely backs an entry harder.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
