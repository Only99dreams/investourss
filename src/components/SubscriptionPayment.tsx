import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Crown, CreditCard, Banknote, CheckCircle, Tag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { ManualDepositForm } from './ManualDepositForm';

interface SubscriptionPaymentProps {
  planType: 'monthly' | 'quarterly' | 'annual';
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const SubscriptionPayment: React.FC<SubscriptionPaymentProps> = ({
  planType,
  onSuccess,
  onCancel
}) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'card' | 'bank_transfer'>('bank_transfer');
  const [showBankTransferForm, setShowBankTransferForm] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [promoLoading, setPromoLoading] = useState(false);

  const planDetails = {
    monthly: {
      name: 'Premium Monthly',
      price: 1500, // Base price excluding VAT
      period: 'month',
      savings: null
    },
    quarterly: {
      name: 'Premium Quarterly',
      price: 4000, // Base price excluding VAT
      period: '3 months',
      savings: 'Save ₦539'
    },
    annual: {
      name: 'Premium Annual',
      price: 15000, // Base price excluding VAT
      period: 'year',
      savings: 'Save ₦3,231'
    }
  };

  const currentPlan = planDetails[planType];

  const handlePaymentMethodSelect = (method: 'card' | 'bank_transfer') => {
    setSelectedPaymentMethod(method);
    if (method === 'bank_transfer') {
      setShowBankTransferForm(true);
    }
  };

  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter a promo code",
        variant: "destructive"
      });
      return;
    }

    setPromoLoading(true);
    try {
      const { data, error } = await supabase.rpc('validate_promo_code', {
        p_code: promoCode.toUpperCase(),
        p_user_id: user?.id,
        p_plan_type: planType
      });

      if (error) throw error;

      if (data.valid) {
        setAppliedPromo({
          code: promoCode.toUpperCase(),
          discount_percentage: data.discount_percentage,
          promo_code_id: data.promo_code_id
        });
        toast({
          title: "Promo Code Applied!",
          description: `${data.discount_percentage}% discount applied to your subscription`,
        });
      } else {
        toast({
          title: "Invalid Promo Code",
          description: data.message,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to validate promo code",
        variant: "destructive"
      });
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromoCode = () => {
    setAppliedPromo(null);
    setPromoCode('');
  };

  // Calculate pricing with VAT and promo codes
  const calculatePricing = () => {
    const basePrice = currentPlan.price;
    const vatRate = 0.075; // 7.5% VAT
    const vatAmount = basePrice * vatRate;
    const subtotal = basePrice + vatAmount;

    let discountAmount = 0;
    let finalTotal = subtotal;

    if (appliedPromo) {
      if (appliedPromo.discount_percentage === 100) {
        // 100% discount: Free subscription
        discountAmount = subtotal;
        finalTotal = 0;
      } else if (appliedPromo.discount_percentage > 0) {
        // Regular discount applied to subtotal (price + VAT)
        discountAmount = (subtotal * appliedPromo.discount_percentage) / 100;
        finalTotal = Math.max(0, subtotal - discountAmount);
      }
    }

    return {
      basePrice,
      vatAmount,
      subtotal,
      discountAmount,
      finalTotal,
      isFree: appliedPromo?.discount_percentage === 100
    };
  };

  const pricing = calculatePricing();

  if (showBankTransferForm) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => setShowBankTransferForm(false)}
          >
            ← Back to Payment Options
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              {currentPlan.name} Subscription
            </CardTitle>
            <CardDescription>
              Complete your bank transfer to activate your premium subscription
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-primary/10 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{currentPlan.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    ₦{pricing.finalTotal.toLocaleString()} / {currentPlan.period}
                    {appliedPromo && pricing.discountAmount > 0 && (
                      <span className="block text-green-600 font-medium">
                        ({appliedPromo.discount_percentage}% discount applied)
                      </span>
                    )}
                    {pricing.isFree && (
                      <span className="block text-green-600 font-medium">
                        (100% discount - Free subscription!)
                      </span>
                    )}
                  </p>
                </div>
                {currentPlan.savings && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {currentPlan.savings}
                  </Badge>
                )}
                {appliedPromo && !pricing.isFree && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {appliedPromo.discount_percentage}% OFF
                  </Badge>
                )}
                {pricing.isFree && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    FREE
                  </Badge>
                )}
              </div>
            </div>

            <ManualDepositForm
              narration={`Premium subscription - ${planType}${appliedPromo ? ` (${appliedPromo.code})` : ''}`}
              prefillAmount={pricing.finalTotal}
              onSuccess={() => {
                toast({
                  title: pricing.isFree ? "Subscription Activated!" : "Payment Submitted",
                  description: pricing.isFree 
                    ? "Your premium subscription has been activated for free!"
                    : "Your payment proof has been uploaded. We'll review it and activate your subscription within 24 hours.",
                });
                onSuccess?.();
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Upgrade to Premium
          </CardTitle>
          <CardDescription>
            Choose your payment method to activate your premium subscription
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Plan Summary */}
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-lg p-4 sm:p-6 border border-primary/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-primary">{currentPlan.name}</h3>
                <ul className="mt-3 space-y-1 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    Unlimited AI Tutor access
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    Premium educational content
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    Priority support
                  </li>
                </ul>
              </div>
              <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2">
                {currentPlan.savings && (
                  <Badge className="bg-accent text-accent-foreground">
                    {currentPlan.savings}
                  </Badge>
                )}
              </div>
            </div>

            {/* Pricing Breakdown */}
            <div className="mt-4 pt-4 border-t border-primary/10 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base Price:</span>
                <span>₦{pricing.basePrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT (7.5%):</span>
                <span>₦{Math.round(pricing.vatAmount).toLocaleString()}</span>
              </div>
              {appliedPromo && pricing.discountAmount > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Discount ({appliedPromo.discount_percentage}%):</span>
                  <span>-₦{Math.round(pricing.discountAmount).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base sm:text-lg border-t border-primary/10 pt-2 mt-2">
                <span>Total:</span>
                <span className="text-primary">₦{Math.round(pricing.finalTotal).toLocaleString()} / {currentPlan.period}</span>
              </div>
            </div>
          </div>

          {/* Promo Code Section */}
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
                  <Button
                    variant="outline"
                    onClick={validatePromoCode}
                    disabled={promoLoading || !promoCode.trim()}
                  >
                    {promoLoading ? "Applying..." : "Apply"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-green-50 p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">
                      {appliedPromo.code} - {appliedPromo.discount_percentage}% discount applied
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={removePromoCode}
                    className="text-green-600 hover:text-green-800"
                  >
                    Remove
                  </Button>
                </div>
              )}


            </div>

            {/* Payment Method Selection */}
            {!pricing.isFree && (
              <div className="space-y-4">
                <h4 className="font-semibold">Choose Payment Method</h4>

                <div className="grid gap-3">
                  {/* Bank Transfer Option */}
                  <div
                    className={cn(
                      "border rounded-lg p-4 cursor-pointer transition-all",
                      selectedPaymentMethod === 'bank_transfer'
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => handlePaymentMethodSelect('bank_transfer')}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                        selectedPaymentMethod === 'bank_transfer'
                          ? "border-primary"
                          : "border-muted-foreground"
                      )}>
                        {selectedPaymentMethod === 'bank_transfer' && (
                          <div className="w-2 h-2 bg-primary rounded-full" />
                        )}
                      </div>
                      <Banknote className="h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <h5 className="font-medium">Bank Transfer</h5>
                        <p className="text-sm text-muted-foreground">
                          Transfer directly to our account and upload proof of payment
                        </p>
                      </div>
                      <Badge variant="secondary">Recommended</Badge>
                    </div>
                  </div>

                  {/* Card Payment Option (Coming Soon) */}
                  <div className="border rounded-lg p-4 opacity-50 cursor-not-allowed">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <h5 className="font-medium">Card Payment</h5>
                        <p className="text-sm text-muted-foreground">
                          Pay with debit/credit card (Coming Soon)
                        </p>
                      </div>
                      <Badge variant="outline">Coming Soon</Badge>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Free Subscription Activation */}
            {pricing.isFree && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <h4 className="font-semibold text-green-800">Free Subscription Available!</h4>
                      <p className="text-sm text-green-700">
                        Your 100% discount promo code makes this subscription completely free.
                        Click below to activate your premium subscription immediately.
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={async () => {
                    try {
                      // Directly activate subscription for free
                      const { error } = await supabase.rpc('activate_free_subscription', {
                        p_user_id: user?.id,
                        p_plan_type: planType,
                        p_promo_code_id: appliedPromo.promo_code_id
                      });

                      if (error) throw error;

                      toast({
                        title: "Subscription Activated!",
                        description: "Your premium subscription has been activated for free!",
                      });
                      onSuccess?.();
                    } catch (error: any) {
                      toast({
                        title: "Error",
                        description: error.message || "Failed to activate subscription",
                        variant: "destructive"
                      });
                    }
                  }}
                  className="w-full bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  Activate Free Subscription
                  <CheckCircle className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          <strong>Note:</strong> Your subscription will be activated within 24 hours after we verify your payment.
          You'll receive a confirmation email once your premium access is enabled.
        </AlertDescription>
      </Alert>
    </div>
  );
};