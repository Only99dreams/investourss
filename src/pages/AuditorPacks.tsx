import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePaystackPayment } from "react-paystack";
import {
  CreditCard, Check, ArrowRight, Loader2, Coins, Clock, Info, Sparkles, Banknote, Copy, CheckCircle2, RefreshCw, Tag, X,
} from "lucide-react";
// Note: Banknote, Copy, CheckCircle2, RefreshCw are still used in the pending order payment card
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { DEFAULT_ACCESS, type AuditAccess } from "@/lib/auditor";
import { cn } from "@/lib/utils";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string;
const VAT_RATE = 0.075;

interface CreditPack {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price: number;
  validity_days: number;
  sort_order: number;
}

/** Display name for each pack, regardless of what the database calls it. */
const packDisplayName = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.includes("starter")) return "Starter Pack";
  if (lower.includes("standard")) return "Standard Pack";
  if (lower.includes("annual")) return "Annual Pack";
  return name;
};

interface PaystackTransaction {
  reference?: string;
}

interface PackOrder {
  id: string;
  pack_id: string;
  pack_name: string;
  credits: number;
  amount: number;
  original_amount?: number;
  discount_amount?: number;
  discount_percentage?: number;
  vat_amount?: number;
  reference: string;
  status: string;
  created_at: string;
}

