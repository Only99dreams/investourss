import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowRight, Search, Eye, Banknote, BellRing, Lock, Check, Sparkles,
  FileSearch, TrendingUp, Wallet, ShieldCheck, PiggyBank,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5 },
};

const AuditorLanding = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <Header />

      <main className="container mx-auto px-4 pt-24 pb-12 relative z-10 flex-1">
        {/* Hero */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center mb-16">
          <Badge variant="outline" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1 text-primary" /> FREE 6-Month Financial Audit
          </Badge>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold text-foreground mb-4">
            AI Financial Auditor
          </h1>
          <p className="text-lg sm:text-xl text-primary font-medium mb-4 max-w-3xl mx-auto">
            Understand your financial health, detect hidden leakages, and recover lost money.
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto mb-8">
            Connect your financial records and discover your Financial Health Score, hidden bank
            overcharges and your estimated recoverable amount — in minutes, with AI.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild size="xl" variant="hero">
              <Link to="/auditor/connect">
                Start Free Audit <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link to="/auditor/packs">View Pricing</Link>
            </Button>
          </div>
        </motion.section>

        {/* Value props */}
        <motion.section {...fadeUp} className="mb-16">
          <h2 className="text-2xl font-bold text-center text-foreground mb-2">Why use the AI Financial Auditor?</h2>
          <p className="text-center text-muted-foreground mb-8 max-w-xl mx-auto">
            Protect the money you have before creating new income opportunities.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: FileSearch, title: "Understand Financial Health", desc: "A clear 0–100 score with income, expenses and cash-flow breakdowns." },
              { icon: TrendingUp, title: "Detect Hidden Leakages", desc: "AI finds duplicate charges, fees, dormant subscriptions and silent drains." },
              { icon: Banknote, title: "Identify Bank Overcharges", desc: "Spot ATM fees, POS double-debits and billing errors you never noticed." },
              { icon: PiggyBank, title: "Recover Lost Money", desc: "Evidence-backed recovery opportunities with instructions and templates." },
              { icon: BellRing, title: "Monitor Continuously", desc: "Weekly or monthly monitoring alerts for changes and new leakages." },
              { icon: ShieldCheck, title: "Build Financial Intelligence", desc: "Your financial health timeline improves month after month." },
            ].map((f) => (
              <motion.div key={f.title} {...fadeUp}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <f.icon className="w-6 h-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{f.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* How it works */}
        <motion.section {...fadeUp} className="mb-16">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { n: "1", title: "Register / Login", desc: "Create your free account." },
              { n: "2", title: "Connect Financial Data", desc: "SMS alerts, email statements, PDF uploads or Open Banking." },
              { n: "3", title: "Run FREE Audit", desc: "One free 6-month financial audit for every new account." },
              { n: "4", title: "Upgrade & Recover", desc: "Unlock the full report, recommendations and monitoring." },
            ].map((s, i) => (
              <motion.div key={s.n} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl font-bold text-primary">{s.n}</span>
                </div>
                <h3 className="font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Free vs Premium */}
        <motion.section {...fadeUp} className="mb-16">
          <div className="grid lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5 text-primary" /> FREE Audit Results
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {[
                    "Financial Health Score",
                    "Financial Status (Excellent / Good / Needs Attention / Critical)",
                    "Total Income & Total Expenses",
                    "Cash Flow Summary",
                    "Estimated Recoverable Amount",
                    "Financial Health Timeline",
                    "Audit History",
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-amber-700 mb-1">
                    <Lock className="w-4 h-4" /> Locked in the free report
                  </p>
                  <p className="text-amber-700/80 text-xs">
                    Transaction breakdown, leakages, AI recommendations and recovery actions stay
                    blurred until you upgrade.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary shadow-lg bg-gradient-to-br from-primary/5 to-accent/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" /> Unlock Full Intelligence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {[
                    "Full 12-Month Historical Audit",
                    "Detailed Transaction Breakdown",
                    "AI Recommendations",
                    "Recovery Actions",
                    "Weekly / Monthly Monitoring",
                    "Financial Health Timeline",
                    "Audit History",
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg bg-card border p-3 text-sm">
                  <p className="font-medium mb-1">Platform Subscription — from ₦4,500/month</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Unlimited audits, weekly monitoring, unlimited reports & priority support.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button asChild size="sm" className="w-full">
                      <Link to="/subscribe">Subscribe</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link to="/auditor/packs">Or buy Audit Credits from ₦1,700</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.section>

        {/* CTA */}
        <motion.section {...fadeUp} className="text-center mb-8">
          <Card className="bg-gradient-to-r from-primary to-accent text-primary-foreground border-0">
            <CardHeader>
              <CardTitle className="text-2xl md:text-3xl">
                Find out what your finances are hiding.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild size="xl" className="bg-background text-primary hover:bg-background/90">
                <Link to={user ? "/auditor/connect" : "/auth?mode=login"}>
                  {user ? "Run My Free Audit" : "Create Free Account"} <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </Button>
              <p className="text-sm text-primary-foreground/70 mt-3">
                Every new account receives ONE FREE 6-month Financial Audit.
              </p>
            </CardContent>
          </Card>
        </motion.section>
      </main>

      <Footer />
    </div>
  );
};

export default AuditorLanding;
