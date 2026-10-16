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
  score: number;
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
const DEFAULT_CHUNK_SIZE = 12000;
const MAX_NUMERIC_15_2_EXCLUSIVE = 10_000_000_000_000;
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

function normalizeAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const normalized = value
    .trim()
    .replace(/^(?:NGN|₦)\s*/i, "")
    .replace(/\s*(?:NGN|₦)$/i, "")
    .replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

export interface ExtractedTransaction {
  date?: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  transactionId?: string;
}

const SOURCE_DATE_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g;
const FALLBACK_AMOUNT_PATTERN = /[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/;
const CURRENCY_AMOUNT_PATTERN = /(?:NGN|₦)\s*([+-]?[\d,]+(?:\.\d{1,2})?)|([+-]?[\d,]+(?:\.\d{1,2})?)\s*(?:NGN|₦)/i;
const MARKED_AMOUNT_PATTERN = new RegExp(
  `(${FALLBACK_AMOUNT_PATTERN.source})\\s*(CR|DR)\\b|\\b(CR|DR)\\s*(${FALLBACK_AMOUNT_PATTERN.source})`,
  "i",
);
const BARE_AMOUNT_PATTERN = /(?:^|\s)([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}|\d{1,3}(?:,\d{3})+|\d+))(?=$|\s)/g;
const CREDIT_WORDS = /\b(credit|cr|deposit|transfer from|payment received|salary|funding|interest)\b/i;
const DEBIT_WORDS = /\b(debit|dr|withdraw|transfer to|transfer of|payment to|outgoing|sent to|charged|deducted|pos|atm|bill|airtime|charge|fee)\b/i;

function parseSourceDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  const year = Number(iso?.[1] ?? local?.[3]);
  const month = Number(iso?.[2] ?? local?.[2]);
  const day = Number(iso?.[3] ?? local?.[1]);
  if (!iso && !local) return undefined;
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    parsed.getUTCFullYear() !== fullYear
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return undefined;
  return parsed.toISOString().slice(0, 10);
}

export function parseFinancialRecords(text: string): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const originalLine of lines) {
    const line = originalLine.replace(/\b(?:avail(?:able)?\s+bal(?:ance)?|closing\s+balance)\b[:\s].*$/i, "");
    const dateToken = line.match(SOURCE_DATE_PATTERN)?.[0];
    const transactionDate = dateToken ? parseSourceDate(dateToken) : undefined;
    const withoutDate = line.replace(SOURCE_DATE_PATTERN, " ");
    const currencyMatch = CURRENCY_AMOUNT_PATTERN.exec(withoutDate);
    const markedMatch = MARKED_AMOUNT_PATTERN.exec(withoutDate);
    let rawAmount = currencyMatch?.[1] ?? currencyMatch?.[2] ?? markedMatch?.[1] ?? markedMatch?.[4];

    if (!rawAmount) {
      BARE_AMOUNT_PATTERN.lastIndex = 0;
      rawAmount = BARE_AMOUNT_PATTERN.exec(withoutDate)?.[1];
    }
    if (!rawAmount) continue;

    const amount = Number(rawAmount.replace(/[\s,]/g, ""));
    if (!Number.isFinite(amount) || amount === 0) continue;

    const marker = markedMatch?.[2] ?? markedMatch?.[3];
    const isCredit = CREDIT_WORDS.test(line);
    const isDebit = DEBIT_WORDS.test(line);
    let type: "credit" | "debit";
    if (marker) {
      type = marker.toLowerCase() === "cr" ? "credit" : "debit";
    } else if (isCredit !== isDebit) {
      type = isCredit ? "credit" : "debit";
    } else if (rawAmount.trimStart().startsWith("+") || rawAmount.trimStart().startsWith("-")) {
      type = rawAmount.trimStart().startsWith("+") ? "credit" : "debit";
    } else {
      continue;
    }

    const transactionId = /\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*([A-Z0-9-]+)/i.exec(line)?.[1];
    const description = line
      .replace(SOURCE_DATE_PATTERN, " ")
      .replace(CURRENCY_AMOUNT_PATTERN, " ")
      .replace(MARKED_AMOUNT_PATTERN, " ")
      .replace(BARE_AMOUNT_PATTERN, " ")
      .replace(/\b(?:CR|DR|NGN|Avail Bal|Available Balance|Closing Balance|Txn ID|Acct|Account)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    transactions.push({
      date: transactionDate,
      description: description || (type === "credit" ? "Credit received" : "Debit"),
      amount: Math.abs(amount),
      type,
      transactionId,
    });
  }

  return transactions;
}

export function getAuditWindow(
  dates: (string | undefined)[],
  months: number,
  referenceDate = new Date(),
): { periodStart: string; periodEnd: string; auditMonths: number } {
  const auditMonths = VALID_MONTHS.includes(months) ? months : 1;
  const referenceDay = referenceDate.toISOString().slice(0, 10);
  // Anchor the audit on the FIRST month present in the statement so an uploaded
  // statement (e.g. January to December) is always audited from the earliest
  // month: a 1-month audit of a Jan-Dec statement covers January, a 3-month
  // audit covers January to March, and so on.
  const earliestTransactionDate = dates
    .filter((date): date is string => validIsoDate(date) && date <= referenceDay)
    .sort()
    .at(0);
  const anchor = earliestTransactionDate
    ? new Date(`${earliestTransactionDate}T12:00:00.000Z`)
    : new Date(`${referenceDay}T12:00:00.000Z`);
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + auditMonths, 0));
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
    const direction = typeof value.type === "string" ? value.type.trim().toLowerCase() : "";
    const type = direction === "credit" || direction === "cr"
      ? "credit"
      : direction === "debit" || direction === "dr"
        ? "debit"
        : null;
    const amount = normalizeAmount(value.amount);
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const hasDate = value.date !== undefined && value.date !== null && value.date !== "";
    const date = validIsoDate(value.date) ? value.date : undefined;
    const roundedAmount = roundMoney(amount);
    if (
      !type
      || !Number.isFinite(amount)
      || amount <= 0
      || roundedAmount >= MAX_NUMERIC_15_2_EXCLUSIVE
      || !description
      || (hasDate && !date)
    ) {
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
      amount: roundedAmount,
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
  const selectedTransactions = normalized.transactions
    .filter((transaction) => !transaction.date || (transaction.date >= window.periodStart && transaction.date <= window.periodEnd))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")
      || a.description.localeCompare(b.description)
      || a.amount - b.amount
      || a.type.localeCompare(b.type));
  const totalsByType = new Map<FinancialTransaction["type"], number>();
  const transactions: FinancialTransaction[] = [];
  for (const transaction of selectedTransactions) {
    const nextTotal = roundMoney((totalsByType.get(transaction.type) ?? 0) + transaction.amount);
    if (!Number.isFinite(nextTotal) || nextTotal >= MAX_NUMERIC_15_2_EXCLUSIVE) {
      normalized.excludedInvalidTransactions += 1;
      continue;
    }
    totalsByType.set(transaction.type, nextTotal);
    transactions.push(transaction);
  }
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
    score: healthScore,
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
