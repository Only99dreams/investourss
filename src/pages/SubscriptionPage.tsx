import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { SubscriptionPayment } from '@/components/SubscriptionPayment';
import Header from '@/components/Header';
import { Footer } from '@/components/ui/Footer';

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'quarterly' | 'annual' | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Check if user is already premium
    if (profile?.user_tier === 'premium' || profile?.user_tier === 'exclusive') {
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
  }, [user, profile, searchParams, navigate]);

  const handlePaymentSuccess = () => {
    navigate('/dashboard');
  };

  const handleCancel = () => {
    navigate('/pricing');
  };

  if (!user || (profile?.user_tier === 'premium' || profile?.user_tier === 'exclusive')) {
    return null;
  }

  if (selectedPlan) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-4xl">
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-16 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            Choose Your Premium Plan
          </h1>
          <p className="text-xl text-muted-foreground">
            Unlock unlimited access to AI tools, premium content, and priority support
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Monthly Plan */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="h-full">
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />
                  Monthly Plan
                </CardTitle>
                <CardDescription>Perfect for getting started</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">₦1,500</span>
                  <span className="text-muted-foreground"> / month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  <li>• Unlimited AI Tutor access</li>
                  <li>• Premium educational content</li>
                  <li>• Priority support</li>
                  <li>• Cancel anytime</li>
                </ul>
                <Button
                  className="w-full"
                  onClick={() => setSelectedPlan('monthly')}
                >
                  Select Monthly Plan
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* Quarterly Plan */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="h-full border-primary shadow-lg relative">
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-semibold">
                  RECOMMENDED
                </span>
              </div>
              <CardHeader className="text-center pt-8">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />
                  Quarterly Plan
                </CardTitle>
                <CardDescription>Best value for committed learners</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">₦4,000</span>
                  <span className="text-muted-foreground"> / 3 months</span>
                  <div className="text-sm text-green-600 font-medium">Save ₦500</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  <li>• All Monthly features</li>
                  <li>• 25% savings vs monthly</li>
                  <li>• Extended support period</li>
                  <li>• Priority feature access</li>
                </ul>
                <Button
                  className="w-full"
                  onClick={() => setSelectedPlan('quarterly')}
                >
                  Select Quarterly Plan
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* Annual Plan */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="h-full">
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />
                  Annual Plan
                </CardTitle>
                <CardDescription>Maximum savings for power users</CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">₦15,000</span>
                  <span className="text-muted-foreground"> / year</span>
                  <div className="text-sm text-green-600 font-medium">Save ₦3,000</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  <li>• All Quarterly features</li>
                  <li>• 20% savings vs monthly</li>
                  <li>• VIP support</li>
                  <li>• Early access to new features</li>
                </ul>
                <Button
                  className="w-full"
                  onClick={() => setSelectedPlan('annual')}
                >
                  Select Annual Plan
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center mt-12"
        >
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