import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { HeartPulse, FileSearch, Loader2, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancialHealthGuidance } from "@/components/auditor/FinancialHealthGuidance";
import { ContinuousReportingSection } from "@/components/dashboard/sections/ContinuousReportingSection";

interface FinancialAudit {
  id: string;
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
}

const FinancialHealthGuidancePage = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { hash } = useLocation();

  const [latestAudit, setLatestAudit] = useState<FinancialAudit | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("financial_audits")
        .select("id,health_score,health_status,total_income,total_expenses,cash_flow,savings_rate,recoverable_amount,is_free,is_locked,audit_period_start,audit_period_end,report_json")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setLatestAudit(data as FinancialAudit | null);
    } catch (err) {
      console.error("Failed to load health guidance data:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    loadData();
  }, [user, authLoading, loadData]);

  useEffect(() => {
    if (hash === "#reporting") {
      const el = document.getElementById("continuous-reporting");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hash, loading]);

  if (authLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <HeartPulse className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Financial Health Guidance</h2>
            <p className="text-sm text-muted-foreground">
              Personalized advice and continuous reporting — powered by the AI Financial Auditor.
            </p>
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : latestAudit ? (
        <>
          <FinancialHealthGuidance
            healthScore={latestAudit.health_score}
            healthStatus={latestAudit.health_status}
            totalIncome={latestAudit.total_income}
            totalExpenses={latestAudit.total_expenses}
            cashFlow={latestAudit.cash_flow}
            savingsRate={latestAudit.savings_rate}
            recoverableAmount={latestAudit.recoverable_amount}
            isLocked={latestAudit.is_locked}
            periodStart={latestAudit.audit_period_start}
            periodEnd={latestAudit.audit_period_end}
            report={(latestAudit.report_json ?? null) as Parameters<typeof FinancialHealthGuidance>[0]["report"] | null}
          />

          <section className="pt-2">
            <ContinuousReportingSection />
          </section>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-12"
        >
          <Card className="max-w-xl mx-auto text-center border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <FileSearch className="w-7 h-7 text-primary" />
              </div>
              <CardTitle className="text-xl">Run Your First Audit To Get Guidance</CardTitle>
              <CardDescription>
                Your personalized financial health guidance and continuous reporting unlock as soon as
                your AI Financial Auditor analyzes your statement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild size="lg">
                <Link to="/dashboard/auditor">
                  Go To AI Financial Auditor <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
};

export default FinancialHealthGuidancePage;