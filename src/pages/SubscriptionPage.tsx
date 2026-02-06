import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, Check, Shield, Sparkles, Star, ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { SubscriptionPayment } from '@/components/SubscriptionPayment';
import Header from '@/components/Header';
import { Footer } from '@/components/ui/Footer';
import { cn } from '@/lib/utils';

const planHierarchy: Record<string, number> = {
  monthly: 1,
  quarterly: 2,
  annual: 3,
};

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'quarterly' | 'annual' | null>(null);

  const currentSubType = profile?.subscription_type || null;
  const currentPlanLevel = currentSubType ? planHierarchy[currentSubType] || 0 : 0;
  const isPremium = profile?.user_tier === 'premium' || profile?.user_tier === 'exclusive';
  const isUpgrading = isPremium && currentSubType !== 'annual';

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Only redirect if user is already on the highest plan (annual)
    if (isPremium && currentSubType === 'annual') {
      navigate('/dashboard');
      return;
    }

    // Get plan from URL params
    const planParam = searchParams.get('plan');
    if (planParam) {
      if (planParam.includes('monthly')) {
        setSelectedPlan('monthly');
      } else if (planParam.includes('quarterly')) {
        setSelectedPlan('quarterly');
      } else if (planParam.includes('annual')) {
        setSelectedPlan('annual');
      }
    }
  }, [user, profile, searchParams, navigate, isPremium, currentSubType]);

  const handlePaymentSuccess = () => {
    navigate('/dashboard');
  };

  const handleCancel = () => {
    navigate('/pricing');
  };

  // Only block if annual subscriber (highest tier) or not logged in
  if (!user || (isPremium && currentSubType === 'annual')) {
    return null;
  }

  if (selectedPlan) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Button
              variant="ghost"
              onClick={() => setSelectedPlan(null)}
              className="mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Plan Selection
            </Button>
          </motion.div>

          <SubscriptionPayment
            planType={selectedPlan}
            onSuccess={handlePaymentSuccess}
            onCancel={handleCancel}
          />
        </main>
        <Footer />
      </div>
    );
  }

  const plans = [
    {
      key: 'monthly' as const,
      name: 'Monthly Plan',
      description: 'Perfect for getting started',
      price: 1500,
      period: 'month',
      savings: null,
      icon: Crown,
      featured: false,
      features: [
        'Unlimited AI Tutor access',
        'Premium educational content',
        'Priority support',
        'Cancel anytime',
      ],
    },
    {
      key: 'quarterly' as const,
      name: 'Quarterly Plan',
      description: 'Best value for committed learners',
      price: 4000,
      period: '3 months',
      savings: 'Save ₦500',
      icon: Star,
      featured: true,
      features: [
        'All Monthly features',
        '11% savings vs monthly',
        'Extended support period',
        'Priority feature access',
      ],
    },
    {
      key: 'annual' as const,
      name: 'Annual Plan',
      description: 'Maximum savings for power users',
      price: 15000,
      period: 'year',
      savings: 'Save ₦3,000',
      icon: Shield,
      featured: false,
      features: [
        'All Quarterly features',
        '17% savings vs monthly',
        'VIP support',
        'Early access to new features',
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 md:py-16 max-w-5xl">
        {/* Upgrade Banner for existing subscribers */}
        {isUpgrading && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Alert className="border-primary/30 bg-primary/5">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              <AlertDescription className="text-sm sm:text-base">
                You're currently on the <strong className="capitalize">{currentSubType}</strong> plan.
                Upgrade to a higher plan to unlock more savings and benefits!
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8 sm:mb-12"
        >
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            {isUpgrading ? 'Upgrade Your Plan' : 'Choose Your Premium Plan'}
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            {isUpgrading
              ? 'Switch to a longer plan for bigger savings and better benefits'
              : 'Unlock unlimited access to AI tools, premium content, and priority support'
            }
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            const vatAmount = Math.round(plan.price * 0.075);
            const totalWithVat = plan.price + vatAmount;
            const planLevel = planHierarchy[plan.key];
            const isCurrentPlan = isPremium && currentSubType === plan.key;
            const isLowerPlan = isPremium && planLevel <= currentPlanLevel;
            const isUpgradeable = !isCurrentPlan && !isLowerPlan;

            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * (index + 1) }}
                className={cn(
                  plan.featured && 'sm:col-span-2 lg:col-span-1',
                  'flex'
                )}
              >
                <Card className={cn(
                  'flex flex-col w-full transition-all duration-200',
                  isCurrentPlan
                    ? 'border-2 border-green-500 bg-green-50/30 shadow-md'
                    : isLowerPlan
                    ? 'border opacity-60'
                    : plan.featured
                    ? 'border-2 border-primary shadow-lg relative hover:shadow-xl'
                    : 'border hover:border-primary/50 hover:shadow-lg'
                )}>
                  {/* Badges */}
                  {isCurrentPlan && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                      <Badge className="bg-green-600 text-white px-3 py-1 text-xs font-semibold shadow-md">
                        CURRENT PLAN
                      </Badge>
                    </div>
                  )}
                  {!isCurrentPlan && plan.featured && !isLowerPlan && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                      <Badge className="bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold shadow-md">
                        RECOMMENDED
                      </Badge>
                    </div>
                  )}
                  {!isCurrentPlan && isUpgrading && isUpgradeable && !plan.featured && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                      <Badge className="bg-blue-600 text-white px-3 py-1 text-xs font-semibold shadow-md">
                        UPGRADE
                      </Badge>
                    </div>
                  )}

                  <CardHeader className={cn('text-center', (plan.featured || isCurrentPlan || (isUpgrading && isUpgradeable)) && 'pt-8')}>
                    <CardTitle className="flex items-center justify-center gap-2 text-lg sm:text-xl">
                      <Icon className="h-5 w-5 text-primary shrink-0" />
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="text-sm">{plan.description}</CardDescription>
                    <div className="mt-4 space-y-1">
                      <div>
                        <span className="text-3xl sm:text-4xl font-bold">₦{plan.price.toLocaleString()}</span>
                        <span className="text-muted-foreground text-sm"> / {plan.period}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        + ₦{vatAmount.toLocaleString()} VAT (7.5%) = <span className="font-semibold text-foreground">₦{totalWithVat.toLocaleString()}</span> at checkout
                      </div>
                      {plan.savings && (
                        <div className="text-sm text-green-600 font-semibold">{plan.savings}</div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1 space-y-4">
                    <ul className="space-y-2.5 text-sm flex-1">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {isCurrentPlan ? (
                      <Button
                        className="w-full mt-auto bg-green-600 hover:bg-green-600 cursor-default"
                        size="lg"
                        disabled
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Your Current Plan
                      </Button>
                    ) : isLowerPlan ? (
                      <Button
                        className="w-full mt-auto"
                        size="lg"
                        variant="outline"
                        disabled
                      >
                        Lower Plan
                      </Button>
                    ) : (
                      <Button
                        className={cn(
                          'w-full mt-auto',
                          isUpgrading
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : plan.featured
                            ? 'bg-primary hover:bg-primary/90'
                            : ''
                        )}
                        size="lg"
                        onClick={() => setSelectedPlan(plan.key)}
                      >
                        {isUpgrading ? (
                          <>
                            <ArrowUpCircle className="h-4 w-4 mr-2" />
                            Upgrade to {plan.name}
                          </>
                        ) : (
                          <>Select {plan.name}</>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center mt-8 sm:mt-12"
        >
          <p className="text-xs text-muted-foreground mb-4">
            All prices are exclusive of 7.5% VAT. VAT will be calculated and shown at checkout.
          </p>
          <Button variant="outline" onClick={() => navigate('/pricing')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Pricing
          </Button>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
};

export default SubscriptionPage;