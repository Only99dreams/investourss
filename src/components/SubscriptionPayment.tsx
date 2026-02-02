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
      price: 1613,
      period: 'month',
      savings: null
    },
    quarterly: {
      name: 'Premium Quarterly',
      price: 4300,
      period: '3 months',
      savings: 'Save ₦539'
    },
    annual: {
      name: 'Premium Annual',
      price: 16125,
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

  // Calculate discounted price
  const getDiscountedPrice = () => {
    if (appliedPromo && planType === 'annual') {
      const discount = (currentPlan.price * appliedPromo.discount_percentage) / 100;
      return Math.max(0, currentPlan.price - discount);
    }
    return currentPlan.price;
  };

  const discountedPrice = getDiscountedPrice();

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
                    ₦{discountedPrice.toLocaleString()} / {currentPlan.period}
                    {appliedPromo && (
                      <span className="block text-green-600 font-medium">
                        (₦{currentPlan.price.toLocaleString()} - {appliedPromo.discount_percentage}% discount)
                      </span>
                    )}
                  </p>
                </div>
                {currentPlan.savings && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {currentPlan.savings}
                  </Badge>
                )}
                {appliedPromo && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {appliedPromo.discount_percentage}% OFF
                  </Badge>
                )}
              </div>
            </div>

            <ManualDepositForm
              narration={`Premium subscription - ${planType}${appliedPromo ? ` (${appliedPromo.code})` : ''}`}
              prefillAmount={discountedPrice}
              onSuccess={() => {
                toast({
                  title: "Payment Submitted",
                  description: "Your payment proof has been uploaded. We'll review it and activate your subscription within 24 hours.",
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
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-lg p-6 border border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">{currentPlan.name}</h3>
                <p className="text-muted-foreground">
                  ₦{currentPlan.price.toLocaleString()} / {currentPlan.period}
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Unlimited AI Tutor access
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Premium educational content
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Priority support
                  </li>
                </ul>
              </div>
              {currentPlan.savings && (
                <Badge className="bg-accent text-accent-foreground">
                  {currentPlan.savings}
                </Badge>
              )}
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

              {appliedPromo && (
                <div className="mt-3 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Original Price:</span>
                    <span>₦{currentPlan.price.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-medium text-green-600">
                    <span>Discount ({appliedPromo.discount_percentage}%):</span>
                    <span>-₦{((currentPlan.price * appliedPromo.discount_percentage) / 100).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-1 mt-1">
                    <span>Total:</span>
                    <span>₦{discountedPrice.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Method Selection */}
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