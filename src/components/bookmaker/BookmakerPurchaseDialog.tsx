import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, CreditCard, LogIn, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditPackCheckout } from "@/components/community/CreditPackCheckout";
import { SUBSCRIPTION_PLANS, SubscriptionPayment } from "@/components/SubscriptionPayment";
import { BOOKMAKER_CREDITS_CHANGED } from "@/lib/bookmakerApi";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

type View = "choose" | "pack" | "subscribe";
type PlanType = "monthly" | "quarterly" | "biennial" | "annual";

const PLAN_ORDER: PlanType[] = ["monthly", "quarterly", "biennial", "annual"];

interface BookmakerPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens straight on the route the member tapped. */
  initialView?: "packs" | "subscribe";
  /** Called after a successful purchase so the caller can refresh credits. */
  onPurchased: () => void;
}

/**
 * Buys Bookmaker credits or a subscription without leaving the ebook.
 *
 * Credit packs and subscriptions reuse the platform checkout components, so
 * there is one payment implementation rather than a second copy that can drift
 * from Pricing. Nothing here navigates away: only the Paystack window opens.
 */
export function BookmakerPurchaseDialog({
  open,
  onOpenChange,
  initialView,
  onPurchased,
}: BookmakerPurchaseDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("choose");
  const [plan, setPlan] = useState<PlanType>("monthly");

  useEffect(() => {
    if (!open) return;
    setView(initialView === "packs" ? "pack" : (initialView ?? "choose"));
  }, [open, initialView]);

  const close = () => onOpenChange(false);

  const purchased = () => {
    toast({
      title: "Purchase complete",
      description: "Your credits are ready to use on this book.",
    });
    window.dispatchEvent(new Event(BOOKMAKER_CREDITS_CHANGED));
    onPurchased();
    close();
  };

  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              Sign in to buy credits
            </DialogTitle>
            <DialogDescription>
              Credits and subscriptions are tied to your account. Sign in, then return to this
              book to finish your purchase.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="w-full"
            onClick={() => {
              close();
              navigate("/auth?mode=login");
            }}
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign in to continue
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  const title = view === "choose" ? "Get Bookmaker credits" : view === "pack" ? "Buy a credit pack" : "Subscribe";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            {view === "pack" ? <Coins className="h-5 w-5 text-primary" /> : null}
            {view === "subscribe" ? <Sparkles className="h-5 w-5 text-primary" /> : null}
            {view === "choose" ? <Sparkles className="h-5 w-5 text-primary" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription>
            {view === "choose" && "A credit pack is the flexible top-up; a subscription adds a monthly ebook allowance and credits."}
            {view === "pack" && "Platform credits for writing, covers, narration and downloads. Prices exclude 7.5% VAT."}
            {view === "subscribe" && "Choose a plan, then pay below. Prices exclude 7.5% VAT, added at checkout."}
          </DialogDescription>
        </DialogHeader>

        {view === "choose" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setView("pack")}
              className="w-full rounded-xl border border-primary/40 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="h-4 w-4 text-primary" />
                Buy a credit pack
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Pay once, no commitment. Platform credits cover narration, downloads and AI
                generations, and packs include free downloads for every book.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setView("subscribe")}
              className="w-full rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="h-4 w-4 text-primary" />
                Subscribe to a plan
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Includes an ebook allowance for the billing period plus monthly credits. Audiobook
                narration still uses platform credits from a pack.
              </p>
            </button>
          </div>
        ) : null}

        {view === "pack" ? (
          <CreditPackCheckout onPurchased={purchased} onCancel={() => setView("choose")} />
        ) : null}

        {view === "subscribe" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {PLAN_ORDER.map((key) => {
                const detail = SUBSCRIPTION_PLANS[key];
                const selected = plan === key;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                    onClick={() => setPlan(key)}
                  >
                    <span className="text-xs font-semibold">{detail.name.replace("Premium ", "")}</span>
                    <span className={selected ? "text-[11px] opacity-90" : "text-[11px] text-muted-foreground"}>
                      ₦{detail.price.toLocaleString()} / {detail.period}
                    </span>
                  </Button>
                );
              })}
            </div>
            <SubscriptionPayment planType={plan} onSuccess={purchased} onCancel={() => setView("choose")} />
            <Button variant="ghost" className="w-full" onClick={() => setView("choose")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default BookmakerPurchaseDialog;
