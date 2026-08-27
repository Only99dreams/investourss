import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  HeartPulse, CheckCircle2, AlertTriangle, Lightbulb, Target,
  PiggyBank, BellRing, TrendingUp, TrendingDown, ShieldCheck, ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HEALTH_STATUS_META, formatNaira } from "@/lib/auditor";
import { cn } from "@/lib/utils";

interface GuidanceReport {
  summary?: {
    incomeSources?: { name: string; amount: number }[];
    topSpendingCategories?: { name: string; amount: number }[];
  };
  leakages?: { description: string; amount: number; category: string }[];
  recommendations?: { title: string; description: string; category: string }[];
}

export interface FinancialHealthGuidanceProps {
  healthScore: number;
  healthStatus: string;
  totalIncome: number;
  totalExpenses: number;
  cashFlow: number;
  savingsRate: number;
  recoverableAmount: number;
  isLocked: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  report?: GuidanceReport | null;
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.4 },
};

export function FinancialHealthGuidance({
  healthScore,
  healthStatus,
  totalIncome,
  totalExpenses,
  cashFlow,
  savingsRate,
  recoverableAmount,
  isLocked,
  periodStart,
  periodEnd,
  report,
}: FinancialHealthGuidanceProps) {
  const statusMeta =
    HEALTH_STATUS_META[healthStatus as keyof typeof HEALTH_STATUS_META] ?? HEALTH_STATUS_META.critical;

  const months = useMemo(() => {
    if (periodStart && periodEnd) {
      const m = Math.round(
        (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (30.44 * 86400000),
      );
      if (m > 0) return m;
    }
    return 6;
  }, [periodStart, periodEnd]);

  const monthlyIncome = totalIncome / months;
  const monthlyExpenses = totalExpenses / months;
  const monthlyCashFlow = cashFlow / months;

  const topSpend = (report?.summary?.topSpendingCategories ?? []).slice(0, 6);
  const incomeSources = (report?.summary?.incomeSources ?? []).slice(0, 6);
  const leakages = report?.leakages ?? [];
  const leakageTotal = (report?.leakages ?? []).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const topCategory = topSpend[0];
  const topCategoryPct = topCategory && totalExpenses > 0
    ? Math.round((topCategory.amount / totalExpenses) * 100)
    : 0;

  const emergencyFundTarget = Math.round(monthlyExpenses * 3);

  const verdict = (() => {
    const base = statusMeta.description || "Your financial health score reflects your recent activity.";
    if (isLocked) {
      return `${base} You’re seeing the free summary — upgrade to unlock personalized advice based on your full statement.`;
    }
    if (monthlyCashFlow >= 0 && savingsRate >= 20) {
      return `${base} You're earning more than you spend and saving a healthy share — keep the momentum going.`;
    }
    if (monthlyCashFlow < 0) {
      return `${base} You currently spend more than you earn each month, which drains your income. The plan below helps you close the gap.`;
    }
    return `${base} There's room to tighten a few areas so your money works harder for you. The plan below shows you exactly how.`;
  })();

  const strengths: string[] = [];
  const watchouts: string[] = [];
  const actions: string[] = [];

  if (!isLocked) {
    if (incomeSources.length >= 2) {
      strengths.push(`You earn from ${incomeSources.length} income streams — good diversification.`);
    }
    if (monthlyCashFlow > 0) {
      strengths.push(`Positive monthly cash flow of ${formatNaira(monthlyCashFlow)}.`);
    }
    if (savingsRate >= 20) {
      strengths.push(`Smart saver — ${Math.round(savingsRate)}% of income stays saved.`);
    }
    if (leakages.length === 0) {
      strengths.push("No hidden leakages detected — your accounts look clean.");
    }
    if (topSpend.length > 0 && monthlyExpenses <= monthlyIncome) {
      strengths.push(`Biggest expense is ${topSpend[0].name} at ${formatNaira(topSpend[0].amount)}.`);
    }
  }
  if (strengths.length === 0) {
    strengths.push("Consistent tracking — running an audit is the first step to better finances.");
  }

  if (monthlyCashFlow < 0) {
    watchouts.push(`You’re spending ${formatNaira(Math.abs(monthlyCashFlow))} more than you earn every month.`);
  } else if (savingsRate < 10 && savingsRate >= 0) {
    watchouts.push(`Savings rate of ${Math.round(savingsRate)}% is below the 10–20% target.`);
  }
  if (topCategory && topCategoryPct >= 25) {
    watchouts.push(`${topCategory.name} eats ${topCategoryPct}% of total expenses.`);
  }
  if (leakages.length > 0) {
    watchouts.push(`${leakages.length} hidden leakage${leakages.length === 1 ? "" : "s"} worth ${formatNaira(leakageTotal)}.`);
  }
  if (recoverableAmount > 0) {
    watchouts.push(`${formatNaira(recoverableAmount)} may be recoverable from overcharges.`);
  }
  if (watchouts.length === 0) {
    watchouts.push("No major red flags in this period — maintain your current habits.");
  }

  if (monthlyCashFlow < 0) {
    actions.push(`Trim ${topCategory?.name ?? "your top spending category"} this month — it’s your fastest way to a positive cash flow.`);
  } else if (monthlyCashFlow > 0 && savingsRate < 20) {
    actions.push(`Automate saving ${formatNaira(monthlyCashFlow * 0.3)} each month to push your savings rate above 20%.`);
  }
  actions.push(`Build an emergency fund of about ${formatNaira(emergencyFundTarget)} (3 months of expenses).`);
  if (recoverableAmount > 0) {
    actions.push(`Claim the ${formatNaira(recoverableAmount)} in recoverable amounts — use the recovery templates in your report.`);
  } else if (!isLocked) {
    actions.push("Follow the 50/30/20 rule: 50% needs, 30% wants, 20% savings.");
  }

  return (
    <motion.section {...fadeUp} className="mb-8">
      <Card className="relative overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        {/* Decorative glow */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
                <HeartPulse className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">Financial Health Guidance</h2>
                <p className="text-sm text-muted-foreground">
                  Personalized advice from your AI Financial Auditor, based on your own statement.
                </p>
              </div>
            </div>
            <Badge
              className="gap-1.5 capitalize text-sm px-3 py-1.5 self-start sm:self-auto"
              style={{ backgroundColor: `${statusMeta.hex}1f`, color: statusMeta.hex }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusMeta.hex }} />
              {statusMeta.label} · {healthScore}/100
            </Badge>
          </div>

          <div
            className={cn(
              "rounded-2xl p-4 sm:p-5 mb-6 border",
              statusMeta.color,
            )}
          >
            <p className="text-sm leading-relaxed">
              <span className="font-semibold">Verdict: </span>
              {verdict}
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {/* Strengths */}
            <motion.div {...fadeUp} className="h-full">
              <div className="h-full rounded-2xl border border-green-500/20 bg-green-50/50 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-green-600/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-green-800">What’s Working</h3>
                </div>
                <ul className="space-y-3">
                  {strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-green-900/80">
                      <ShieldCheck className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* Watch outs */}
            <motion.div {...fadeUp} className="h-full">
              <div className="h-full rounded-2xl border border-amber-500/20 bg-amber-50/50 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-amber-800">Watch Out For</h3>
                </div>
                <ul className="space-y-3">
                  {watchouts.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-900/80">
                      <TrendingDown className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* Action plan */}
            <motion.div {...fadeUp} className="h-full">
              <div className="h-full rounded-2xl border border-primary/20 bg-primary/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Target className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">Make the Most of Your Money</h3>
                </div>
                <ul className="space-y-3">
                  {actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                      <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>

          {/* Savings snapshot + monitoring CTA */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <PiggyBank className="w-4 h-4 text-primary" /> Savings rate
                </span>
                <span className="font-bold">{Math.round(savingsRate)}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, savingsRate))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {savingsRate >= 20 ? "Above the 20% target — excellent." : "Target is 10–20% of income."}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-primary" /> Net cash flow
                </span>
                <span className={cn("font-bold", monthlyCashFlow >= 0 ? "text-green-600" : "text-red-600")}>
                  {monthlyCashFlow >= 0 ? "+" : "−"}{formatNaira(Math.abs(monthlyCashFlow))}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    monthlyCashFlow >= 0 ? "bg-gradient-to-r from-green-500 to-emerald-400" : "bg-gradient-to-r from-red-500 to-rose-400",
                  )}
                  style={{ width: `${Math.min(100, Math.max(2, (Math.abs(monthlyCashFlow) / Math.max(1, monthlyIncome)) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">Per month over your audit period.</p>
            </div>

            <div className="rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground p-4 flex flex-col justify-between">
              <p className="text-sm font-semibold flex items-center gap-2">
                <BellRing className="w-4 h-4 shrink-0" />
                Keep your health on track
              </p>
              <div className="mt-2">
                <Button
                  asChild
                  size="sm"
                  className="bg-background text-primary hover:bg-background/90 w-full"
                >
                  <Link to="/dashboard/health-guidance#reporting">
                    Set Up Monitoring <ArrowRight className="w-4 h-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

export default FinancialHealthGuidance;