import { useCallback, useEffect, useState } from "react";
import { usePaystackPayment } from "react-paystack";
import { CheckCircle2, Coins, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string;
/** Matches the rate the pricing and pack pages already charge. */
const VAT_RATE = 0.075;

interface CreditPack {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price: number;
  validity_days: number;
  sort_order: number | null;
}

/** Voting allowance per pack tier, mirroring voting_power_tiers. */
const PACK_VOTES: Record<string, number> = {
  starter: 1,
  standard: 2,
  annual: 3,
};

const votesForPack = (name: string) => {
  const key = Object.keys(PACK_VOTES).find((k) => name.toLowerCase().includes(k));
  return key ? PACK_VOTES[key] : 0;
};

interface CreditPackCheckoutProps {
  onPurchased: () => void;
  onCancel: () => void;
}

/**
 * Buys an audit credit pack without leaving the page.
 *
 * Mirrors the flow on AuditorPacks so there is one behaviour, not two: reserve
 * an order, charge the card through Paystack, then activate. The client's
 * activation call can lose the race with the webhook, so a failure falls back to
 * polling for the order to become active rather than telling the user their
 * payment did not land.
 */
export function CreditPackCheckout({ onPurchased, onCancel }: CreditPackCheckoutProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("audit_credit_packs")
          .select("id,name,description,credits,price,validity_days,sort_order")
          .eq("is_active", true)
          .order("sort_order");
        if (error) throw error;
        if (!cancelled) setPacks((data ?? []) as CreditPack[]);
      } catch (err) {
        console.error("Failed to load packs:", err);
        if (!cancelled) {
          toast({
            title: "Could not load packs",
            description: "Please try again in a moment.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Poll the order until the webhook has activated it. */
  const waitForActivation = useCallback(async (reference: string): Promise<boolean> => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const { data } = await supabase
        .from("user_credit_packs")
        .select("status")
        .eq("reference", reference)
        .maybeSingle();
      if (data && data.status === "active") return true;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }, []);

  const activate = useCallback(
    async (reference: string, amountKobo: number) => {
      if (!user) return;
      setActivating(true);
      try {
        const { error } = await supabase.rpc("activate_audit_pack_payment", {
          p_user_id: user.id,
          p_reference: reference,
          p_amount_kobo: amountKobo,
        });
        if (error) throw new Error(error.message);

        toast({
          title: "Credit pack activated",
          description: "Your credits are ready, and your voting power is live.",
        });
        onPurchased();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Activation failed.";
        // An order the webhook already processed is not an error to show.
        if (/not found|could not find|already/i.test(msg)) {
          onPurchased();
          return;
        }
        toast({
          title: "Confirming your payment",
          description: "Payment received — your credits are being activated.",
        });
        if (await waitForActivation(reference)) {
          toast({ title: "Credit pack activated", description: "Your credits are ready." });
          onPurchased();
        } else {
          toast({
            title: "Activation pending",
            description: "Your payment went through and will be activated shortly.",
            variant: "destructive",
          });
        }
      } finally {
        setActivating(false);
      }
    },
    [user, toast, onPurchased, waitForActivation],
  );

  const paystackConfig = {
    publicKey: PAYSTACK_PUBLIC_KEY,
    email: profile?.email ?? user?.email ?? "",
    currency: "NGN" as const,
  };
  const initializePayment = usePaystackPayment(paystackConfig);

  const purchase = async (pack: CreditPack) => {
    if (!user) {
      toast({ title: "Login Required", description: "Please log in to continue.", variant: "destructive" });
      return;
    }
    setPurchasing(pack.id);
    try {
      const { data, error } = await supabase.rpc("purchase_audit_pack", { p_pack_id: pack.id });
      if (error) throw error;
      const result = data as {
        success: boolean; message?: string; reference?: string;
        amount?: number; pack_name?: string;
      };
      if (!result?.success) throw new Error(result?.message || "Could not start the purchase.");

      const reference = result.reference ?? "";
      const amount = result.amount ?? pack.price;
      const packName = result.pack_name ?? pack.name;
      // VAT is added on top, matching the pricing and packs pages.
      const amountKobo = Math.round((amount + Math.round(amount * VAT_RATE)) * 100);

      initializePayment({
        config: {
          reference,
          amount: amountKobo,
          // Repeated from the hook config: react-paystack types the per-call
          // config as Omit<PaystackProps, "publicKey">, so email is required
          // here even though the hook already has it.
          email: profile?.email ?? user?.email ?? "",
          metadata: {
            payment_type: "audit_pack",
            user_id: user.id,
            pack_name: packName,
            custom_fields: [
              { display_name: "Pack", variable_name: "pack_name", value: packName },
              { display_name: "User ID", variable_name: "user_id", value: user.id },
            ],
          },
        },
        onSuccess: (transaction: { reference?: string }) =>
          void activate(transaction.reference ?? reference, amountKobo),
        // react-paystack names the dismiss handler onClose, not onCancel.
        onClose: () =>
          toast({ title: "Payment cancelled", description: "You have not been charged." }),
      });
    } catch (err) {
      toast({
        title: "Could not start the purchase",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPurchasing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {packs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No credit packs are available right now.
        </p>
      ) : (
        packs.map((pack) => {
          const votes = votesForPack(pack.name);
          const busy = purchasing === pack.id || activating;
          return (
            <div
              key={pack.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                votes === 3 ? "border-primary/50 bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Coins className="w-4 h-4 text-primary" />
                    {pack.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pack.credits} credits &middot; valid {pack.validity_days} days
                  </p>
                  {pack.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{pack.description}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">
                    ₦{Number(pack.price).toLocaleString()}
                  </p>
                  {votes > 0 && (
                    <Badge variant="secondary" className="mt-1">
                      {votes} vote{votes === 1 ? "" : "s"}/stage
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                className="mt-3 w-full"
                disabled={busy}
                onClick={() => void purchase(pack)}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                {purchasing === pack.id ? "Opening payment…" : `Buy ${pack.name}`}
              </Button>
            </div>
          );
        })
      )}

      <p className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 w-3.5 h-3.5 shrink-0" />
        Payment is handled by Paystack. Credits activate automatically, and your
        voting power updates straight away.
      </p>

      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Back
      </Button>
    </div>
  );
}
