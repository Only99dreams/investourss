import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  BellRing, CalendarClock, Loader2, TrendingUp, TrendingDown, AlertTriangle,
  FileText, ArrowRight, CheckCircle2, Radio,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { DEFAULT_ACCESS, formatNaira, type AuditAccess } from "@/lib/auditor";

interface MonitorReport {
  id: string;
  report_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  score: number | null;
  content: Record<string, unknown>;
  created_at: string;
}

interface LatestAudit {
  health_score: number;
  health_status: string;
  cash_flow: number;
  recoverable_amount: number;
  report_json: Record<string, unknown> | null;
}

const AuditorMonitoring = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [reports, setReports] = useState<MonitorReport[]>([]);
  const [access, setAccess] = useState<AuditAccess>(DEFAULT_ACCESS);
  const [latestAudit, setLatestAudit] = useState<LatestAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"weekly" | "monthly">("weekly");

  const loadData = useCallback(async () => {
    try {
      const [reportsRes, accessRes, auditRes] = await Promise.all([
        supabase
          .from("monitoring_reports")
          .select("id,report_type,period_start,period_end,score,content,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.rpc("get_audit_access"),
        supabase
          .from("financial_audits")
          .select("health_score,health_status,cash_flow,recoverable_amount,report_json")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (reportsRes.error) throw reportsRes.error;
      if (accessRes.error) throw accessRes.error;
      if (auditRes.error) throw auditRes.error;

      setReports((reportsRes.data ?? []) as MonitorReport[]);
      const a = Array.isArray(accessRes.data) ? accessRes.data[0] : accessRes.data;
      setAccess(a as AuditAccess);
      setLatestAudit(auditRes.data as LatestAudit | null);
    } catch (err) {
      console.error("Failed to load monitoring:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    loadData();
  }, [user, authLoading, loadData]);

  const generateReport = async (type: "weekly" | "monthly") => {
    if (!user || !latestAudit) {
      toast({ title: "No audit yet", description: "Run a financial audit first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const now = new Date();
      const start = new Date();
      start.setDate(now.getDate() - (type === "weekly" ? 7 : 30));
      const report = latestAudit.report_json as {
        leakages?: { description: string; amount: number }[];
        recommendations?: { title: string; description: string }[];
      } | null;

      const content = {
        healthChanges: `Financial Health Score is ${latestAudit.health_score}.`,
        newLeakages: (report?.leakages ?? []).slice(0, 3).map((l) => l.description),
        spendingAlerts: latestAudit.cash_flow < 0 ? ["Cash flow is negative this period"] : [],
        recoveryOpportunities: `${formatNaira(latestAudit.recoverable_amount)} identified as recoverable.`,
        recommendations: (report?.recommendations ?? []).slice(0, 3).map((r) => r.title),
      };

      const { data, error } = await supabase
        .from("monitoring_reports")
        .insert({
          user_id: user.id,
          report_type: type,
          period_start: start.toISOString().slice(0, 10),
          period_end: now.toISOString().slice(0, 10),
          score: latestAudit.health_score,
          content,
        })
        .select("id,report_type,period_start,period_end,score,content,created_at")
        .single();

      if (error) throw error;

      await supabase.from("notifications").insert({
        user_id: user.id,
        title: `${type === "weekly" ? "Weekly" : "Monthly"} Monitoring Report Ready`,
        message: "Your latest monitoring summary is ready to view.",
        type: type === "weekly" ? "weekly_report" : "monthly_report",
      });

      setReports((prev) => [data as MonitorReport, ...prev]);
      toast({ title: "Report ready", description: `Your ${type} monitoring report has been generated.` });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const filtered = reports.filter((r) => r.report_type === activeTab);

  const hasSubscription = access?.subscription_active;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3">
            <Radio className="w-8 h-8 text-primary" />
            Continuous Monitoring
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Monitoring never consumes audit credits. Subscribers get weekly reports; audit-pack
            users get monthly summaries of health changes, new leakages, spending alerts and
            recovery opportunities.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardContent className="p-4 flex items-center gap-3">
              <BellRing className="w-6 h-6 text-primary shrink-0" />
              <div>
                <p className="font-semibold text-sm">{hasSubscription ? "Weekly Monitoring" : "Monthly Monitoring"}</p>
                <p className="text-xs text-muted-foreground">
                  {hasSubscription
                    ? "Financial health changes, new leakages, spending alerts & recovery opportunities every week."
                    : "A monthly summary while using audit credits. Upgrade for weekly reports."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Never consumes credits</p>
                <p className="text-xs text-muted-foreground">Automatic monitoring is free of credit usage.</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarClock className="w-6 h-6 text-accent shrink-0" />
              <div>
                <p className="font-semibold text-sm">Latest score</p>
                <p className="text-xs text-muted-foreground">
                  {latestAudit ? `Financial Health Score: ${latestAudit.health_score}` : "Run an audit to enable monitoring"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "weekly" | "monthly")}>
            <TabsList>
              <TabsTrigger value="weekly" disabled={!hasSubscription}>Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => generateReport(activeTab)} disabled={generating || !latestAudit || (!hasSubscription && activeTab === "weekly")}>
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            Generate {activeTab === "weekly" ? "Weekly" : "Monthly"} Report
          </Button>
        </div>

        {!hasSubscription && activeTab === "weekly" && (
          <Card className="mb-6 border-accent/30 bg-accent/5">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm">
                Weekly monitoring requires an active platform subscription.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/subscribe">
                  Upgrade <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center">
              <AlertTriangle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No {activeTab} reports yet. Generate your first report.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((r) => {
              const content = r.content as {
                healthChanges?: string;
                newLeakages?: string[];
                spendingAlerts?: string[];
                recoveryOpportunities?: string;
                recommendations?: string[];
              };
              return (
                <motion.div key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          {r.report_type === "weekly" ? "Weekly" : "Monthly"} Monitoring Report
                        </span>
                        <Badge variant="outline" className="w-fit">
                          {new Date(r.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        {new Date(r.period_start).toLocaleDateString("en-NG", { day: "numeric", month: "short" })} –{" "}
                        {new Date(r.period_end).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {r.score != null && (
                        <div className="flex items-start gap-2 text-sm">
                          <TrendingUp className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span className="flex-1">{content.healthChanges}</span>
                          <Badge className="shrink-0">{r.score}</Badge>
                        </div>
                      )}
                      {(content.newLeakages ?? []).map((l, i) => (
                        <div key={`l${i}`} className="flex items-start gap-2 text-sm">
                          <TrendingDown className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          <span className="flex-1">New leakage detected: {l}</span>
                        </div>
                      ))}
                      {(content.spendingAlerts ?? []).map((s, i) => (
                        <div key={`s${i}`} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <span className="flex-1">{s}</span>
                        </div>
                      ))}
                      {content.recoveryOpportunities && (
                        <div className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          <span className="flex-1">{content.recoveryOpportunities}</span>
                        </div>
                      )}
                      {(content.recommendations ?? []).length > 0 && (
                        <div className="rounded-lg border bg-secondary/30 p-3">
                          <p className="text-xs font-medium mb-2 uppercase tracking-wide text-muted-foreground">AI Recommendations</p>
                          <ul className="space-y-1 text-sm">
                            {(content.recommendations ?? []).map((rec, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-primary">•</span> {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AuditorMonitoring;
