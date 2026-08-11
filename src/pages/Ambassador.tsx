import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Footer } from "@/components/ui/Footer";
import { AMBASSADOR_TIERS, formatNaira } from "@/lib/ambassadorTiers";
import Header from "@/components/Header";

const WhoCanJoinSection = ({ items }: { items: string[] }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
    {items.map((item) => (
      <div key={item} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
        <Badge variant="outline" className="rounded-full">
          <span className="text-xs">✓</span>
        </Badge>
        <span className="text-sm">{item}</span>
      </div>
    ))}
  </div>
);

const HowItWorksSteps = [
  {
    title: "Join the Ambassadors",
    description:
      "Purchase an Audit Credit Pack (₦1,700) or Subscription (₦4,500) and gain access to Investours AI tools.",
  },
  {
    title: "Teach Businesses & Individuals",
    description:
      "Teach businesses and individuals how to use AI to improve their financial health and monitor leakages, e.g., non-reversed double debits, incorrect bank charges, etc.",
  },
  {
    title: "Build Your Portfolio",
    description:
      "Help businesses and individuals actively use the AI tools to improve their financial health and livelihood.",
  },
  {
    title: "Earn Monthly Income",
    description:
      "Receive 30% first-time commission and 15% recurring commission from active subscriptions.",
  },
  {
    title: "Meet Your Portfolio Value",
    description:
      "Grow your active portfolio to qualify for Quarterly Rewards, including branded wears, laptop, iPhone, grants, and more.",
  },
];

