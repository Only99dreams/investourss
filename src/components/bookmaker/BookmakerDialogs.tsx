import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Coins, Loader2, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type BookmakerEntitlement, purchaseUrl } from "@/lib/bookmaker";

interface CreditGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  cost: number;
  entitlement: BookmakerEntitlement;
  bookId?: string | null;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
  note?: ReactNode;
}

/**
 * Confirmation shown before any paid AI action. It repeats the server's
 * price, shows exactly where the credits will come from, and turns an
 * insufficient balance into clear purchase/subscription options without
 * throwing away the member's work.
 */
export function CreditGateDialog({
  open,
  onOpenChange,
  title,
  description,
  cost,
  entitlement,
  bookId,
  confirmLabel,
  busy = false,
  onConfirm,
  children,
  note,
}: CreditGateDialogProps) {
  const total = entitlement?.total_available ?? 0;
  const subscription = entitlement?.subscription_credits_remaining ?? 0;
  const packs = entitlement?.pack_credits_remaining ?? 0;
  const shortfall = Math.max(cost - total, 0);
  const canAfford = shortfall === 0;
  const fromSubscription = Math.min(subscription, cost);
  const fromPacks = Math.max(Math.min(packs, cost - fromSubscription), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-start gap-2 text-base sm:text-lg">
            <Coins className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0">{title}</span>
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This action</p>
                <p className="mt-1 text-2xl font-bold">
                  {cost} credit{cost === 1 ? "" : "s"}
                </p>
              </div>
              <Badge variant={canAfford ? "secondary" : "destructive"} className="gap-1">
                {canAfford ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {canAfford ? "Ready" : "Short by " + shortfall}
              </Badge>
            </div>

            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subscription credits</span>
                <span className="font-medium">{subscription}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Credit pack balance</span>
                <span className="font-medium">{packs}</span>
              </div>
              <div className="flex items-center justify-between border-t border-primary/15 pt-1.5">
                <span className="font-medium">Total available</span>
                <span className="font-bold">{total}</span>
              </div>
            </div>

            {canAfford ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {fromSubscription > 0
                  ? `${fromSubscription} subscription credit${fromSubscription === 1 ? "" : "s"} will be used first`
                  : "Credit pack balance will be used"}
                {fromPacks > 0 ? `, then ${fromPacks} pack credit${fromPacks === 1 ? "" : "s"}.` : "."}
              </p>
            ) : null}
          </div>

          {children}

          {!canAfford ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold">
                <Wallet className="h-4 w-4" /> You need {shortfall} more credit{shortfall === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Your book, outline and edits are already saved. Buy credits or subscribe in a new tab, then come back to this book from My Books.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button asChild size="sm" className="flex-1">
                  <a href={purchaseUrl(bookId, "packs")} target="_blank" rel="noreferrer">
                    Buy AI credits <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <a href={purchaseUrl(bookId, "subscribe")} target="_blank" rel="noreferrer">
                    <Sparkles className="mr-1 h-3.5 w-3.5" /> Subscribe
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canAfford || busy} className="w-full gap-2 sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            {confirmLabel || (cost === 1 ? "Use 1 credit" : `Use ${cost} credits`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreditGateDialog;
