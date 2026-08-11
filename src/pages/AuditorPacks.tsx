import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { usePaystackPayment } from "react-paystack";
import {
  CreditCard, Check, ArrowRight, Loader2, Coins, Clock, Info, Sparkles, Banknote, Copy, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { DEFAULT_ACCESS, type AuditAccess } from "@/lib/auditor";
import { cn } from "@/lib/utils";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string;

interface CreditPack {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price: number;
  validity_days: number;
  sort_order: number;
}

interface PackOrder {
  id: string;
  pack_id: string;
  pack_name: string;
  credits: number;
  amount: number;
  reference: string;
  status: string;
  created_at: string;
}

interface PaystackTransaction {
  reference?: string;
}

const AuditorPacks = () => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [orders, setOrders] = useState<PackOrder[]>([]);
  const [access, setAccess] = useState<AuditAccess>(DEFAULT_ACCESS);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<PackOrder | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [packsRes, ordersRes, accessRes] = await Promise.all([
        supabase.from("audit_credit_packs").select("id,name,description,credits,price,validity_days,sort_order").order("sort_order"),
        supabase
          .from("user_credit_packs")
          .select("id,pack_name,credits,amount,reference,status,created_at")
          .order("created_at", { ascending: false }),
        supabase.rpc("get_audit_access"),
      ]);
      if (packsRes.error) throw packsRes.error;
      if (ordersRes.error) throw ordersRes.error;
      if (accessRes.error) throw accessRes.error;

      setPacks((packsRes.data ?? []) as CreditPack[]);
      setOrders((ordersRes.data ?? []) as PackOrder[]);
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

  const activatePack = async (reference: string, amountKobo: number) => {
    if (!user) return;
    setActivating(true);
    try {
      const { error } = await supabase.rpc("activate_audit_pack_payment", {
        p_user_id: user.id,
        p_reference: reference,
        p_amount_kobo: amountKobo,
      });
      if (error) throw error;

      toast({ title: "Audit Credits Activated!", description: "Your audit credits have been added to your account." });
      setPendingOrder(null);
      await loadData();
    } catch (err) {
      toast({
        title: "Activation Failed",
        description: err instanceof Error ? err.message : "Payment received but activation failed. Please contact support.",
        variant: "destructive",
      });
    } finally {
      setActivating(false);
    }
  };

  const handlePurchase = async (pack: CreditPack) => {
    setPurchasing(pack.id);
    try {
      const { data, error } = await supabase.rpc("purchase_audit_pack", { p_pack_id: pack.id });
      if (error) throw error;
      const result = data as { success: boolean; message?: string; order_id?: string; reference?: string; pack_name?: string; amount?: number; credits?: number };
      if (!result?.success) throw new Error(result?.message || "Purchase failed");

      const reference = result.reference ?? "";
      const amount = result.amount ?? pack.price;
      const amountKobo = Math.round(amount * 100); // Paystack uses kobo

      setPendingOrder({
        id: result.order_id ?? "",
        pack_id: pack.id,
        pack_name: result.pack_name ?? pack.name,
        credits: result.credits ?? pack.credits,
        amount,
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
              ? "Active subscription — audits unlimited"
              : `${access.credits_remaining} credits available`}
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Audit Credit Packs</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Pay-as-you-go credits for on-demand AI financial audits. Manual audits consume one
            credit each — automatic monitoring never consumes credits.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 mb-10">
          {loading ? (
            <div className="col-span-3 flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            packs.map((pack, i) => (
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
                    <CardTitle>{pack.name}</CardTitle>
                    <CardDescription>{pack.description}</CardDescription>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">₦{pack.price.toLocaleString()}</span>
                      <span className="text-muted-foreground text-sm"> one-time</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1">
                    <ul className="space-y-2 text-sm flex-1 mb-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-500" /> {pack.credits} Audit Credits
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
                    <Button
                      size="lg"
                      variant={i === 1 ? "default" : "outline"}
                      onClick={() => handlePurchase(pack)}
                      disabled={purchasing === pack.id || activating}
                      className="w-full mt-auto"
                    >
                      {purchasing === pack.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                      {purchasing === pack.id ? "Preparing…" : `Buy ${pack.name}`}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
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
                Pay <strong>₦{pendingOrder.amount.toLocaleString()}</strong> for {pendingOrder.pack_name} securely via
                Paystack — your credits activate instantly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                ) : (
                  <>
                    <CreditCard className="h-5 w-5 mr-2" />
                    Pay ₦{pendingOrder.amount.toLocaleString()} with Paystack
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground">
                Supports debit/credit cards, bank transfer, USSD, and mobile money.
                <br />
                Your credits activate instantly after payment. Prefer manual transfer? Use your reference as the deposit
                narration in the <Link to="/dashboard/wallets" className="text-primary underline">Wallets</Link> page.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Orders list */}
        {orders.length > 0 && (
          <Card className="mb-10">
            <CardHeader>
              <CardTitle className="text-base">Your Pack Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card/40">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{o.pack_name} · {o.credits} credits</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{o.reference}</p>
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-sm font-semibold">₦{o.amount.toLocaleString()}</p>
                    <Badge variant={o.status === "active" ? "default" : o.status === "pending" ? "outline" : "secondary"} className="text-xs capitalize">
                      {o.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Prefer unlimited access?</p>
          <Button asChild size="lg">
            <Link to="/subscribe">
              Platform Subscription — from ₦4,500/month <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Unlimited audits · Weekly monitoring · Financial Health Timeline · Unlimited reports · Priority support
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default AuditorPacks;
