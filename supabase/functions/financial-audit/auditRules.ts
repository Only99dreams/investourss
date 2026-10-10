export const FINANCIAL_AUDIT_RULES_VERSION = "1.0.0";

export type FinancialTransaction = {
  date?: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  category: string;
  transactionId?: string;
};

export interface FinancialAuditRulesResult {
  rulesVersion: string;
  periodStart: string;
  periodEnd: string;
  auditMonths: number;
  totalIncome: number;
  totalExpenses: number;
  cashFlow: number;
  savingsRate: number;
  healthScore: number;
  healthStatus: "excellent" | "good" | "needs_attention" | "critical";
  recoverableAmount: number;
  recoverable: { description: string; amount: number; category: string }[];
  transactions: FinancialTransaction[];
  monthlyObservations: { month: string; income: number; outflows: number; source: "calculated"; verification: "unverified" }[];
  monthlyScores: { month: string; score: number }[];
  incomeSources: { name: string; amount: number }[];
  topSpendingCategories: { name: string; amount: number }[];
  leakages: { description: string; amount: number; category: string }[];
  dataQuality: { excludedInvalidTransactions: number; duplicateRowsIgnored: number; undatedTransactions: number };
}

const VALID_MONTHS = [1, 3, 6];
const DEFAULT_CHUNK_SIZE = 24000;
const LEAKAGE_DESCRIPTION = /\b(bank fee|bank charge|service charge|maintenance fee|commission|stamp duty|vat)\b/i;

function categoryFromDescription(description: string): string {
  const value = description.toLowerCase();
  if (LEAKAGE_DESCRIPTION.test(value)) return "bank charges";
  if (/\b(pos|atm|withdrawal)\b/.test(value)) return "withdrawals";
  if (/\b(airtime|data bundle|mobile data)\b/.test(value)) return "airtime & data";
  if (/\b(transfer|sent to|received from)\b/.test(value)) return "transfers";
  if (/\b(rent|landlord|housing)\b/.test(value)) return "rent";
  if (/\b(salary|wages|payroll)\b/.test(value)) return "salary";
  if (/\b(electricity|utility|water bill|internet bill)\b/.test(value)) return "utilities";
  if (/\b(food|restaurant|grocery|supermarket|market)\b/.test(value)) return "food & shopping";
  return "other";
}

export function splitFinancialRecords(text: string, maxCharacters = DEFAULT_CHUNK_SIZE): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let offset = 0; offset < line.length; offset += maxCharacters) {
        chunks.push(line.slice(offset, offset + maxCharacters));
      }
      continue;
    }
    if (current.length + line.length > maxCharacters) {
      chunks.push(current);
      current = "";
    }
    current += line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getAuditWindow(
  dates: (string | undefined)[],
  months: number,
  referenceDate = new Date(),
): { periodStart: string; periodEnd: string; auditMonths: number } {
  const auditMonths = VALID_MONTHS.includes(months) ? months : 1;
  const referenceDay = referenceDate.toISOString().slice(0, 10);
  const latestTransactionDate = dates
    .filter((date): date is string => validIsoDate(date) && date <= referenceDay)
    .sort()
    .at(-1);
  const end = latestTransactionDate
    ? new Date(`${latestTransactionDate}T12:00:00.000Z`)
    : new Date(referenceDate);
  const start = new Date(end);
  const dayOfMonth = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - auditMonths);
  const lastDayOfTargetMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    auditMonths,
  };
}

function normalizeTransactions(raw: unknown[]): {
  transactions: FinancialTransaction[];
  excludedInvalidTransactions: number;
  duplicateRowsIgnored: number;
  undatedTransactions: number;
} {
  const seenIds = new Set<string>();
  let excludedInvalidTransactions = 0;
  let duplicateRowsIgnored = 0;
  let undatedTransactions = 0;
  const transactions: FinancialTransaction[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      excludedInvalidTransactions += 1;
      continue;
    }
    const value = item as Record<string, unknown>;
    const type = value.type === "credit" || value.type === "debit" ? value.type : null;
    const amount = Number(value.amount);
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const hasDate = value.date !== undefined && value.date !== null && value.date !== "";
    const date = validIsoDate(value.date) ? value.date : undefined;
    if (!type || !Number.isFinite(amount) || amount <= 0 || !description || (hasDate && !date)) {
      excludedInvalidTransactions += 1;
      continue;
    }
    if (!date) undatedTransactions += 1;

    const rawId = value.transactionId;
    const transactionId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : undefined;
    if (transactionId && seenIds.has(transactionId)) {
      duplicateRowsIgnored += 1;
      continue;
    }
    if (transactionId) seenIds.add(transactionId);

    transactions.push({
      date,
      description,
      amount: roundMoney(amount),
      type,
      category: categoryFromDescription(description),
      transactionId,
    });
  }

  return { transactions, excludedInvalidTransactions, duplicateRowsIgnored, undatedTransactions };
}

