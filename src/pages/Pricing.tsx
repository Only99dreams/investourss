import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { 
  Check, 
  Sparkles, 
  Shield, 
  BookOpen, 
  Users, 
  TrendingUp,
  Award,
  ArrowRight,
  Mail,
  Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Footer } from "@/components/ui/Footer";

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
              Choose the plan that fits your goals. All plans include access to our AI Business Plan Generator, AI Financial Tutor, Scam Detector, and learning resources designed to help you improve your income and make smarter financial decisions.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Individual Plans */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Individual Plans
            </h2>
            <p className="text-muted-foreground">
              Start with the Free Plan, then upgrade whenever you're ready for more AI tools, mentorship, and opportunities.
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto"
          >
            {/* Free Plan */}
            <motion.div variants={fadeInUp}>
              <Card variant="elevated" className="h-full border-2 border-border/50">
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-2xl font-bold">Free Plan</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">₦0</span>
                    <span className="text-muted-foreground"> / Month</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Perfect for first-time learners.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>AI Business Plan Generator</strong> → Generate and preview business plans (download unavailable)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>AI Financial Tutor</strong> → Free for all with limited usage
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>Scam Detector</strong> → Free for all with limited usage
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <TrendingUp className="w-5 h-5 text-investours-gold mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>Learning &amp; Mentorship</strong> → Access to selected financial literacy modules
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Users className="w-5 h-5 text-investours-coral mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>Community</strong> → Full access
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Award className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>Access to Licensed Partners</strong> → Coming soon (depends on regulation &amp; rollout)
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-investours-gold mt-0.5 shrink-0" />
                      <span className="text-sm">
                        <strong>Become an Investours Growth Partner (IGP)</strong> → Earn through referrals and community impact
                      </span>
                    </li>
                  </ul>
                  <Link to="/signup" className="block mt-6">
                    <Button variant="outline" className="w-full" size="lg">
                      Get Started Free
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
                          <span className="text-2xl font-bold text-foreground">₦120,000</span>
                          <span className="text-sm text-muted-foreground"> / year</span>
                          <div className="text-xs text-muted-foreground">+ 7.5% VAT at checkout</div>
                        </div>
                      </div>
                      <Link to="/subscribe?plan=b2b-annual">
                        <Button variant="default" className="w-full" size="sm">
                          Upgrade Now
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="border-t border-border pt-4">
                    <p className="text-sm font-semibold mb-3">All Free Plan features, plus:</p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Unlimited AI Business Plan Generator Usage</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">Download Business Plans (PDF &amp; DOC)</span>
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

      {/* CTA Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="gradient-primary rounded-3xl p-8 md:p-12 text-center text-primary-foreground max-w-3xl mx-auto"
          >
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Start Your 30-Day Free Trial Today
            </h2>
            <p className="text-primary-foreground/80 mb-8">
              Experience all Premium features for 30 days, then choose the plan that works best for you.
            </p>
            <Link to="/signup">
              <Button variant="glass" size="lg" className="bg-white/20 hover:bg-white/30 text-primary-foreground">
                Get Started Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default Pricing;