const AuditorPacks = () => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Return to the in-progress ebook when the purchase started in Bookmaker.
  const returnBookId = searchParams.get("book");
  const returnToBook = () => {
    if (returnBookId) navigate(`/bookmaker/create?book=${encodeURIComponent(returnBookId)}`);
  };

  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [access, setAccess] = useState<AuditAccess>(DEFAULT_ACCESS);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<PackOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    promo_code_id: string;
    discount_percentage: number;
    credit_pack_id: string | null;
    credit_pack_name: string | null;
  } | null>(null);

  const discountFor = (price: number) =>
    appliedPromo ? Math.round((price * appliedPromo.discount_percentage) / 100) : 0;
  const priceAfterPromo = (price: number) => Math.max(price - discountFor(price), 0);

  const applyPromo = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code || !user) return;
    setPromoLoading(true);
    try {
      const { data, error } = await supabase.rpc("validate_credit_promo_code", {
        p_code: code,
        p_user_id: user.id,
      });
      if (error) throw error;
      const result = data as {
        valid: boolean;
        message?: string;
        discount_percentage?: number;
        promo_code_id?: string;
        credit_pack_id?: string | null;
        credit_pack_name?: string | null;
      };
      if (result.valid && result.promo_code_id) {
        setAppliedPromo({
          code,
          promo_code_id: result.promo_code_id,
          discount_percentage: Number(result.discount_percentage ?? 0),
          credit_pack_id: result.credit_pack_id ?? null,
          credit_pack_name: result.credit_pack_name ?? null,
        });
        toast({
          title: "Promo code applied",
          description: result.credit_pack_name
            ? `${result.discount_percentage}% off the ${result.credit_pack_name} pack.`
            : `${result.discount_percentage}% off any credit pack.`,
        });
      } else {
        toast({
          title: "Invalid promo code",
          description: result.message ?? "This code cannot be used for credit packs.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Could not check the code",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoCode("");
  };

  const loadData = useCallback(async () => {
    try {
      const [packsRes, accessRes] = await Promise.all([
        supabase.from("audit_credit_packs").select("id,name,description,credits,price,validity_days,sort_order").order("sort_order"),
        supabase.rpc("get_audit_access"),
      ]);
      if (packsRes.error) throw packsRes.error;
      if (accessRes.error) throw accessRes.error;

      setPacks((packsRes.data ?? []) as CreditPack[]);
      const a = Array.isArray(accessRes.data) ? accessRes.data[0] : accessRes.data;
      setAccess(a as AuditAccess);
    } catch (err) {
      console.error("Failed to load packs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }
    loadData();
  }, [user, authLoading, navigate, loadData]);

  // ── Paystack ───────────────────────────────────────────────────────────────
  const paystackHookConfig = {
    publicKey: PAYSTACK_PUBLIC_KEY,
    email: profile?.email ?? user?.email ?? "",
    currency: "NGN" as const,
  };
  const initializePayment = usePaystackPayment(paystackHookConfig);

  const openPaystack = (reference: string, amountKobo: number, packName: string) => {
    if (!user) {
      toast({ title: "Login Required", description: "Please log in to continue.", variant: "destructive" });
      return;
    }
    initializePayment({
      config: {
        reference,
        amount: amountKobo,
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
      onSuccess: (transaction: PaystackTransaction) => {
        activatePack(transaction.reference ?? reference, amountKobo);
      },
      onClose: () => {
        toast({ title: "Payment Cancelled", description: "You closed the payment window. You can retry below." });
      },
    });
  };

  const errorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "object" && err !== null && "message" in err) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m;
    }
    return "Payment received but activation failed. Please contact support.";
  };

  const waitForActivation = async (reference: string): Promise<boolean> => {
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
  };

  const activatePack = async (reference: string, _amountKobo: number) => {
    if (!user) return;
    setActivating(true);
    try {
      // Service-role only RPC is reached through this verified function, which
      // confirms the charge with Paystack before granting credits.
      const { error } = await supabase.functions.invoke("verify-payment", {
        body: { reference },
      });
      if (error) throw new Error(error.message);

      setActivationFailed(false);
      toast({ title: "Platform Credits Activated!", description: "Your platform credits have been added to your account." });
      setPendingOrder(null);
      await loadData();
      returnToBook();
    } catch (err) {
      const msg = errorMessage(err);
      const alreadyProcessed = /not found|could not find|already/i.test(msg);
      setActivationFailed(true);
      if (alreadyProcessed) {
        setPendingOrder(null);
        await loadData();
        toast({
          title: "Already Processed",
          description: "Your payment reference was already processed. Credits refreshed.",
        });
        returnToBook();
      } else {
        toast({
          title: "Activation Pending",
          description: `${msg} We're confirming your payment automatically…`,
          variant: "destructive",
        });
        const ok = await waitForActivation(reference);
        if (ok) {
          setActivationFailed(false);
          toast({
            title: "Platform Credits Activated!",
            description: "Payment confirmed — your credits were activated automatically.",
          });
          setPendingOrder(null);
          await loadData();
          returnToBook();
        }
      }
    } finally {
      setActivating(false);
    }
  };

  const handlePurchase = async (pack: CreditPack) => {
    if (appliedPromo?.credit_pack_id && appliedPromo.credit_pack_id !== pack.id) {
      toast({
        title: "Promo code does not apply",
        description: `This code is for the ${appliedPromo.credit_pack_name ?? "selected"} pack.`,
        variant: "destructive",
      });
      return;
    }
    setPurchasing(pack.id);
    try {
      const { data, error } = await supabase.rpc("purchase_audit_pack", {
        p_pack_id: pack.id,
        p_promo_code_id: appliedPromo?.promo_code_id ?? null,
      });
      if (error) throw error;
      const result = data as {
        success: boolean; message?: string; order_id?: string; reference?: string;
        pack_name?: string; amount?: number; original_amount?: number;
        discount_amount?: number; discount_percentage?: number; credits?: number; free?: boolean;
      };
      if (!result?.success) throw new Error(result?.message || "Purchase failed");

      if (result.free) {
        setActivationFailed(false);
        setPendingOrder(null);
        toast({
          title: "Platform Credits Activated!",
          description: "Your promo code covered the full price, so the credits are ready.",
        });
        await loadData();
        returnToBook();
        return;
      }

      const reference = result.reference ?? "";
      const amount = result.amount ?? priceAfterPromo(pack.price);
      const vatAmount = Math.round(amount * VAT_RATE);
      const totalWithVat = amount + vatAmount;
      const amountKobo = Math.round(totalWithVat * 100); // Paystack uses kobo

      setActivationFailed(false);
      setPendingOrder({
        id: result.order_id ?? "",
        pack_id: pack.id,
        pack_name: result.pack_name ?? pack.name,
        credits: result.credits ?? pack.credits,
        amount: totalWithVat,
        original_amount: result.original_amount ?? pack.price,
        discount_amount: result.discount_amount ?? discountFor(pack.price),
        discount_percentage: result.discount_percentage ?? appliedPromo?.discount_percentage ?? 0,
        vat_amount: vatAmount,
        reference,
        status: "pending",
        created_at: new Date().toISOString(),
      });

      openPaystack(reference, amountKobo, result.pack_name ?? pack.name);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create order",
        variant: "destructive",
      });
    } finally {
      setPurchasing(null);
    }
  };

  const copyReference = (ref: string) => {
    navigator.clipboard.writeText(ref);
    setCopied(true);
    toast({ title: "Copied!", description: "Reference copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 pt-24 md:pt-28 pb-10 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <Badge variant="outline" className="mb-3">
            <Coins className="w-3 h-3 mr-1" />
            {access.subscription_active
              ? "Active subscription — unlimited"
              : `${access.credits_remaining} credits available`}
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Platform Credit Packs</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Pay-as-you-go credits for on-demand AI financial checks. Manual checks consume one
            credit each — automatic monitoring never consumes credits.
          </p>
        </motion.div>

        <div className="mx-auto mb-8 max-w-md rounded-lg border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Tag className="h-4 w-4 text-primary" /> Have a promo code?
          </p>
          {appliedPromo ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2">
              <span className="text-sm">
                <span className="font-mono font-semibold">{appliedPromo.code}</span>
                <span className="ml-2 text-emerald-600">
                  {appliedPromo.discount_percentage}% off
                </span>
                {appliedPromo.credit_pack_name && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {appliedPromo.credit_pack_name} only
                  </span>
                )}
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={removePromo}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Input
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                placeholder="Enter code"
                className="font-mono"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void applyPromo();
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={promoLoading || !promoCode.trim()}
                onClick={() => void applyPromo()}
              >
                {promoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
              </Button>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-10">
          {loading ? (
            <div className="col-span-3 flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            packs.map((pack, i) => {
              const promoApplies =
                appliedPromo && (!appliedPromo.credit_pack_id || appliedPromo.credit_pack_id === pack.id);
              return (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className={cn("h-full flex flex-col", i === 1 && "border-2 border-primary shadow-lg")}>
                  {i === 1 && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                      <Badge className="bg-primary">BEST VALUE</Badge>
                    </div>
                  )}
                  <CardHeader className="text-center">
                    <CardTitle>{packDisplayName(pack.name)}</CardTitle>
                    <CardDescription>{pack.description?.replace(/Audit/gi, "Platform")}</CardDescription>
                    <div className="mt-2">
                      {appliedPromo && promoApplies ? (
                        <>
                          <span className="text-3xl font-bold">
                            ₦{priceAfterPromo(pack.price).toLocaleString()}
                          </span>
                          <span className="ml-2 text-sm text-muted-foreground line-through">
                            ₦{pack.price.toLocaleString()}
                          </span>
                          <div className="text-xs font-medium text-emerald-600">
                            You save ₦{discountFor(pack.price).toLocaleString()} (
                            {appliedPromo.discount_percentage}%)
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-3xl font-bold">₦{pack.price.toLocaleString()}</span>
                          <span className="text-muted-foreground text-sm"> one-time</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1">
                    <ul className="space-y-2 text-sm flex-1 mb-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-500" /> {pack.credits} Credits
                      </li>
                      <li className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary" /> Valid {pack.validity_days} Days
                      </li>
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" /> Full detailed reports
                      </li>
                      <li className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-primary" /> Monthly monitoring summary
                      </li>
                    </ul>
                    {appliedPromo && !promoApplies && (
                      <p className="mb-2 text-xs text-amber-600">
                        Promo code applies to {appliedPromo.credit_pack_name ?? "another pack"} only.
                      </p>
                    )}
                    <Button
                      size="lg"
                      variant={i === 1 ? "default" : "outline"}
                      onClick={() => handlePurchase(pack)}
                      disabled={purchasing === pack.id || activating || Boolean(appliedPromo && !promoApplies)}
                      className="w-full mt-auto"
                    >
                      {purchasing === pack.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                      {purchasing === pack.id ? "Preparing…" : `Buy ${packDisplayName(pack.name)}`}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
              );
            }))}
        </div>

        {/* Pending order payment card */}
        {pendingOrder && (
          <Card className="mb-10 border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-primary" />
                Complete Your Payment
              </CardTitle>
              <CardDescription>
                Pay <strong>₦{pendingOrder.amount.toLocaleString()}</strong> (incl. 7.5% VAT) for {pendingOrder.pack_name} securely via
                Paystack — your credits activate instantly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-card p-4 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{pendingOrder.pack_name}:</span>
                  <span>₦{Math.round(pendingOrder.amount - (pendingOrder.vat_amount ?? 0)).toLocaleString()}</span>
                </div>
                {pendingOrder.discount_amount ? (
                  <div className="flex justify-between text-emerald-600">
                    <span>
                      Promo discount
                      {pendingOrder.discount_percentage
                        ? ` (${pendingOrder.discount_percentage}%)`
                        : ""}
                      :
                    </span>
                    <span>-₦{pendingOrder.discount_amount.toLocaleString()}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (7.5%):</span>
                  <span>₦{(pendingOrder.vat_amount ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-primary/10 pt-1.5 mt-1.5">
                  <span>Total Payable:</span>
                  <span className="text-primary">₦{pendingOrder.amount.toLocaleString()}</span>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">Your order reference</p>
                  <p className="font-mono font-semibold text-lg truncate">{pendingOrder.reference}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => copyReference(pendingOrder.reference)} className="shrink-0">
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-1 text-green-500" /> : <Copy className="w-4 h-4 mr-1" />}
                  {copied ? "Copied" : "Copy Reference"}
                </Button>
              </div>

              <Button
                onClick={() => {
                  if (activationFailed && pendingOrder.reference) {
                    const amountKobo = Math.round(pendingOrder.amount * 100);
                    activatePack(pendingOrder.reference, amountKobo);
                    return;
                  }
                  const retryPack = packs.find((p) => p.id === pendingOrder.pack_id);
                  if (retryPack) {
                    handlePurchase(retryPack);
                  } else {
                    toast({
                      title: "Pack Unavailable",
                      description: "This pack is no longer available. Please pick another pack.",
                      variant: "destructive",
                    });
                  }
                }}
                disabled={activating || purchasing !== null}
                size="lg"
                className="w-full bg-[#0ba4db] hover:bg-[#0993c5] text-white font-semibold"
              >
                {activating || purchasing !== null ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Preparing payment…
                  </>
                ) : activationFailed ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2" />
                    Retry Activation
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5 mr-2" />
                    Pay ₦{pendingOrder.amount.toLocaleString()} with Paystack
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground">
                {activationFailed ? (
                  <>
                    Your payment went through but the credits weren't confirmed. Tap <strong>Retry Activation</strong> to finish
                    activating — you won't be charged again.
                  </>
                ) : (
                  <>
                    Supports debit/credit cards, bank transfer, USSD, and mobile money.
                    <br />
                    Your credits activate instantly after payment. Prefer manual transfer? Use your reference as the deposit
                    narration in the <Link to="/dashboard/wallets" className="text-primary underline">Wallets</Link> page.
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        )}



        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Prefer unlimited access?</p>
          <Button asChild size="lg">
            <Link to="/subscribe">
              Platform Subscription — from ₦38,250/month <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Unlimited checks · Weekly monitoring · Financial Health Timeline · Unlimited reports · Priority support
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default AuditorPacks;
