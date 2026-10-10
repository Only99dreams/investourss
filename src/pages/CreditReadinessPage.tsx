import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, FileSearch, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CreditReadinessAssessment } from "@/components/auditor/CreditReadinessAssessment";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AssessmentAudit {
  id: string;
  is_locked: boolean;
  audit_period_start: string | null;
  audit_period_end: string | null;
  total_income: number;
  total_expenses: number;
  created_at: string;
  report_json: Record<string, unknown> | null;
}

interface AuditTransaction {
  date?: string;
  amount?: number;
  type?: "credit" | "debit";
}

interface StoredMonthlyObservation {
  month: string;
  income: number;
  outflows: number;
  source?: "calculated";
  verification?: "unverified";
}

export function CreditReadinessPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [audit, setAudit] = useState<AssessmentAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadAudit = async () => {
      setLoading(true);
      setHasError(false);
      try {
        const query = supabase
          .from("financial_audits")
          .select("id,is_locked,audit_period_start,audit_period_end,total_income,total_expenses,created_at,report_json")
          .eq("user_id", user.id);
        const requestedId = searchParams.get("audit");
        const { data, error } = requestedId
          ? await query.eq("id", requestedId).maybeSingle()
          : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        setAudit((data as AssessmentAudit | null) ?? null);
      } catch (error) {
        console.error("Failed to load credit readiness data:", error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAudit();
    return () => {
      cancelled = true;
    };
  }, [user, searchParams]);

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  if (hasError) {
    return (
      <main className="p-4 md:p-6">
        <Card className="mx-auto max-w-2xl">
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            Credit readiness data could not be loaded. Please try again.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!audit) {
    return (
      <main className="p-4 md:p-6">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <FileSearch className="mb-1 h-7 w-7 text-primary" />
            <CardTitle>No financial audit yet</CardTitle>
            <CardDescription>Run an audit to create a credit readiness assessment from your available financial records.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link to="/auditor/connect">Start a financial audit</Link></Button></CardContent>
        </Card>
      </main>
    );
  }

  if (audit.is_locked) {
    return (
      <main className="p-4 md:p-6">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <Lock className="mb-1 h-7 w-7 text-primary" />
            <CardTitle>Unlock this audit report</CardTitle>
            <CardDescription>The credit readiness assessment is available with an unlocked financial audit report.</CardDescription>
          </CardHeader>
          <CardContent><Button asChild><Link to="/auditor/packs">View audit access options</Link></Button></CardContent>
        </Card>
      </main>
    );
  }

  const report = audit.report_json ?? {};
  const incomeSources = (report.summary as { incomeSources?: { name: string; amount: number }[] } | undefined)?.incomeSources;
  const transactions = Array.isArray(report.transactions) ? report.transactions as AuditTransaction[] : [];
  const storedObservations = Array.isArray(report.monthlyObservations)
    ? report.monthlyObservations as StoredMonthlyObservation[]
    : null;
  const monthly = new Map<string, StoredMonthlyObservation>();
  if (storedObservations) {
    storedObservations.forEach((observation) => monthly.set(observation.month, observation));
  } else {
    for (const transaction of transactions) {
      if (!transaction.date || !Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) < 0) continue;
      const month = transaction.date.slice(0, 7);
      const observation = monthly.get(month) ?? { month, income: 0, outflows: 0 };
      if (transaction.type === "credit") observation.income += Number(transaction.amount);
      if (transaction.type === "debit") observation.outflows += Number(transaction.amount);
      monthly.set(month, observation);
    }
  }
  const auditMonths = Number(report.auditMonths) || 1;

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <CreditReadinessAssessment
          input={{
            periodStart: audit.audit_period_start,
            periodEnd: audit.audit_period_end,
            auditMonths,
            totalIncome: audit.total_income,
            totalExpenses: audit.total_expenses,
            monthlyObservations: [...monthly.values()]
              .sort((a, b) => a.month.localeCompare(b.month))
              .map((observation) => ({ ...observation, source: "calculated" as const, verification: "unverified" as const })),
            incomeSources,
            transactionDataVerified: false,
          }}
        />
      </div>
    </main>
  );
}