const AmbassadorApplyPage = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }

    setIsApplying(true);
    try {
      const { data, error } = await supabase.rpc("apply_ambassador");

      if (error) throw error;

      const result = (data as Array<{ success: boolean; referral_code: string | null; tier: string | null; message: string } | null>)?.[0];
      const success = result?.success;
      const code = result?.referral_code ?? undefined;
      const message = result?.message ?? "Unable to activate ambassador status.";

      if (success) {
        toast({
          title: "Welcome, Ambassador!",
          description: `${message} Referral code: ${code ?? "N/A"}`,
        });
        navigate("/ambassador-dashboard");
      } else {
        toast({
          title: "Not Yet Eligible",
          description: message,
          variant: "destructive",
        });
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Failed to apply. Please try again.";
      toast({
        title: "Error",
        description,
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const ctaDisabled = !user;
  const ctaLabel = !user
    ? "Sign In to Apply"
    : isApplying
      ? "Applying..."
      : profile?.user_tier === "premium" || profile?.has_active_subscription
        ? "Activate Ambassador Status"
        : "Apply Now";

  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <Header />
      <div className="container mx-auto px-4 pt-24 pb-12 relative z-10">

        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Financial Health Ambassadors
          </h1>
          <p className="text-xl text-primary font-medium mb-4">
            Building Africa's largest AI-powered financial health network.
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            Our mission is to build Africa's largest network of AI-powered
            Financial Health Ambassadors, helping millions of individuals and
            businesses improve their financial wellbeing while creating
            sustainable recurring income opportunities for local communities.
          </p>
        </motion.section>

        {/* WhatsApp Image */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-16"
        >
          <div className="flex justify-center">
            <img
              src="/WhatsApp Image 2026-08-06 at 17.55.53.jpeg"
              alt="Financial Health Ambassadors"
              className="max-w-2xl w-full rounded-2xl border border-border shadow-lg"
            />
          </div>
        </motion.section>

        {/* Who Can Join */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold text-center text-foreground mb-2">Who Can Join?</h2>
          <p className="text-center text-muted-foreground mb-8 max-w-xl mx-auto">
            Anyone passionate about helping people and businesses improve their
            financial wellbeing.
          </p>
          <WhoCanJoinSection items={[
            "Students", "NYSC Corps Members", "Graduates", "Freelancers",
            "Financial Coaches", "Accountants", "Consultants",
            "Business Owners", "Civil Servants", "Community Leaders",
          ]} />
        </motion.section>

        {/* Membership Requirement */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-16"
        >
          <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 justify-center">
                <Shield className="w-5 h-5 text-primary" />
                Membership Requirement
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-lg text-foreground mb-2">
                To participate, members must maintain either:
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4 mt-4">
                <Badge variant="default" className="text-base px-4 py-2">
                  ✅ An active Platform Subscription
                </Badge>
                <Badge variant="outline" className="text-base px-4 py-2">
                  ✅ An active Audit Credit Pack
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        {/* How it works */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">How It Works</h2>
          <div className="max-w-2xl mx-auto space-y-4">
            {HowItWorksSteps.map((step, idx) => (
              <div
                key={step.title}
                className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card/60"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-primary">{idx + 1}</span>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Growth Path */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold text-center text-foreground mb-2">
            Growth Path & Quarterly Rewards
          </h2>
          <p className="text-center text-muted-foreground mb-6 max-w-2xl mx-auto">
            Build your Financial Health Portfolio — any combination of active businesses and individuals.
            Not compulsorily as in the table below. Earn first-time (30%) and recurring (15%) commissions
            at every stage. Qualify for Rewards (EVERY 90 DAYS)!
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-secondary/30">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Category</th>
                  <th className="text-right py-3 px-4 font-semibold">Businesses</th>
                  <th className="text-right py-3 px-4 font-semibold">Individuals</th>
                  <th className="text-right py-3 px-4 font-semibold">Income From Businesses</th>
                  <th className="text-right py-3 px-4 font-semibold">Income From Individuals</th>
                  <th className="text-right py-3 px-4 font-semibold">Total Monthly Income</th>
                  <th className="text-center py-3 px-4 font-semibold">Rewards</th>
                </tr>
              </thead>
              <tbody>
                {AMBASSADOR_TIERS.map((tier, idx) => (
                  <motion.tr
                    key={tier.name}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: idx * 0.08 }}
                    className={idx % 2 === 0 ? "bg-background/40" : ""}
                  >
                    <td className="py-3 px-4 font-medium">{tier.starIcon} {tier.name}</td>
                    <td className="text-right py-3 px-4">{tier.targetBusinesses}</td>
                    <td className="text-right py-3 px-4">{tier.targetIndividuals}</td>
                    <td className="text-right py-3 px-4">{formatNaira(tier.incomeBusinesses)}</td>
                    <td className="text-right py-3 px-4">{formatNaira(tier.incomeIndividuals)}</td>
                    <td className="text-right py-3 px-4 font-semibold text-primary">{formatNaira(tier.totalMonthlyIncome)}</td>
                    <td className="text-center py-3 px-4 text-xs">{tier.quarterlyReward}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>

        {/* CTA */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center mb-16"
        >
          <Card className="bg-gradient-to-r from-primary to-accent text-primary-foreground border-0">
            <CardHeader>
              <CardTitle className="text-2xl md:text-3xl">
                Ready to become a Financial Health Ambassador?
              </CardTitle>
              <CardDescription className="text-primary-foreground/80">
                Join a community of educators building Africa's financial future
                while earning sustainable recurring income.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="lg"
                variant="hero"
                className="bg-background text-primary hover:bg-background/90 w-full whitespace-normal sm:w-auto sm:px-10 sm:text-lg"
                onClick={handleApply}
                disabled={isApplying}
              >
                {isApplying ? "Applying..." : ctaLabel}
                {!user && <ArrowRight className="w-5 h-5 ml-2" />}
              </Button>
              {user && (
                <p className="text-sm text-primary-foreground/70 mt-3">
                  {profile?.has_active_subscription || profile?.user_tier === "premium"
                    ? "You're eligible to activate your ambassador status."
                    : "Maintain an active subscription or audit credits to qualify."}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.section>
      </div>

      <Footer />
    </div>
  );
};

export default AmbassadorApplyPage;