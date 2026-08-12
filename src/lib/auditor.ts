export type HealthStatus = "excellent" | "good" | "needs_attention" | "critical";

export interface AuditorTransaction {
  date?: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  category?: string;
}

export interface AuditorReport {
  periodStart: string;
  periodEnd: string;
  score: number;
  healthStatus: HealthStatus;
  totalIncome: number;
  totalExpenses: number;
  cashFlow: number;
  savingsRate: number;
  recoverableAmount: number;
  summary: {
    incomeSources: { name: string; amount: number }[];
    topSpendingCategories: { name: string; amount: number }[];
  };
  transactions: AuditorTransaction[];
  leakages: { description: string; amount: number; category: string }[];
  recoverable: {
    description: string;
    amount: number;
    category: string;
    transactionDate?: string;
    sourceAmount?: number;
    sourceType?: "credit" | "debit";
  }[];
  recommendations: { title: string; description: string; category: string }[];
  monthlyScores: { month: string; score: number }[];
}

export const HEALTH_STATUS_META: Record<
  HealthStatus,
  { label: string; color: string; bg: string; hex: string; description: string }
> = {
  excellent: {
    label: "Excellent",
    color: "text-green-600",
    bg: "bg-green-50",
    hex: "#16a34a",
    description: "Strong cash flow and healthy savings habits.",
  },
  good: {
    label: "Good",
    color: "text-lime-600",
    bg: "bg-lime-50",
    hex: "#65a30d",
    description: "Generally healthy with a few minor leakages to fix.",
  },
  needs_attention: {
    label: "Needs Attention",
    color: "text-amber-600",
    bg: "bg-amber-50",
    hex: "#d97706",
    description: "Thin cash flow and recurring leakages eating into income.",
  },
  critical: {
    label: "Critical",
    color: "text-red-600",
    bg: "bg-red-50",
    hex: "#dc2626",
    description: "Expenses outweigh income. Urgent action recommended.",
  },
};

export const statusFromScore = (score: number): HealthStatus =>
  score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "needs_attention" : "critical";

export const formatNaira = (amount: number): string =>
  `₦${Math.round(amount).toLocaleString("en-NG")}`;

export const monthLabel = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00`);
  if (isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-NG", { month: "short" });
};

export interface AuditAccess {
  can_audit: boolean;
  access_type: "free" | "subscription" | "credits" | "none";
  free_audit_used: boolean;
  subscription_active: boolean;
  credits_remaining: number;
}

export const DEFAULT_ACCESS: AuditAccess = {
  can_audit: false,
  access_type: "none",
  free_audit_used: false,
  subscription_active: false,
  credits_remaining: 0,
};

export const auditPeriodLabel = (report?: { periodStart?: string; periodEnd?: string }): string => {
  if (!report?.periodStart || !report?.periodEnd) return "";
  const start = new Date(report.periodStart);
  const end = new Date(report.periodEnd);
  const fmt = (d: Date) => d.toLocaleDateString("en-NG", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
};

export const sampleSmsAlerts = `Alert: Withdrawal NGN25,000.00 on 12/07/26 by POS. Avail Bal: NGN612,000.00. Txn ID: 1001.
Alert: Credit of NGN350,000.00 on 05/07/26. Desc: Salary. Avail Bal: NGN637,000.00.
Alert: Withdrawal NGN8,500.00 on 02/07/26 by ATM 0307. Avail Bal: NGN287,000.00.
Alert: Transfer of NGN45,000.00 to J. Adeyemi on 28/06/26. Avail Bal: NGN295,500.00.
Alert: Airtime purchase NGN2,000.00 on 25/06/26. Avail Bal: NGN340,500.00.
Alert: Debit NGN18,750.00 on 20/06/26 for Data subscription. Avail Bal: NGN342,500.00.
Alert: Withdrawal NGN60,000.00 on 15/06/26 by POS. Avail Bal: NGN361,250.00.
Alert: Credit of NGN120,000.00 on 10/06/26. Desc: Freelance payment. Avail Bal: NGN421,250.00.
Alert: Bank charge NGN52.00 on 08/06/26. Avail Bal: NGN301,250.00.
Alert: Withdrawal NGN12,000.00 on 05/06/26 by ATM. Avail Bal: NGN301,302.00.
Alert: Transfer of NGN30,000.00 to M. Bello on 30/05/26. Avail Bal: NGN313,302.00.
Alert: POS double-charge NGN24,000.00 reversed NGN0.00 on 25/05/26. Avail Bal: NGN343,302.00.
Alert: Debit NGN9,500.00 on 20/05/26 for DSTV. Avail Bal: NGN343,302.00.
Alert: Credit of NGN350,000.00 on 05/05/26. Desc: Salary. Avail Bal: NGN352,802.00.
Alert: Withdrawal NGN15,000.00 on 30/04/26 by POS. Avail Bal: NGN2,802.00.
Alert: Insurance debit NGN6,000.00 on 25/04/26. Avail Bal: NGN17,802.00.
Alert: ATM maintenance fee NGN85.00 on 20/04/26. Avail Bal: NGN23,802.00.
Alert: Transfer of NGN70,000.00 to K. Okafor on 12/04/26. Avail Bal: NGN23,887.00.
Alert: Credit of NGN350,000.00 on 05/04/26. Desc: Salary. Avail Bal: NGN93,887.00.
Alert: Withdrawal NGN35,000.00 on 02/04/26 by ATM. Avail Bal: NGN93,887.00.`;
