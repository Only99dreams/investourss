import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, RefreshCcw, FileSearch,
  History, Loader2, ArrowRight, CalendarClock, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { HealthScoreGauge } from "@/components/auditor/HealthScoreGauge";
import { BlurredReport } from "@/components/auditor/BlurredReport";
import {
  HEALTH_STATUS_META, auditPeriodLabel, formatNaira, monthLabel,
  DEFAULT_ACCESS, type AuditAccess,
} from "@/lib/auditor";
import { cn } from "@/lib/utils";

interface FinancialAudit {
  id: string;
  source_id: string | null;
  health_score: number;
  health_status: string;
  total_income: number;
  total_expenses: number;
  cash_flow: number;
  savings_rate: number;
  recoverable_amount: number;
  is_free: boolean;
  is_locked: boolean;
  audit_period_start: string | null;
  audit_period_end: string | null;
  report_json: Record<string, unknown> | null;
  created_at: string;
}

interface TimelinePoint {
  month: string;
  score: number;
}

interface AuditorDashboardProps {
  embedded?: boolean;
}

export const AuditorDashboard = ({ embedded = false }: AuditorDashboardProps) => {
  const { user, profile, isLoading: authLoading } = useAuth();

  const [latestAudit, setLatestAudit] = useState<FinancialAudit | null>(null);
  const [history, setHistory] = useState<FinancialAudit[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [access, setAccess] = useState<AuditAccess>(DEFAULT_ACCESS);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [auditsRes, snapshotsRes, accessRes] = await Promise.all([
        supabase
          .from("financial_audits")
          .select("id,source_id,health_score,health_status,total_income,total_expenses,cash_flow,savings_rate,recoverable_amount,is_free,is_locked,audit_period_start,audit_period_end,report_json,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("financial_health_snapshots")
          .select("snapshot_date,score")
          .eq("user_id", user.id)
          .order("snapshot_date", { ascending: true }),
        supabase.rpc("get_audit_access"),
      ]);

      if (auditsRes.error) throw auditsRes.error;
      if (snapshotsRes.error) throw snapshotsRes.error;
      if (accessRes.error) throw accessRes.error;

      const audits = (auditsRes.data ?? []) as FinancialAudit[];
      setLatestAudit(audits[0] ?? null);
      setHistory(audits);

      const raw = (snapshotsRes.data ?? []) as { snapshot_date: string; score: number }[];
      setTimeline(
        raw.map((s) => ({ month: s.snapshot_date.slice(0, 7), score: s.score })),
      );

      const accessData = Array.isArray(accessRes.data) ? accessRes.data[0] : accessRes.data;
      setAccess(accessData as AuditAccess);
    } catch (err) {
      console.error("Failed to load auditor data:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    if (!latestAudit) return null;
    return [
      {
        label: "Total Income",
        value: formatNaira(latestAudit.total_income),
        icon: TrendingUp,
        accent: "text-green-600 bg-green-50",
      },
      {
        label: "Total Expenses",
        value: formatNaira(latestAudit.total_expenses),
        icon: TrendingDown,
        accent: "text-red-600 bg-red-50",
      },
      {
        label: "Cash Flow",
        value: formatNaira(latestAudit.cash_flow),
        icon: Wallet,
        accent: latestAudit.cash_flow >= 0 ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50",
      },
      {
        label: "Savings Rate",
        value: `${Math.round(latestAudit.savings_rate)}%`,
        icon: PiggyBank,
        accent: "text-primary bg-primary/10",
      },
    ];
  }, [latestAudit]);

  const statusMeta = latestAudit
    ? HEALTH_STATUS_META[latestAudit.health_status as keyof typeof HEALTH_STATUS_META] ?? HEALTH_STATUS_META.critical
    : null;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const content = (
    <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
      {/* Hero / summary card */}
      {!loading && latestAudit && statusMeta && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Card className="border-l-4" style={{ borderLeftColor: statusMeta.hex }}>
            <CardContent className="p-6 flex flex-col md:flex-row items-center gap-6">
              <HealthScoreGauge score={latestAudit.health_score} status={latestAudit.health_status as never} />
              <div className="flex-1 text-center md:text-left">
                <Badge variant="outline" className="mb-2">
                  <CalendarClock className="w-3 h-3 mr-1" />
                  {auditPeriodLabel(latestAudit) || "Last 6 months"} · Last audit{" "}
                  {new Date(latestAudit.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                </Badge>
                <h1 className="text-2xl md:text-3xl font-bold mb-1">Financial Health Dashboard</h1>
                <p className={cn("font-medium mb-2", statusMeta.color)}>
                  Financial Status: {statusMeta.label}
                </p>
                <p className="text-sm text-muted-foreground">{statusMeta.description}</p>
                <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2">
                  <Button asChild>
                    <Link to="/auditor/connect">
                      <FileSearch className="w-4 h-4 mr-2" />
                      Run New Audit
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/auditor/packs">Get Credits / Upgrade</Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 p-5 text-center min-w-[200px]">
                <p className="text-sm text-muted-foreground mb-1">Estimated Recoverable</p>
                <p className="text-2xl font-bold text-primary">{formatNaira(latestAudit.recoverable_amount)}</p>
                <p className="text-xs text-muted-foreground mt-1">Potential leakage & overcharges</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && !latestAudit && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-16"
        >
          <Card className="max-w-xl mx-auto text-center border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <FileSearch className="w-7 h-7 text-primary" />
              </div>
              <CardTitle className="text-xl">Get Your FREE 6-Month Financial Audit</CardTitle>
              <CardDescription>
                Connect your financial records and discover your Financial Health Score plus the
                money you may have lost to leakages and bank overcharges — for free.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="lg">
                <Link to="/auditor/connect">
                  Start Free Audit <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Stats */}
      {!loading && latestAudit && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center", s.accent)}>
                      <s.icon className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-xl font-bold truncate">{s.value}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Timeline */}
        {!loading && (timeline.length > 0 || latestAudit) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RefreshCcw className="w-4 h-4 text-primary" />
                Financial Health Timeline
              </CardTitle>
              <CardDescription>Your score over time — improve every month.</CardDescription>
            </CardHeader>
            <CardContent>
              {timeline.length > 0 ? (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value) => [`${value}`, "Score"]}
                        labelFormatter={monthLabel}
                      />
                      <ReferenceLine y={65} stroke="#d97706" strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#1a73e8"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#1a73e8" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                  Run your first audit to start your timeline.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Audit History */}
        {!loading && history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="w-4 h-4 text-primary" />
                Audit History
              </CardTitle>
              <CardDescription>Every audit is stored for comparison.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.slice(0, 6).map((a) => {
                const meta = HEALTH_STATUS_META[a.health_status as keyof typeof HEALTH_STATUS_META] ?? HEALTH_STATUS_META.critical;
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card/40"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm", meta.bg, meta.color)}>
                        {a.health_score}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(a.created_at).toLocaleDateString("en-NG", { month: "long", year: "numeric" })} Audit
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.is_free ? "Free 6-month audit" : "Paid audit"} · {meta.label}
                        </p>
                      </div>
                    </div>
                    <Badge variant={a.is_locked ? "outline" : "default"} className="text-xs">
                      {a.is_locked ? "Locked" : "Full report"}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Blurred / full report */}
      {!loading && latestAudit && (
        <BlurredReport
          recoverableAmount={latestAudit.recoverable_amount}
          isLocked={latestAudit.is_locked}
        />
      )}

      {/* Full report for unlocked audits */}
      {!loading && latestAudit && !latestAudit.is_locked && (
        <AuditDetail audit={latestAudit} />
      )}

      {/* Upgrade prompt when no credits/subscription left */}
      {!loading && latestAudit && !access.subscription_active && access.credits_remaining <= 0 && (
        <div className="mt-6">
          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-primary shrink-0" />
                <div>
                  <p className="font-semibold">Keep your financial intelligence growing</p>
                  <p className="text-sm text-muted-foreground">
                    Subscribe or grab an Audit Credit Pack to run unlimited / on-demand audits and unlock monitoring.
                  </p>
                </div>
              </div>
              <Button asChild>
                <Link to="/auditor/packs">
                  Unlock Full Intelligence <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );

  if (embedded) {
    return <div className="min-h-screen bg-background flex flex-col">{content}</div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      {content}
      <Footer />
    </div>
  );
};

const AuditDetail = ({ audit }: { audit: FinancialAudit }) => {
  const report = (audit.report_json ?? {}) as {
    leakages?: { description: string; amount: number; category: string }[];
    recommendations?: { title: string; description: string; category: string }[];
    recoverable?: { description: string; amount: number; category: string }[];
    summary?: { incomeSources?: { name: string; amount: number }[]; topSpendingCategories?: { name: string; amount: number }[] };
  };

  const [showTransactions, setShowTransactions] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-primary" />
            Detailed Transaction Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6 mb-4">
            <div>
              <p className="text-sm font-medium mb-2">Top Spending Categories</p>
              <div className="space-y-2">
                {(report.summary?.topSpendingCategories ?? []).slice(0, 6).map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{c.name}</span>
                    <span className="font-medium">{formatNaira(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Income Sources</p>
              <div className="space-y-2">
                {(report.summary?.incomeSources ?? []).slice(0, 6).map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{c.name}</span>
                    <span className="font-medium text-green-600">{formatNaira(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowTransactions((v) => !v)}>
            {showTransactions ? "Hide" : "Show"} Transactions
          </Button>
          {showTransactions && (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Description</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as unknown as { transactions?: { date?: string; description: string; amount: number; type: string }[] }).transactions?.slice(0, 100).map((t, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 px-3 whitespace-nowrap">{t.date ?? "—"}</td>
                      <td className="py-2 px-3">{t.description}</td>
                      <td className={cn("py-2 px-3 text-right font-medium", t.type === "credit" ? "text-green-600" : "text-red-600")}>
                        {t.type === "credit" ? "+" : "−"}{formatNaira(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Recommendations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(report.recommendations ?? []).map((r, i) => (
              <div key={i} className="rounded-lg border bg-card/40 p-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
              </div>
            ))}
            {(report.recommendations ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No recommendations yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-green-700">Recovery Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(report.recoverable ?? []).map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border bg-green-50/40 p-3">
                <div>
                  <p className="text-sm font-medium">{r.description}</p>
                  <p className="text-xs text-muted-foreground capitalize">{r.category}</p>
                </div>
                <span className="text-sm font-semibold text-green-700">{formatNaira(r.amount)}</span>
              </div>
            ))}
            {(report.recoverable ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No recovery opportunities identified.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AuditorDashboard;
