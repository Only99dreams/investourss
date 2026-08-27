import React, { useState, useCallback } from 'react';
import { usePaystackPayment } from 'react-paystack';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Crown, CreditCard, CheckCircle, Tag, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface SubscriptionPaymentProps {
  planType: 'monthly' | 'quarterly' | 'biennial' | 'annual' | 'b2b_quarterly';
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface AppliedPromo {
  code: string;
  discount_percentage: number;
  promo_code_id: string;
}

interface PaystackTransaction {
  reference?: string;
}

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string;

const planDetails = {
  monthly:    { name: 'Premium Monthly',    price: 4500,   period: 'month',    savings: null },
  quarterly:  { name: 'Premium Quarterly',  price: 12000,  period: '3 months', savings: 'Save ₦1,500' },
  biennial:   { name: 'Premium Bi-annual',  price: 22500,  period: '6 months', savings: 'Save ₦4,500' },
  annual:     { name: 'Premium Annual',     price: 45000,  period: 'year',     savings: 'Save ₦9,000' },
  b2b_quarterly: { name: 'B2B Plan',         price: 360000, period: '3 months', savings: null },
};

// Generates a unique Paystack reference
function generateReference(userId: string, planType: string) {
  return `INV-${planType.toUpperCase()}-${userId.slice(0, 8)}-${Date.now()}`;
}

export const SubscriptionPayment: React.FC<SubscriptionPaymentProps> = ({
  planType,
  onSuccess,
  onCancel,
}) => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  const currentPlan = planDetails[planType];

  // ── Automatic confirmation ──────────────────────────────────────────────
  // If the client-side activation call fails, the Paystack webhook
  // (charge.success) still activates the subscription server-side. Poll the
  // profile until it reflects the activation (or time out) so the user is
  // updated automatically — no manual retry needed.
  const waitForActivation = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const { data } = await supabase
        .from('profiles')
        .select('has_active_subscription')
        .eq('id', user?.id)
        .maybeSingle();
      if (data?.has_active_subscription) return true;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }, [user?.id]);

  // ── Pricing calculation ──────────────────────────────────────────────────
  const calculatePricing = () => {
    const basePrice = currentPlan.price;
    const vatRate = 0.075;
    let discountAmount = 0;
    let subtotalAfterDiscount = basePrice;

    if (appliedPromo) {
      if (appliedPromo.discount_percentage === 100) {
        discountAmount = basePrice;
        subtotalAfterDiscount = 0;
      } else if (appliedPromo.discount_percentage > 0) {
        discountAmount = (basePrice * appliedPromo.discount_percentage) / 100;
        subtotalAfterDiscount = Math.max(0, basePrice - discountAmount);
      }
    }

    const vatAmount = subtotalAfterDiscount * vatRate;
    const finalTotal = subtotalAfterDiscount + vatAmount;
    const finalTotalKobo = Math.round(finalTotal * 100); // Paystack uses kobo

    return {
      basePrice,
      discountAmount,
      subtotalAfterDiscount,
      vatAmount,
      finalTotal,
      finalTotalKobo,
      isFree: appliedPromo?.discount_percentage === 100,
    };
  };

  const pricing = calculatePricing();

  // ── Promo code ───────────────────────────────────────────────────────────
  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      toast({ title: 'Error', description: 'Please enter a promo code', variant: 'destructive' });
      return;
    }
    setPromoLoading(true);
    try {
      const { data, error } = await supabase.rpc('validate_promo_code', {
        p_code: promoCode.toUpperCase(),
        p_user_id: user?.id,
        p_plan_type: planType,
      });
      if (error) throw error;
      if (data.valid) {
        setAppliedPromo({
          code: promoCode.toUpperCase(),
          discount_percentage: data.discount_percentage,
          promo_code_id: data.promo_code_id,
        });
        toast({ title: 'Promo Code Applied!', description: `${data.discount_percentage}% discount applied.` });
      } else {
        toast({ title: 'Invalid Promo Code', description: data.message, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to validate promo code', variant: 'destructive' });
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromoCode = () => {
    setAppliedPromo(null);
    setPromoCode('');
  };

  // ── Activate subscription after payment ──────────────────────────────────
  const activateSubscription = useCallback(
    async (reference: string) => {
      if (!user) return;
      setActivating(true);
      try {
        const { data, error } = await supabase.rpc('activate_paystack_subscription', {
          p_user_id: user.id,
          p_reference: reference,
          p_plan_type: planType,
          p_amount_kobo: pricing.finalTotalKobo,
          p_promo_code_id: appliedPromo?.promo_code_id ?? null,
        });

        if (error) throw error;

        await refreshProfile();

        // Send subscription activated email (fire-and-forget)
        supabase.functions.invoke('send-notification', {
          body: {
            type: 'subscription_activated',
            recipient_id: user.id,
            plan_type: currentPlan.name,
          }
        }).catch(() => {});

        toast({
          title: '🎉 Subscription Activated!',
          description: `Your ${currentPlan.name} is now active. Enjoy premium access!`,
        });
        onSuccess?.();
      } catch (err) {
        const msg = err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message?: unknown }).message ?? '').trim()
            : '';
        toast({
          title: 'Activation Pending',
          description: `${msg || 'Payment received but activation failed.'} We're confirming your payment automatically…`,
          variant: 'destructive',
        });
        const ok = await waitForActivation();
        if (ok) {
          toast({
            title: '🎉 Subscription Activated!',
            description: `Your ${currentPlan.name} is now active. Enjoy premium access!`,
          });
          await refreshProfile();
          supabase.functions.invoke('send-notification', {
            body: {
              type: 'subscription_activated',
              recipient_id: user.id,
              plan_type: currentPlan.name,
            }
          }).catch(() => {});
          onSuccess?.();
        }
      } finally {
        setActivating(false);
      }
    },
    [user, planType, pricing.finalTotalKobo, appliedPromo, currentPlan.name, onSuccess, refreshProfile, toast, waitForActivation]
  );

  // ── Free subscription (100% promo) ───────────────────────────────────────
  const activateFreeSubscription = async () => {
    if (!user) return;
    setActivating(true);
    try {
      const { error } = await supabase.rpc('activate_free_subscription', {
        p_user_id: user.id,
        p_plan_type: planType,
        p_promo_code_id: appliedPromo.promo_code_id,
      });
      if (error) throw error;
      await refreshProfile();
      // Send subscription activated email (fire-and-forget)
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'subscription_activated',
          recipient_id: user.id,
          plan_type: currentPlan.name,
        }
      }).catch(() => {});
      toast({ title: 'Subscription Activated!', description: 'Your premium subscription is now active for free!' });
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to activate subscription', variant: 'destructive' });
    } finally {
      setActivating(false);
    }
  };

  // ── Paystack config ───────────────────────────────────────────────────────
  const reference = generateReference(user?.id ?? 'guest', planType);

  const paystackConfig = {
    reference,
    email: profile?.email ?? user?.email ?? '',
    amount: pricing.finalTotalKobo,
    publicKey: PAYSTACK_PUBLIC_KEY,
    currency: 'NGN',
    metadata: {
      user_id: user?.id ?? '',
      payment_type: 'subscription',
      plan_type: planType,
      promo_code_id: appliedPromo?.promo_code_id ?? null,
      custom_fields: [
        { display_name: 'Plan', variable_name: 'plan_type', value: planType },
        { display_name: 'User ID', variable_name: 'user_id', value: user?.id ?? '' },
      ],
    },
  };

  const initializePayment = usePaystackPayment(paystackConfig);

  const handlePayWithPaystack = () => {
    if (!user) {
      toast({ title: 'Login Required', description: 'Please log in to continue.', variant: 'destructive' });
      return;
    }
    initializePayment({
      onSuccess: (transaction: PaystackTransaction) => {
        activateSubscription(transaction.reference ?? reference);
      },
      onClose: () => {
        toast({ title: 'Payment Cancelled', description: 'You closed the payment window.' });
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Upgrade to {currentPlan.name}
          </CardTitle>
          <CardDescription>
            Secure payment powered by Paystack — cards, bank transfer, USSD & more.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── Plan summary ── */}
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-lg p-4 sm:p-6 border border-primary/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-primary">{currentPlan.name}</h3>
                <ul className="mt-3 space-y-1 text-sm">
                  {[
                    'Unlimited AI Business Plan Generator',
                    'Unlimited AI Financial Tutor access',
                    'Unlimited Scam Detector access',
                    'Premium educational content',
                    'Priority support',
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              {currentPlan.savings && (
                <Badge className="bg-accent text-accent-foreground self-start sm:self-auto">
                  {currentPlan.savings}
                </Badge>
              )}
            </div>

            {/* Pricing breakdown */}
            <div className="mt-4 pt-4 border-t border-primary/10 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{currentPlan.name}:</span>
                <span>₦{pricing.basePrice.toLocaleString()}</span>
              </div>
              {appliedPromo && pricing.discountAmount > 0 && (
                <>
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Promo Discount ({appliedPromo.discount_percentage}%):</span>
                    <span>-₦{Math.round(pricing.discountAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-primary/10 pt-1.5 mt-1.5">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>₦{Math.round(pricing.subtotalAfterDiscount).toLocaleString()}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT (7.5%):</span>
                <span>₦{Math.round(pricing.vatAmount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold text-base sm:text-lg border-t border-primary/10 pt-2 mt-2">
                <span>Total Payable:</span>
                <span className="text-primary">
                  ₦{Math.round(pricing.finalTotal).toLocaleString()} / {currentPlan.period}
                </span>
              </div>
            </div>
          </div>

          {/* ── Promo code ── */}
          <div className="bg-muted/50 rounded-lg p-4 border">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-4 w-4 text-primary" />
              <Label className="font-semibold">Promo Code</Label>
              {appliedPromo && (
                <Badge variant="secondary" className="bg-green-100 text-green-800">
                  {appliedPromo.discount_percentage}% OFF
                </Badge>
              )}
            </div>
            {!appliedPromo ? (
              <div className="flex gap-2">
                <Input
                  placeholder="Enter promo code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="flex-1"
                  disabled={promoLoading}
                />
                <Button variant="outline" onClick={validatePromoCode} disabled={promoLoading || !promoCode.trim()}>
                  {promoLoading ? 'Applying…' : 'Apply'}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-green-50 p-3 rounded-lg border border-green-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-800">
                    {appliedPromo.code} — {appliedPromo.discount_percentage}% discount applied
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={removePromoCode} className="text-green-600 hover:text-green-800">
                  Remove
                </Button>
              </div>
            )}
          </div>

          {/* ── Free subscription (100% promo) ── */}
          {pricing.isFree ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <h4 className="font-semibold text-green-800">Free Subscription Available!</h4>
                    <p className="text-sm text-green-700">
                      Your 100% discount promo code makes this subscription completely free.
                    </p>
                  </div>
                </div>
              </div>
              <Button
                onClick={activateFreeSubscription}
                disabled={activating}
                className="w-full bg-green-600 hover:bg-green-700"
                size="lg"
              >
                {activating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Activate Free Subscription
              </Button>
            </div>
          ) : (
            /* ── Paystack payment button ── */
            <div className="space-y-4">
              <h4 className="font-semibold">Pay Now</h4>

              <Button
                onClick={handlePayWithPaystack}
                disabled={activating}
                size="lg"
                className="w-full bg-[#0ba4db] hover:bg-[#0993c5] text-white font-semibold"
              >
                {activating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Activating…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5 mr-2" />
                    Pay ₦{Math.round(pricing.finalTotal).toLocaleString()} with Paystack
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Supports debit/credit cards, bank transfer, USSD, and mobile money.
                <br />
                Your subscription activates instantly after payment.
              </p>

              {/* Paystack trust badges */}
              <div className="flex items-center justify-center gap-3 pt-1">
                <img
                  src="https://website-v3-assets.s3.amazonaws.com/assets/img/hero/Paystack-mark-white-twitter.png"
                  alt="Paystack"
                  className="h-5 opacity-60"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-muted-foreground">Secured by Paystack</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          <strong>Instant activation:</strong> Your premium subscription is activated immediately after a successful payment — no waiting for manual review.
        </AlertDescription>
      </Alert>
    </div>
  );
};
