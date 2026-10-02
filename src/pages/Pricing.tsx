import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { 
  Check, 
  ArrowRight,
  Mail,
  Building2,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Footer } from "@/components/ui/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePaystackPayment } from "react-paystack";
import { useToast } from "@/hooks/use-toast";

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

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

const Pricing = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [b2bProcessing, setB2bProcessing] = useState(false);

  useEffect(() => {
    const fetchPacks = async () => {
      try {
        const { data, error } = await supabase
          .from("audit_credit_packs")
          .select("id,name,description,credits,price,validity_days,sort_order")
          .order("sort_order");
        if (error) throw error;
        setCreditPacks((data ?? []) as CreditPack[]);
      } catch (err) {
        console.error("Failed to fetch credit packs:", err);
      } finally {
        setPacksLoading(false);
      }
    };
    fetchPacks();
  }, []);

  // ── B2B Paystack ───────────────────────────────────────────────────────────
  const paystackHookConfig = {
    publicKey: PAYSTACK_PUBLIC_KEY,
    email: profile?.email ?? user?.email ?? "",
    currency: "NGN" as const,
  };
  const initializePayment = usePaystackPayment(paystackHookConfig);

  const handleB2BPayment = () => {
    if (!user) {
      toast({ title: "Login Required", description: "Please log in to continue.", variant: "destructive" });
      return;
    }
    setB2bProcessing(true);
    const reference = `INV-B2B-${user.id.slice(0, 8)}-${Date.now()}`;
    const amount = 360000;
    const vatAmount = Math.round(amount * VAT_RATE);
    const totalWithVat = amount + vatAmount;
    const amountKobo = Math.round(totalWithVat * 100);

    initializePayment({
      config: {
        reference,
        amount: amountKobo,
        metadata: {
          payment_type: "subscription",
          user_id: user.id,
          plan_type: "b2b_quarterly",
          custom_fields: [
            { display_name: "Plan", variable_name: "plan_type", value: "b2b_quarterly" },
            { display_name: "User ID", variable_name: "user_id", value: user.id },
          ],
        },
      },
      onSuccess: async (transaction) => {
        try {
          // Activation is server-verified: the edge function confirms the
          // charge with Paystack and reads the plan from the recorded metadata.
          const { error } = await supabase.functions.invoke("verify-payment", {
            body: { reference: transaction.reference ?? reference },
          });
          if (error) throw error;
          toast({ title: "B2B Subscription Activated!", description: "Your B2B plan is now active." });
        } catch (err) {
          toast({ title: "Activation Pending", description: "Payment received. We're confirming automatically…", variant: "destructive" });
        } finally {
          setB2bProcessing(false);
        }
      },
      onClose: () => {
        setB2bProcessing(false);
        toast({ title: "Payment Cancelled", description: "You closed the payment window." });
      },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-24 md:pt-32 pb-16 gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
              Investours Pricing
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-2">
              Build Smarter. Earn Better. Stay Financially Safe.
            </p>
            <p className="text-lg text-muted-foreground">
              Choose the plan that fits your goals.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Individual & Business Plans */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Individual & Business Plans
            </h2>
            <p className="text-muted-foreground">
              Use Platform Credit Packs (pay-as-you-go) for on-demand AI audits and scam checks,
              or upgrade to Premium for unlimited access to all tools, mentorship, and opportunities.
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto"
          >
            {/* Platform Credit Packs */}
            <motion.div variants={fadeInUp}>
              <Card variant="elevated" className="h-full border-2 border-border/50">
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-2xl font-bold">Platform Credit Packs</CardTitle>
                  <CardDescription className="text-base">
                    Pay-as-you-go credits for on-demand AI financial audits and scam checks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {packsLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : (
                      creditPacks.map((pack, i) => {
                        const isAnnual = pack.name.toLowerCase().includes("annual");
                        const isStandard = pack.name.toLowerCase().includes("standard");
                        return (
                          <div
                            key={pack.id}
                            className={`rounded-lg p-4 border-2 relative ${
                              isAnnual
                                ? "bg-investours-gold/10 border-investours-gold/30"
                                : isStandard
                                ? "bg-accent/10 border-accent/30"
                                : "bg-primary/10 border-primary/20"
                            }`}
                          >
                            {isAnnual && (
                              <Badge className="absolute -top-2 -right-2 bg-investours-gold text-foreground">
                                Best Value
                              </Badge>
                            )}
                            <div className="flex items-baseline justify-between mb-2">
                              <span className="text-sm font-medium">
                                {pack.name.toLowerCase().includes("starter")
                                  ? "Starter Credit Pack"
                                  : pack.name.toLowerCase().includes("standard")
                                  ? "Standard Credit Pack"
                                  : "Annual Credit Pack"}
                              </span>
                              <div className="text-right">
                                <span className="text-xl font-bold text-foreground">₦{pack.price.toLocaleString()}</span>
                                <span className="text-sm text-muted-foreground"> one-time</span>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground mb-3">
                              {pack.credits} Platform Credits · Valid {pack.validity_days} Days
                            </div>
                            <Link to="/auditor/packs">
                              <Button
                                variant={isAnnual ? "default" : isStandard ? "accent" : "default"}
                                className={`w-full ${isAnnual ? "bg-investours-gold hover:bg-investours-gold/90 text-foreground" : ""}`}
                                size="sm"
                              >
                                Get Credit Pack
                              </Button>
                            </Link>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <ul className="space-y-2 pt-2">
                    <li className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">Spend credits on AI Financial Audits &amp; Scam Detector scans</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">Financial Health Scores &amp; leakage detection</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">Recovery opportunity recommendations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">No automatic renewal — pay only for what you use</span>
                    </li>
                  </ul>
                  <Link to="/auditor/packs" className="block mt-4">
                    <Button variant="outline" className="w-full" size="lg">
                      Get Started with Credits
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            {/* Premium Plan */}
            <motion.div variants={fadeInUp}>
              <Card variant="elevated" className="h-full border-2 border-primary shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-4 py-1 text-sm font-semibold rounded-bl-lg">
                  RECOMMENDED
                </div>
                <CardHeader className="text-center pb-4 pt-8">
                  <CardTitle className="text-2xl font-bold text-primary">Premium Plan</CardTitle>
                  <CardDescription className="text-base">
                    For users ready to unlock full AI tools and opportunities.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Pricing Options */}
                  <div className="space-y-3">
                    <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">Monthly Payment</span>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-foreground">₦4,500</span>
                          <span className="text-sm text-muted-foreground"> / month</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        1 vote per stage
                      </div>
                      <Link to="/subscribe?plan=premium-monthly">
                        <Button variant="default" className="w-full" size="sm">
                          Upgrade Now
                        </Button>
                      </Link>
                    </div>

                    <div className="bg-accent/10 rounded-lg p-4 border-2 border-accent/30 relative">
                      <Badge className="absolute -top-2 -right-2 bg-accent text-accent-foreground">
                        Save ₦1,500
                      </Badge>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">Quarterly Payment</span>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-foreground">₦12,000</span>
                          <span className="text-sm text-muted-foreground"> / 3 months</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        2 votes per stage
                      </div>
                      <Link to="/subscribe?plan=premium-quarterly">
                        <Button variant="accent" className="w-full" size="sm">
                          Upgrade Now
                        </Button>
                      </Link>
                    </div>

                    <div className="bg-accent/10 rounded-lg p-4 border-2 border-accent/30 relative">
                      <Badge className="absolute -top-2 -right-2 bg-accent text-accent-foreground">
                        Save ₦4,500
                      </Badge>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">Bi-annual Payment</span>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-foreground">₦22,500</span>
                          <span className="text-sm text-muted-foreground"> / 6 months</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        3 votes per stage
                      </div>
                      <Link to="/subscribe?plan=premium-biennial">
                        <Button variant="accent" className="w-full" size="sm">
                          Upgrade Now
                        </Button>
                      </Link>
                    </div>

                    <div className="bg-investours-gold/10 rounded-lg p-4 border-2 border-investours-gold/30 relative">
                      <Badge className="absolute -top-2 -right-2 bg-investours-gold text-foreground">
                        Save ₦9,000
                      </Badge>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">Annual Payment</span>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-foreground">₦45,000</span>
                          <span className="text-sm text-muted-foreground"> / year</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        4 votes per stage
                      </div>
                      <Link to="/subscribe?plan=premium-annual">
                        <Button variant="default" className="w-full bg-investours-gold hover:bg-investours-gold/90 text-foreground" size="sm">
                          Upgrade Now
                        </Button>
                      </Link>
                    </div>

                    <div className="bg-primary/10 rounded-lg p-4 border-2 border-primary/30 relative">
                      <Badge className="absolute -top-2 -right-2 bg-primary text-primary-foreground">
                        Best for Teams
                      </Badge>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">B2B Subscription</span>
                        <div className="text-right">
                          <span className="text-2xl font-bold text-foreground">₦360,000</span>
                          <span className="text-sm text-muted-foreground"> / 3 months</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <Button
                        variant="default"
                        className="w-full"
                        size="sm"
                        onClick={handleB2BPayment}
                        disabled={b2bProcessing}
                      >
                        {b2bProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processing…
                          </>
                        ) : (
                          "Upgrade Now"
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="border-t border-border pt-4">
                    <p className="text-sm font-semibold mb-3">All Platform Credit Pack features, plus:</p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Unlimited AI Business Plan Generator Usage</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Download Business Plans (PDF)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Save Business Plan History</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Unlimited AI Financial Tutor Access</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Unlimited Deep Scam Analysis</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Premium Learning &amp; Mentorship Content</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Additional Support</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Investours Growth Partner (IGP) Benefits (Lower Withdrawal Fees)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Early Access to Licensed Investment &amp; Microinsurance Partners (As Available)</span>
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Institutional Access */}
      <section className="py-16 md:py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <Card variant="elevated" className="border-primary/30">
              <CardHeader className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-2xl md:text-3xl font-bold">
                  Institutional Access
                </CardTitle>
                <CardDescription className="text-base max-w-2xl mx-auto">
                  Empowering Youth, Women, Entrepreneurs, and Communities with AI-Powered Financial Intelligence and Income Mobility
                </CardDescription>
                <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
                  Tailored for Government MDAs, NYSC Programs, NGOs, Development Partners, Unions, Cooperatives, Educational Institutions, and Corporations.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Check className="w-5 h-5 text-primary" />
                      Included Benefits
                    </h3>
                    <ul className="space-y-2 text-sm text-muted-foreground ml-7">
                      <li>AI for Financial Intelligence &amp; Scam Protection Program</li>
                      <li>AI Business Plan Generator for aspiring entrepreneurs and business owners</li>
                      <li>Sponsored Premium Access for beneficiaries</li>
                      <li>Financial literacy, business development, and income mobility resources</li>
                      <li>Community engagement and impact tracking</li>
                      <li>Onboarding, training, and ongoing support</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Check className="w-5 h-5 text-primary" />
                      Requirements &amp; Pricing
                    </h3>
                    <ul className="space-y-2 text-sm text-muted-foreground ml-7">
                      <li>Minimum sponsorship: 25 beneficiaries</li>
                      <li>Annual billing only</li>
                      <li>Discounts available for 101+ beneficiaries</li>
                      <li>White-label solutions available from 5,000+ users</li>
                      <li>Additional concessions available for large-scale sponsorship programs</li>
                      <li>Pilot partnerships may be considered on a case-by-case basis</li>
                    </ul>
                  </div>
                </div>

                <div className="pt-4">
                  <h3 className="font-semibold text-lg flex items-center gap-2 justify-center mb-3">
                    <Check className="w-5 h-5 text-primary" />
                    Ideal For
                  </h3>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground ml-7 max-w-xl mx-auto">
                    <li>&bull; Youth empowerment programs</li>
                    <li>&bull; Women's economic empowerment initiatives</li>
                    <li>&bull; Entrepreneurship and business incubation programs</li>
                    <li>&bull; Financial inclusion projects</li>
                    <li>&bull; Cooperative and union capacity building</li>
                    <li>&bull; Workforce and community development initiatives</li>
                  </ul>
                </div>

                <div className="pt-6 border-t border-border text-center">
                  <p className="text-muted-foreground mb-4">
                    Ready to equip your beneficiaries with AI-powered tools for financial intelligence, entrepreneurship, and income mobility?
                  </p>
                  <a href="mailto:institutional@investours.com?subject=Institutional Access Request">
                    <Button variant="hero" size="lg">
                      <Mail className="w-5 h-5 mr-2" />
                      Contact Us to Get Started
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Pricing;