function scoreHealth(totalIncome: number, totalExpenses: number, leakageCount: number): number {
  const cashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (cashFlow / totalIncome) * 100 : 0;
  let score = 55;
  if (cashFlow > 0) score += 15;
  if (savingsRate >= 20) score += 10;
  else if (savingsRate >= 10) score += 5;
  score -= Math.min(15, leakageCount * 2);
  return Math.max(10, Math.min(95, Math.round(score)));
}

function statusFromScore(score: number): FinancialAuditRulesResult["healthStatus"] {
  return score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "needs_attention" : "critical";
}

function sumBy<T>(items: T[], key: (item: T) => string, amount: (item: T) => number) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + amount(item));
  return [...totals.entries()]
    .map(([name, value]) => ({ name, amount: roundMoney(value) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function applyFinancialAuditRules(
  rawTransactions: unknown[],
  requestedMonths: number,
  referenceDate = new Date(),
): FinancialAuditRulesResult {
  const normalized = normalizeTransactions(rawTransactions);
  const window = getAuditWindow(normalized.transactions.map((transaction) => transaction.date), requestedMonths, referenceDate);
  const transactions = normalized.transactions
    .filter((transaction) => !transaction.date || (transaction.date >= window.periodStart && transaction.date <= window.periodEnd))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")
      || a.description.localeCompare(b.description)
      || a.amount - b.amount
      || a.type.localeCompare(b.type));
  const credits = transactions.filter((transaction) => transaction.type === "credit");
  const debits = transactions.filter((transaction) => transaction.type === "debit");
  const totalIncome = roundMoney(credits.reduce((sum, transaction) => sum + transaction.amount, 0));
  const totalExpenses = roundMoney(debits.reduce((sum, transaction) => sum + transaction.amount, 0));
  const cashFlow = roundMoney(totalIncome - totalExpenses);
  const savingsRate = totalIncome > 0 ? Math.max(0, Math.min(100, roundMoney((cashFlow / totalIncome) * 100))) : 0;
  const leakages = debits
    .filter((transaction) => LEAKAGE_DESCRIPTION.test(transaction.description))
    .map((transaction) => ({ description: transaction.description, amount: transaction.amount, category: transaction.category }));
  const healthScore = scoreHealth(totalIncome, totalExpenses, leakages.length);
  const datedTransactions = transactions.filter((transaction) => transaction.date);
  const monthlyObservations = sumMonthly(datedTransactions);
  const monthlyScores = scoreMonthly(datedTransactions);

  return {
    rulesVersion: FINANCIAL_AUDIT_RULES_VERSION,
    ...window,
    totalIncome,
    totalExpenses,
    cashFlow,
    savingsRate,
    healthScore,
    healthStatus: statusFromScore(healthScore),
    recoverableAmount: 0,
    recoverable: [],
    transactions,
    monthlyObservations,
    monthlyScores,
    incomeSources: sumBy(credits, (transaction) => transaction.description, (transaction) => transaction.amount).slice(0, 10),
    topSpendingCategories: sumBy(debits, (transaction) => transaction.category, (transaction) => transaction.amount).slice(0, 10),
    leakages,
    dataQuality: {
      excludedInvalidTransactions: normalized.excludedInvalidTransactions,
      duplicateRowsIgnored: normalized.duplicateRowsIgnored,
      undatedTransactions: transactions.filter((transaction) => !transaction.date).length,
    },
  };
}

function sumMonthly(transactions: FinancialTransaction[]): FinancialAuditRulesResult["monthlyObservations"] {
  const months = new Map<string, { month: string; income: number; outflows: number }>();
  for (const transaction of transactions) {
    if (!transaction.date) continue;
    const month = transaction.date.slice(0, 7);
    const total = months.get(month) ?? { month, income: 0, outflows: 0 };
    total[transaction.type === "credit" ? "income" : "outflows"] += transaction.amount;
    months.set(month, total);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((total) => ({
    ...total,
    income: roundMoney(total.income),
    outflows: roundMoney(total.outflows),
    source: "calculated",
    verification: "unverified",
  }));
}

function scoreMonthly(transactions: FinancialTransaction[]): FinancialAuditRulesResult["monthlyScores"] {
  const observations = sumMonthly(transactions);
  return observations.map(({ month, income, outflows }) => ({
    month,
    score: scoreHealth(income, outflows, transactions.filter((transaction) =>
      transaction.date?.startsWith(month) && transaction.type === "debit" && LEAKAGE_DESCRIPTION.test(transaction.description)
    ).length),
  }));
}
