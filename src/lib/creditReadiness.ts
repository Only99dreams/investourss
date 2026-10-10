export const CREDIT_READINESS_RULES_VERSION = "1.0.0";

export type CreditReadinessBand =
  | "Strong"
  | "Moderate"
  | "Needs Improvement"
  | "Insufficient Data";
export type AssessmentStatus = "Completed" | "Partially Completed" | "Insufficient Data";
export type EvidenceSource = "customer-reported" | "calculated" | "externally-sourced";
export type VerificationStatus = "verified" | "unverified" | "not-available";
export type DataLevel = "High" | "Moderate" | "Low";

export interface MonthlyFinancialObservation {
  month: string;
  income: number;
  outflows: number;
  source: EvidenceSource;
  verification: VerificationStatus;
}

export interface CreditReadinessInput {
  assessmentDate?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  auditMonths?: number;
  totalIncome?: number | null;
  totalExpenses?: number | null;
  incomeSources?: { name: string; amount: number; recurring?: boolean }[];
  monthlyObservations?: MonthlyFinancialObservation[];
  outflowsIncludeDebtRepayments?: boolean;
  essentialMonthlyExpenses?: number | null;
  debts?: {
    outstandingBalance?: number | null;
    monthlyRepayment?: number | null;
    arrears?: number | null;
    explicitlyNoDebt?: boolean;
  } | null;
  otherMonthlyCommitments?: number | null;
  repaymentHistory?: {
    summary: string;
    source: EvidenceSource;
    verification: VerificationStatus;
  } | null;
  supportingDocumentsAvailable?: boolean;
  transactionDataVerified?: boolean;
}

export interface CreditReadinessPolicy {
  id: string;
  minimumObservationMonths: number;
  minimumVerifiedFieldsForHighConfidence: number;
  repaymentCapacityShare: number;
  readinessMargins: { strong: number; moderate: number };
}

export const DEFAULT_CREDIT_READINESS_POLICY: CreditReadinessPolicy = {
  id: "investours-default-v1",
  minimumObservationMonths: 3,
  minimumVerifiedFieldsForHighConfidence: 5,
  repaymentCapacityShare: 0.3,
  readinessMargins: { strong: 0.3, moderate: 0.1 },
};

export interface AssessedValue {
  value: number | null;
  source: EvidenceSource | "estimated";
  verification: VerificationStatus;
}

export interface CreditReadinessAssessment {
  schemaVersion: "1.0.0";
  rulesVersion: string;
  policyId: string;
  assessmentDate: string;
  assessmentStatus: AssessmentStatus;
  readinessBand: CreditReadinessBand;
  dataCompleteness: DataLevel;
  assessmentConfidence: DataLevel;
  financialPeriod: { start: string | null; end: string | null };
  repaymentCapacity: {
    averageMonthlyIncome: AssessedValue;
    essentialMonthlyExpenses: AssessedValue;
    existingMonthlyDebtRepayments: AssessedValue;
    estimatedMonthlyDisposableIncome: AssessedValue;
    estimatedMonthlyRepaymentCapacity: AssessedValue;
    observationMonths: number;
    observation: string;
  };
  incomeStability: {
    sources: { name: string; amount: number; recurring?: boolean }[];
    sourceCount: number | null;
    variability: string;
    recurringIncome: string;
    risk: string;
  };
  cashFlow: {
    averageMonthlyInflows: AssessedValue;
    averageMonthlyOutflows: AssessedValue;
    averageMonthlySurplus: AssessedValue;
    negativePeriods: number | null;
    resilience: string;
    observation: string;
  };
  debt: {
    outstandingBalance: AssessedValue;
    monthlyRepayments: AssessedValue;
    arrears: AssessedValue;
    debtToIncomeRatio: number | null;
    status: string;
  };
  repaymentHistory: {
    status: "Assessed" | "Not Assessed — Information Unavailable";
    summary: string;
    source: EvidenceSource | null;
    verification: VerificationStatus;
  };
  recordQuality: { missingInformation: string[]; observations: string[] };
  strengths: string[];
  risks: { issue: string; whyItMatters: string; action: string }[];
  recommendations: string[];
  finalSummary: {
    supportingFactors: string[];
    limitingFactors: string[];
    missingInformation: string[];
    priorityActions: string[];
    disclaimer: string;
  };
}

