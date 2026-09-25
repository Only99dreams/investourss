import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  History, Loader2, Download, Eye, ArrowRight, FileSearch, CalendarClock, Lock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HEALTH_STATUS_META, auditPeriodLabel, formatNaira } from "@/lib/auditor";
import { downloadAuditReport } from "@/lib/auditReport";
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

/** e.g. "12 Mar 2026, 3:45 pm" — the user asked for date AND time. */
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const AuditHistoryPage = () => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const [audits, setAudits] = useState<FinancialAudit[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("financial_audits")
        .select(
          "id,source_id,health_score,health_status,total_income,total_expenses,cash_flow,savings_rate,recoverable_amount,is_free,is_locked,audit_period_start,audit_period_end,report_json,created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAudits((data ?? []) as FinancialAudit[]);
    } catch (err) {
      console.error("Failed to load audit history:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    loadData();
  }, [user, authLoading, loadData]);

  const handleDownloadPdf = (audit: FinancialAudit) => {
    const name = profile?.full_name || user?.email || "Investours User";
    downloadAuditReport(name, audit).catch((err) =>
      console.error("Failed to download audit report:", err),
    );
  };

  if (authLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <History className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Audit History</h2>
            <p className="text-sm text-muted-foreground">
              Every audit you have run, with its date, time and downloadable PDF report.
            </p>
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : audits.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-8">
          <Card className="max-w-xl mx-auto text-center border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <FileSearch className="w-7 h-7 text-primary" />
              </div>
              <CardTitle className="text-xl">No Audits Yet</CardTitle>
              <CardDescription>
                Run your first audit and it will appear here with the date, time and a PDF you can
                download or come back to any time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="lg">
                <Link to="/dashboard/auditor">
                  Start Audit Now <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {audits.map((a) => {
            const meta =
              HEALTH_STATUS_META[a.health_status as keyof typeof HEALTH_STATUS_META] ??
              HEALTH_STATUS_META.critical;
            return (
              <Card key={a.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0",
                          meta.bg,
                          meta.color,
                        )}
                      >
                        {a.health_score}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {auditPeriodLabel(a) || "Financial Health Audit"}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <CalendarClock className="w-3 h-3 shrink-0" />
                          {formatDateTime(a.created_at)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.is_free ? "Free audit" : "Paid audit"} · Score {a.health_score}/100 ·{" "}
                          {meta.label} · Recoverable {formatNaira(a.recoverable_amount)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {a.is_locked && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="w-3 h-3" /> Locked
                        </Badge>
                      )}
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/dashboard/auditor?audit=${a.id}`}>
                          <Eye className="w-4 h-4 mr-1.5" /> View Report
                        </Link>
                      </Button>
                      <Button size="sm" onClick={() => handleDownloadPdf(a)}>
                        <Download className="w-4 h-4 mr-1.5" /> PDF
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AuditHistoryPage;
