import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, CreditCard, LogIn, Sparkles, TrendingUp, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubscriptionPayment } from "@/components/SubscriptionPayment";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { VOTING_TIERS } from "@/lib/voting";
import { CreditPackCheckout } from "./CreditPackCheckout";

type View = "choose" | "subscribe" | "pack";
type PlanType = "monthly" | "quarterly" | "biennial" | "annual";

/** Only the consumer plans are offered here; B2B is a different conversation. */
const PLAN_TYPES: Record<string, PlanType> = {
  monthly: "monthly",
  quarterly: "quarterly",
  biennial: "biennial",
  annual: "annual",
};

interface VoteCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which plan they were last holding, so the dialog can open on the
   * "get more votes" path rather than making them choose again.
   */
  hint?: "more_votes" | null;
  /** Called after a successful purchase so the caller can refresh power. */
  onPurchased: () => void;
}

/**
 * Buy voting power without leaving the community.
 *
 * Three views: pick a route, then pay. Subscription reuses the existing
 * SubscriptionPayment component so there is one payment implementation rather
 * than a second copy that can drift; credit packs needed a small inline flow
 * because the packs page is not componentised.
 *
 * Prices are deliberately not shown in the choose view. They come from the
 * pack table and the plan table, and the checkout shows the real figure at the
 * point of purchase, including VAT. What the choose view shows instead is the
 * voting allowance, which is the reason they are here.
 */
export function VoteCheckoutDialog({
  open,
  onOpenChange,
  hint = null,
  onPurchased,
}: VoteCheckoutDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("choose");
  const [plan, setPlan] = useState<PlanType>("monthly");

  // Reopening should always start from the route choice, not wherever the
  // member happened to leave off.
  useEffect(() => {
    if (!open) return;
    // Always reopen on the route choice. `hint` is accepted for call-site
    // clarity but both paths start at "choose" deliberately: a member who ran
    // out of votes is choosing between topping up and upgrading, not being told
    // which one to do.
    setView("choose");
  }, [open, hint]);

  const close = () => onOpenChange(false);

  const purchased = () => {
    toast({
      title: "You're all set",
      description: "Your voting power is live.",
    });
    onPurchased();
    close();
  };

  const title = {
    choose: "Voting is for paid members",
    subscribe: "Subscribe",
    pack: "Buy credit",
  }[view];

  // Anonymous visitors cannot pay, and the pack RPC needs a user id. Send them
  // to sign in rather than showing a form that cannot complete.
  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Vote className="w-5 h-5 text-primary" />
              Sign in to vote
            </DialogTitle>
            <DialogDescription>
              Voting is open to subscribers and credit pack holders. Sign in, then
              subscribe or buy credit to cast your votes.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="w-full"
            onClick={() => {
              close();
              navigate("/auth?mode=login");
            }}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign in to continue
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view === "choose" ? <Vote className="w-5 h-5 text-primary" /> : null}
            {view === "subscribe" ? <Sparkles className="w-5 h-5 text-primary" /> : null}
            {view === "pack" ? <Coins className="w-5 h-5 text-primary" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription>
            {view === "choose" &&
              "Your allowance refreshes at the start of every stage, and higher tiers get more votes. Pay here without leaving the community."}
            {view === "subscribe" && "Choose a plan, then complete payment below."}
            {view === "pack" &&
              "Pay-as-you-go credits. Each pack also grants voting power for the stage."}
          </DialogDescription>
        </DialogHeader>

        {view === "subscribe" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {VOTING_TIERS.filter((t) => t.source === "subscription").map((t) => (
                <Button
                  key={t.plan_key}
                  size="sm"
                  variant={plan === t.plan_key ? "default" : "outline"}
                  onClick={() => setPlan(PLAN_TYPES[t.plan_key])}
                >
                  {t.label}
                  <span className="ml-1 opacity-70">{t.votes_per_stage}</span>
                </Button>
              ))}
            </div>
            <SubscriptionPayment planType={plan} onSuccess={purchased} onCancel={() => setView("choose")} />
            <Button variant="ghost" className="w-full" onClick={() => setView("choose")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
        )}

        {view === "pack" && (
          <CreditPackCheckout onPurchased={purchased} onCancel={() => setView("choose")} />
        )}

        {view === "choose" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setView("subscribe")}
              className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="w-4 h-4 text-primary" />
                Subscribe
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Recurring, unlocks the whole platform.{" "}
                {VOTING_TIERS.filter((t) => t.source === "subscription")
                  .map((t) => `${t.label} ${t.votes_per_stage}`)
                  .join(" · ")}{" "}
                votes per stage.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setView("pack")}
              className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="w-4 h-4 text-primary" />
                Buy credit
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pay-as-you-go, no commitment.{" "}
                {VOTING_TIERS.filter((t) => t.source === "credit_pack")
                  .map((t) => `${t.label} ${t.votes_per_stage}`)
                  .join(" · ")}{" "}
                votes per stage.
              </p>
            </button>

            <p className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
              <TrendingUp className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              A single post can take more than one vote, so a higher tier genuinely
              backs an entry harder.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