const unavailable = (source: AssessedValue["source"] = "calculated"): AssessedValue => ({
  value: null,
  source,
  verification: "not-available",
});

const amount = (value: number, source: AssessedValue["source"], verification: VerificationStatus): AssessedValue => ({
  value: Number.isFinite(value) ? value : null,
  source,
  verification,
});

const average = (value: number | null | undefined, months: number): number | null =>
  value != null && Number.isFinite(value) ? value / months : null;

const dataLevel = (count: number, total: number): DataLevel => {
  const ratio = count / total;
  return ratio >= 0.8 ? "High" : ratio >= 0.5 ? "Moderate" : "Low";
};

export function assessCreditReadiness(
  input: CreditReadinessInput,
  policy: CreditReadinessPolicy = DEFAULT_CREDIT_READINESS_POLICY,
): CreditReadinessAssessment {
  const assessmentDate = input.assessmentDate ?? new Date().toISOString();
  const observations = input.monthlyObservations ?? [];
  const start = input.periodStart ?? null;
  const end = input.periodEnd ?? null;
  const startTime = start ? new Date(start).getTime() : Number.NaN;
  const endTime = end ? new Date(end).getTime() : Number.NaN;
  const periodDays = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime
    ? (endTime - startTime) / 86400000 + 1
    : 0;
  const periodMonths = input.auditMonths != null && Number.isFinite(input.auditMonths) && input.auditMonths > 0
    ? input.auditMonths
    : periodDays > 0 ? Math.max(1, periodDays / 30.4375) : 1;
  const averageIncome = average(input.totalIncome, periodMonths)
    ?? (observations.length ? observations.reduce((sum, item) => sum + item.income, 0) / observations.length : null);
  const averageOutflows = average(input.totalExpenses, periodMonths)
    ?? (observations.length ? observations.reduce((sum, item) => sum + item.outflows, 0) / observations.length : null);
  const monthlyDebt = input.debts?.monthlyRepayment;
  const observedSurplus = averageIncome != null && averageOutflows != null
    ? averageIncome - averageOutflows
    : null;
  const debtObligationsKnown = Boolean(input.debts?.explicitlyNoDebt) || monthlyDebt != null;
  const debtAdjustmentKnown = Boolean(input.debts?.explicitlyNoDebt)
    || (monthlyDebt != null && input.outflowsIncludeDebtRepayments != null);
  const disposable = observedSurplus == null || !debtAdjustmentKnown
    ? null
    : input.debts?.explicitlyNoDebt || monthlyDebt == null || input.outflowsIncludeDebtRepayments
      ? observedSurplus - (input.otherMonthlyCommitments ?? 0)
      : observedSurplus - monthlyDebt - (input.otherMonthlyCommitments ?? 0);
  const capacity = disposable == null || !debtObligationsKnown
    ? null
    : Math.max(0, disposable * policy.repaymentCapacityShare);
  const monthlySources = observations.length > 0
    ? observations.every((item) => item.source === observations[0].source) ? observations[0].source : "calculated"
    : "calculated";
  const allObservationsVerified = observations.length > 0 && observations.every((item) => item.verification === "verified");
  const verifiedFieldCount = Number(input.transactionDataVerified === true)
    + Number(input.supportingDocumentsAvailable === true)
    + Number(allObservationsVerified)
    + Number(input.repaymentHistory?.verification === "verified")
    + Number(input.debts != null);
  const requiredAvailable = (input.totalIncome != null || observations.length > 0)
    && (input.totalExpenses != null || observations.length > 0)
    && Boolean(start && end);
  const missingInformation: string[] = [];
  if (!requiredAvailable) missingInformation.push("Complete income, expense and assessment-period data");
  if (!debtObligationsKnown) missingInformation.push("Existing loan balances, repayments and arrears, or confirmation of no debt");
  if (monthlyDebt != null && input.outflowsIncludeDebtRepayments == null) missingInformation.push("Whether recorded outflows already include existing loan repayments");
  if (observations.length < policy.minimumObservationMonths) missingInformation.push("Monthly income and outflow records across at least three months");
  if (observations.length < periodMonths) missingInformation.push("Transaction observations for every month in the selected audit period");
  if (!input.repaymentHistory) missingInformation.push("Authorised repayment-history or credit-bureau information");
  if (input.supportingDocumentsAvailable !== true) missingInformation.push("Supporting documents for reported financial figures");
  if (input.transactionDataVerified !== true) missingInformation.push("Verification status for transaction or account data");

  const readinessSupported = requiredAvailable
    && debtObligationsKnown
    && observations.length >= policy.minimumObservationMonths;
  const readinessBand: CreditReadinessBand = !readinessSupported || disposable == null || averageIncome == null || averageIncome <= 0
    ? "Insufficient Data"
    : disposable / averageIncome >= policy.readinessMargins.strong
      ? "Strong"
      : disposable / averageIncome >= policy.readinessMargins.moderate
        ? "Moderate"
        : "Needs Improvement";
  const completed = readinessSupported && input.repaymentHistory != null && missingInformation.length === 0;
  const assessmentStatus: AssessmentStatus = !requiredAvailable
    ? "Insufficient Data"
    : completed ? "Completed" : "Partially Completed";
  const completenessCount = 7 - missingInformation.length;
  const dataCompleteness = dataLevel(Math.max(0, completenessCount), 7);
  const assessmentConfidence: DataLevel = verifiedFieldCount >= policy.minimumVerifiedFieldsForHighConfidence
    ? "High"
    : verifiedFieldCount >= Math.ceil(policy.minimumVerifiedFieldsForHighConfidence / 2)
      ? "Moderate"
      : "Low";
  const debtKnown = input.debts != null;
  const negativePeriods = observations.length
    ? observations.filter((item) => item.income - item.outflows < 0).length
    : null;
  const variability = observations.length >= 2
    ? (() => {
        const mean = observations.reduce((sum, item) => sum + item.income, 0) / observations.length;
        if (mean <= 0) return "Not assessable from the supplied observations";
        const variance = observations.reduce((sum, item) => sum + (item.income - mean) ** 2, 0) / observations.length;
        const coefficient = Math.sqrt(variance) / mean;
        return coefficient < 0.15 ? "Low observed variability" : coefficient < 0.35 ? "Moderate observed variability" : "High observed variability";
      })()
    : "Not assessable — monthly income observations unavailable";
  const supports = disposable != null && disposable > 0
    ? [`Positive average disposable cash flow of ${Math.round(disposable).toLocaleString("en-NG")} per month in the available records.`]
    : [];
  const risks: CreditReadinessAssessment["risks"] = [];
  if (disposable != null && disposable <= 0) {
    risks.push({ issue: "Little or no documented disposable cash flow", whyItMatters: "There may be limited room for an additional repayment after observed outflows.", action: "Review recurring expenses and reassess after a sustained period of positive cash flow." });
  }
  if (!debtKnown) {
    risks.push({ issue: "Existing debt obligations are unknown", whyItMatters: "Current loan repayments could reduce the cash available for another commitment.", action: "Provide current balances, repayment amounts and arrears, or explicitly confirm there are none." });
  }
  if (observations.length < policy.minimumObservationMonths) {
    risks.push({ issue: "Limited evidence of income stability", whyItMatters: "A short or aggregate-only period cannot show whether income is recurring or variable.", action: "Provide monthly income records and supporting evidence over a longer period." });
  }
  if (!input.repaymentHistory) {
    risks.push({ issue: "Repayment history not assessed", whyItMatters: "No reliable repayment-performance information was supplied.", action: "Provide authorised repayment records if available; absence of data is not a positive or negative history." });
  }
  const actions = [
    "Provide complete monthly income and expense records with supporting documents.",
    "Document existing loan obligations, arrears and recurring commitments.",
    "Review cash-flow patterns and reassess repayment affordability after a meaningful observation period.",
  ];
  const averageMonthlyIncome = averageIncome == null ? unavailable() : amount(averageIncome, monthlySources, allObservationsVerified ? "verified" : "unverified");
  const averageMonthlyOutflowsValue = averageOutflows == null ? unavailable() : amount(averageOutflows, monthlySources, allObservationsVerified ? "verified" : "unverified");
  const monthlyDebtValue = input.debts?.explicitlyNoDebt
    ? amount(0, "customer-reported", "unverified")
    : monthlyDebt == null ? unavailable("customer-reported") : amount(monthlyDebt, "customer-reported", "unverified");
  const debtRatio = monthlyDebt != null && averageIncome != null && averageIncome > 0 ? monthlyDebt / averageIncome : null;
  const recurring = input.incomeSources?.some((source) => source.recurring === true)
    ? "Recurring source reported; not independently verified"
    : "Not established from the available data";
  const dataPeriod = Math.floor(periodMonths);

  return {
    schemaVersion: "1.0.0",
    rulesVersion: CREDIT_READINESS_RULES_VERSION,
    policyId: policy.id,
    assessmentDate,
    assessmentStatus,
    readinessBand,
    dataCompleteness,
    assessmentConfidence,
    financialPeriod: { start, end },
    repaymentCapacity: {
      averageMonthlyIncome,
      essentialMonthlyExpenses: input.essentialMonthlyExpenses == null ? unavailable() : amount(input.essentialMonthlyExpenses, "customer-reported", "unverified"),
      existingMonthlyDebtRepayments: monthlyDebtValue,
      estimatedMonthlyDisposableIncome: disposable == null ? unavailable() : amount(disposable, "calculated", "unverified"),
      estimatedMonthlyRepaymentCapacity: capacity == null ? unavailable("estimated") : amount(capacity, "estimated", "unverified"),
      observationMonths: observations.length,
      observation: capacity == null
        ? "A repayment estimate is unavailable because required income, outflow or obligation data is missing."
        : `Planning estimate uses ${Math.round(policy.repaymentCapacityShare * 100)}% of positive disposable income; this is not an underwriting threshold and does not establish loan affordability.`,
    },
    incomeStability: {
      sources: input.incomeSources ?? [],
      sourceCount: input.incomeSources?.length ? input.incomeSources.length : null,
      variability,
      recurringIncome: recurring,
      risk: observations.length < policy.minimumObservationMonths ? "Potential interruption and concentration risks cannot be assessed from aggregate data." : "Review source concentration and interruptions against the observed monthly records.",
    },
    cashFlow: {
      averageMonthlyInflows: averageMonthlyIncome,
      averageMonthlyOutflows: averageMonthlyOutflowsValue,
      averageMonthlySurplus: observedSurplus == null ? unavailable() : amount(observedSurplus, "calculated", "unverified"),
      negativePeriods,
      resilience: input.essentialMonthlyExpenses == null ? "Not assessed — essential expenses and available reserves are not separately documented." : "A full resilience assessment also requires information about available emergency reserves.",
      observation: negativePeriods == null ? "Negative cash-flow frequency is unavailable without monthly observations." : `${negativePeriods} of ${observations.length} observed month(s) had outflows above income, before known debt adjustments.`,
    },
    debt: {
      outstandingBalance: input.debts?.explicitlyNoDebt
        ? amount(0, "customer-reported", "unverified")
        : input.debts?.outstandingBalance == null ? unavailable("customer-reported") : amount(input.debts.outstandingBalance, "customer-reported", "unverified"),
      monthlyRepayments: monthlyDebtValue,
      arrears: input.debts?.explicitlyNoDebt
        ? amount(0, "customer-reported", "unverified")
        : input.debts?.arrears == null ? unavailable("customer-reported") : amount(input.debts.arrears, "customer-reported", "unverified"),
      debtToIncomeRatio: debtRatio,
      status: !debtObligationsKnown ? "Not assessed — information unavailable" : input.debts?.explicitlyNoDebt ? "User reported no existing debt; not independently verified" : "Customer-reported obligations; verification status unavailable",
    },
    repaymentHistory: input.repaymentHistory
      ? { status: "Assessed", summary: input.repaymentHistory.summary, source: input.repaymentHistory.source, verification: input.repaymentHistory.verification }
      : { status: "Not Assessed — Information Unavailable", summary: "No reliable repayment-history information was supplied; no positive or negative history is inferred.", source: null, verification: "not-available" },
    recordQuality: {
      missingInformation,
      observations: [
        `${observations.length} of ${dataPeriod} selected month(s) contain transaction observations.`,
        input.supportingDocumentsAvailable === true ? "Supporting documents reported as available; not independently reviewed here." : "Supporting documents are not recorded as available.",
        input.transactionDataVerified === true ? "Transaction data marked verified by the source." : "Transaction-data verification is not established.",
      ],
    },
    strengths: supports,
    risks,
    recommendations: actions,
    finalSummary: {
      supportingFactors: supports,
      limitingFactors: risks.map((risk) => risk.issue),
      missingInformation,
      priorityActions: actions,
      disclaimer: "This assessment supports financial understanding only. It is not a loan approval, rejection, or guarantee; final decisions belong to the relevant authorised financial institution.",
    },
  };
}