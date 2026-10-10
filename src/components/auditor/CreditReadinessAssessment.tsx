import { AlertTriangle, CheckCircle2, CircleHelp, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatNaira } from "@/lib/auditor";
import { assessCreditReadiness, type CreditReadinessInput, type AssessedValue } from "@/lib/creditReadiness";

interface CreditReadinessAssessmentProps {
  input: CreditReadinessInput;
}

const displayAmount = (value: AssessedValue) => value.value == null ? "Not included in audit" : formatNaira(value.value);
const evidenceLabel = (value: AssessedValue) => `${value.source} · ${value.verification}`;

export function CreditReadinessAssessment({ input }: CreditReadinessAssessmentProps) {
  const assessment = assessCreditReadiness(input);
  const period = assessment.financialPeriod.start && assessment.financialPeriod.end
    ? `${new Date(assessment.financialPeriod.start).toLocaleDateString("en-NG")} – ${new Date(assessment.financialPeriod.end).toLocaleDateString("en-NG")}`
    : "Not available";
  const factors = [
    { title: "Repayment capacity", status: assessment.repaymentCapacity.estimatedMonthlyRepaymentCapacity.value == null ? "Cash flow reviewed" : "Estimated", detail: "Income relative to recorded outflows; unknown debt is not assumed to be zero" },
    { title: "Income stability", status: `${assessment.repaymentCapacity.observationMonths} month(s) reviewed`, detail: assessment.incomeStability.variability },
    { title: "Existing debt", status: assessment.debt.status.startsWith("Debt obligations are not included") ? "Not in report" : "Reported", detail: assessment.debt.status },
    { title: "Repayment history", status: assessment.repaymentHistory.status === "Assessed" ? "Assessed" : "Not in report", detail: "No repayment record was included in this audit" },
  ];
  const tone = assessment.readinessBand === "Strong" ? "text-emerald-700 bg-emerald-50" : assessment.readinessBand === "Moderate" ? "text-amber-800 bg-amber-50" : assessment.readinessBand === "Needs Improvement" ? "text-rose-700 bg-rose-50" : "text-muted-foreground bg-muted";

  return (
    <section id="credit-readiness" className="mb-8 space-y-5" aria-labelledby="credit-readiness-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI Financial Auditor Report</p>
        <h2 id="credit-readiness-title" className="mt-1 text-xl font-semibold">Credit Readiness Assessment</h2>
        <p className="text-sm text-muted-foreground">Explainable assessment based only on information available in this report.</p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Credit readiness</p>
              <p className="mt-1 text-2xl font-semibold">{assessment.readinessBand}</p>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {assessment.readinessBasis === "Preliminary cash-flow indication"
                  ? "Preliminary judgment from the selected audit's recorded cash flow. Debt and repayment history are not assumed."
                  : "This band summarizes the available evidence; it is not a lending decision."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="w-fit">{assessment.assessmentStatus}</Badge>
              <Badge variant="secondary" className="w-fit">Preliminary</Badge>
            </div>
          </div>
          <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <OverviewValue label="Assessment basis" value="Selected audit cash flow" />
            <OverviewValue label="Assessment confidence" value={assessment.assessmentConfidence} />
            <OverviewValue label="Assessment date" value={new Date(assessment.assessmentDate).toLocaleDateString("en-NG")} />
            <OverviewValue label="Financial data period" value={period} />
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-3 text-base font-semibold">Assessment factors</h3>
        <div className="space-y-2">
          {factors.map((factor) => (
            <div key={factor.title} className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium">{factor.title}</p><p className="text-xs text-muted-foreground">{factor.detail}</p></div>
              <Badge variant="secondary" className="w-fit">{factor.status}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <AssessmentSection title="Repayment capacity">
          <Metric label="Average monthly income" value={displayAmount(assessment.repaymentCapacity.averageMonthlyIncome)} evidence={evidenceLabel(assessment.repaymentCapacity.averageMonthlyIncome)} />
          <Metric label="Essential monthly expenditure" value={displayAmount(assessment.repaymentCapacity.essentialMonthlyExpenses)} evidence={evidenceLabel(assessment.repaymentCapacity.essentialMonthlyExpenses)} />
          <Metric label="Existing monthly debt repayments" value={displayAmount(assessment.repaymentCapacity.existingMonthlyDebtRepayments)} evidence={evidenceLabel(assessment.repaymentCapacity.existingMonthlyDebtRepayments)} />
          <Metric label="Estimated monthly disposable income" value={displayAmount(assessment.repaymentCapacity.estimatedMonthlyDisposableIncome)} evidence={evidenceLabel(assessment.repaymentCapacity.estimatedMonthlyDisposableIncome)} />
          <Metric label="Estimated repayment capacity" value={displayAmount(assessment.repaymentCapacity.estimatedMonthlyRepaymentCapacity)} evidence={evidenceLabel(assessment.repaymentCapacity.estimatedMonthlyRepaymentCapacity)} />
          <p className="text-xs text-muted-foreground">{assessment.repaymentCapacity.observation}</p>
        </AssessmentSection>

        <AssessmentSection title="Income stability">
          <Metric label="Income sources" value={assessment.incomeStability.sourceCount == null ? "Not categorized in audit" : `${assessment.incomeStability.sourceCount} reported source(s)`} />
          <Metric label="Observed variability" value={assessment.incomeStability.variability} />
          <Metric label="Recurring income" value={assessment.incomeStability.recurringIncome} />
          {assessment.incomeStability.sources.map((source) => <Metric key={source.name} label={source.name} value={formatNaira(source.amount)} evidence="Reported in audit summary" />)}
        </AssessmentSection>

        <AssessmentSection title="Cash-flow health">
          <Metric label="Average monthly inflows" value={displayAmount(assessment.cashFlow.averageMonthlyInflows)} />
          <Metric label="Average monthly outflows" value={displayAmount(assessment.cashFlow.averageMonthlyOutflows)} />
          <Metric label="Average monthly surplus / deficit" value={displayAmount(assessment.cashFlow.averageMonthlySurplus)} />
          <Metric label="Negative cash-flow periods" value={assessment.cashFlow.negativePeriods == null ? "Not shown by monthly records" : `${assessment.cashFlow.negativePeriods} observed`} />
          <p className="text-sm text-muted-foreground">{assessment.cashFlow.observation} {assessment.cashFlow.resilience}</p>
        </AssessmentSection>

        <AssessmentSection title="Existing debt and repayment history">
          <Metric label="Outstanding loan balance" value={displayAmount(assessment.debt.outstandingBalance)} />
          <Metric label="Monthly repayments" value={displayAmount(assessment.debt.monthlyRepayments)} />
          <Metric label="Known arrears" value={displayAmount(assessment.debt.arrears)} />
          <Metric label="Debt-to-income ratio" value={assessment.debt.debtToIncomeRatio == null ? "Not included in audit" : `${(assessment.debt.debtToIncomeRatio * 100).toFixed(1)}%`} />
          <p className="text-sm text-muted-foreground">{assessment.debt.status}</p>
          <div className="border-t pt-3"><p className="text-sm font-medium">Repayment history</p><p className="text-sm text-muted-foreground">{assessment.repaymentHistory.status}: {assessment.repaymentHistory.summary}</p></div>
        </AssessmentSection>
      </div>

      <AssessmentSection title="Financial record quality">
        <p className="text-sm text-muted-foreground">Rules {assessment.rulesVersion} · Policy {assessment.policyId} · {assessment.repaymentCapacity.observationMonths} month(s) reviewed</p>
        <p className="text-sm">This assessment uses the selected audit's recorded income and outflows. It does not assume unlisted debts are zero or infer repayment history.</p>
      </AssessmentSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <AssessmentSection title="Key credit strengths">
          {assessment.strengths.length ? assessment.strengths.map((item) => <p key={item} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{item}</p>) : <p className="text-sm text-muted-foreground">No positive cash-flow signal stood out in this audit period.</p>}
        </AssessmentSection>
        <AssessmentSection title="Risks and areas for improvement">
          {assessment.risks.length ? assessment.risks.map((risk) => <div key={risk.issue} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="text-sm font-medium">{risk.issue}</p><p className="text-sm text-muted-foreground">{risk.whyItMatters} {risk.action}</p></div></div>) : <p className="text-sm text-muted-foreground">No material risk identified from the available evidence.</p>}
        </AssessmentSection>
      </div>

      <AssessmentSection title="Priority actions">
        <ol className="list-decimal space-y-2 pl-5 text-sm">{assessment.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
      </AssessmentSection>

      <Card className={tone}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" /><div>
            <h3 className="font-semibold">Assessment summary · {assessment.readinessBand}</h3>
            <p className="mt-1 text-sm">{assessment.finalSummary.supportingFactors.join(" ") || "No supporting repayment-capacity factors are established yet."}</p>
            <p className="mt-1 text-sm">Limiting factors: {assessment.finalSummary.limitingFactors.join("; ") || "None identified from available data."}</p>
            <p className="mt-3 flex gap-2 text-xs"><CircleHelp className="h-4 w-4 shrink-0" />{assessment.finalSummary.disclaimer}</p>
            <p className="mt-2 text-xs opacity-80">Generated {new Date(assessment.assessmentDate).toLocaleString("en-NG")} · Data period: {period}</p>
          </div></div>
        </CardContent>
      </Card>
    </section>
  );
}

function OverviewValue({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function Metric({ label, value, evidence }: { label: string; value: string; evidence?: string }) {
  return <div className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0"><div><p className="text-sm text-muted-foreground">{label}</p>{evidence && <p className="text-[11px] text-muted-foreground">{evidence}</p>}</div><p className="text-right text-sm font-medium">{value}</p></div>;
}

function AssessmentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardContent className="space-y-2 p-5"><h3 className="mb-2 text-base font-semibold">{title}</h3>{children}</CardContent></Card>;
}