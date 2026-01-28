import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Crown, CreditCard, Banknote, CheckCircle } from 'lucide-react';
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

  const planDetails = {
    monthly: {
      name: 'Premium Monthly',
      price: 1500,
      period: 'month',
      savings: null
    },
    quarterly: {
      name: 'Premium Quarterly',
      price: 4000,
      period: '3 months',
      savings: 'Save ₦500'
    },
    annual: {
      name: 'Premium Annual',
      price: 15000,
      period: 'year',
      savings: 'Save ₦3,000'
    }
  };

  const currentPlan = planDetails[planType];

  const handlePaymentMethodSelect = (method: 'card' | 'bank_transfer') => {
    setSelectedPaymentMethod(method);
    if (method === 'bank_transfer') {
      setShowBankTransferForm(true);
    }
  };

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
                    ₦{currentPlan.price.toLocaleString()} / {currentPlan.period}
                  </p>
                </div>
                {currentPlan.savings && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {currentPlan.savings}
                  </Badge>
                )}
              </div>
            </div>

            <ManualDepositForm
              narration={`Premium subscription - ${planType}`}
              prefillAmount={currentPlan.price}
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