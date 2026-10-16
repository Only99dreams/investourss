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
  dataQuality: { excludedInvalidTransactions: number; duplicateRowsIgnored: number; undatedTransactions: number; excludedUndatedTransactions: number };
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

const SOURCE_DATE_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]{0,2}\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/g;
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const FALLBACK_AMOUNT_PATTERN = /[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/;
const CURRENCY_AMOUNT_PATTERN = /(?:NGN|₦)\s*([+-]?[\d,]+(?:\.\d{1,2})?)|([+-]?[\d,]+(?:\.\d{1,2})?)\s*(?:NGN|₦)/i;
const MARKED_AMOUNT_PATTERN = new RegExp(
  `(${FALLBACK_AMOUNT_PATTERN.source})\\s*(CR|DR)\\b|\\b(CR|DR)\\s*(${FALLBACK_AMOUNT_PATTERN.source})`,
  "i",
);
const BARE_AMOUNT_PATTERN = /(?:^|\s)([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}|\d{1,3}(?:,\d{3})+|\d+))(?=$|\s)/g;
// A balance is never a transaction amount. Strip the label and its figure (but
// not the rest of the line) so trailing references such as "Txn ID: 1001" survive
// and can still be used to deduplicate. The figure is captured so it can be used
// to reconcile direction when a row's description carries no direction word.
const BALANCE_TOKEN_PATTERN = /\b(?:avail(?:able)?\s+bal(?:ance)?|closing\s+bal(?:ance)?|opening\s+bal(?:ance)?|ledger\s+bal(?:ance)?|running\s+bal(?:ance)?|book\s+bal(?:ance)?|bal(?:ance)?)\b\s*[:=]?\s*(?:NGN|₦)?\s*([\d,]+(?:\.\d{1,2})?)/gi;
const SOURCE_ID_CLEANUP_PATTERN = /\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*[A-Z0-9-]+/gi;
const CREDIT_WORDS = /\b(credit|cr|deposit|transfer from|payment received|salary|funding|interest|refund|inward|remittance)\b/i;
const DEBIT_WORDS = /\b(debit|dr|withdraw|transfer to|transfer of|payment to|outgoing|sent to|charged|deducted|pos|atm|bill|airtime|charge|fee|purchase|outward|levy)\b/i;

function parseSourceDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  const dayFirstName = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]{0,2}(\d{2,4})$/.exec(value);
  const nameFirst = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    year = Number(local[3]);
    month = Number(local[2]);
    day = Number(local[1]);
  } else if (dayFirstName) {
    year = Number(dayFirstName[3]);
    month = MONTH_NAMES[dayFirstName[2].slice(0, 3).toLowerCase()] ?? Number.NaN;
    day = Number(dayFirstName[1]);
  } else if (nameFirst) {
    year = Number(nameFirst[3]);
    month = MONTH_NAMES[nameFirst[1].slice(0, 3).toLowerCase()] ?? Number.NaN;
    day = Number(nameFirst[2]);
  } else {
    return undefined;
  }
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    !Number.isFinite(month)
    || parsed.getUTCFullYear() !== fullYear
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return undefined;
  return parsed.toISOString().slice(0, 10);
}

// The model is asked for ISO dates, but it sometimes returns "10/02/2025" or a
// full "2025-02-10T00:00:00Z". A row with a real, recoverable date should not be
// thrown away (that would silently drop money from the totals), so try to parse
// whatever date is present before treating it as missing.
function coerceIsoDate(value: unknown): string | undefined {
  if (validIsoDate(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // Accept an ISO datetime ("2025-02-10T00:00:00Z") by taking its date part.
  const isoPrefix = trimmed.slice(0, 10);
  if (validIsoDate(isoPrefix)) return isoPrefix;
  const token = trimmed.match(SOURCE_DATE_PATTERN)?.[0];
  return token ? parseSourceDate(token) : undefined;
}

// Choose the transaction amount from the numbers found on a line. Statement
// rows often carry a leading serial number and/or a trailing running balance, so
// prefer a number that looks like money (has a decimal point or thousands
// grouping) and ignore zeros (an empty debit/credit column).
function pickAmount(
  entries: { raw: string; value: number }[],
): { raw: string; value: number } | undefined {
  const nonZero = entries.filter((entry) => entry.value !== 0);
  if (nonZero.length === 0) return undefined;
  return nonZero.find((entry) => /[.,]/.test(entry.raw)) ?? nonZero[0];
}

// Some PDF exports glue table columns together and some banks use a space as a
// thousands separator. Normalise each line so the amount parser can read it:
//   "10 000.00 690 000.00"          -> "10000.00 690000.00"
//   "250,000.00700,000.00"          -> "250,000.00 700,000.00"
//   "10,000.00CR"                   -> "10,000.00 CR"
//   "TRANSFER FROM JOHN250,000.00"  -> "TRANSFER FROM JOHN 250,000.00"
function normalizeStatementLine(line: string): string {
  let value = line.replace(/\u00A0/g, " ");
  // Merge space-separated thousands ("1 250 000.00" -> "1250000.00").
  let previous: string;
  do {
    previous = value;
    value = value.replace(/(\d)\s(?=\d{3}(?:\D|$))/g, "$1");
  } while (value !== previous);
  // Separate an amount from digits glued to its decimals ("...00" + "700...").
  // Require a full two-decimal fraction so a normal amount like "100,000.00"
  // (which ends the cell) is never split.
  value = value.replace(/(\.\d{2})(?=\d)/g, "$1 ");
  // Separate a number from an immediately following CR/DR marker.
  value = value.replace(/(\d)(?=(?:CR|DR)\b)/gi, "$1 ");
  // Separate a trailing number (often a date) from a glued word, e.g.
  // "06/08/2026POS PURCHASE" -> "06/08/2026 POS PURCHASE". Without this the date
  // never matches and a leading keyword (e.g. "TRANSFER") loses its word
  // boundary, so the row's direction cannot be read.
  value = value.replace(/(\d)(?=[A-Za-z]{2,})/g, "$1 ");
  // Separate letters from a following money-like amount.
  value = value.replace(/([A-Za-z])(?=(?:\d{1,3}(?:,\d{3})+|\d+\.\d{1,2}))/g, "$1 ");
  return value;
}

export function parseFinancialRecords(text: string): ExtractedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeStatementLine(line).trim())
    .filter(Boolean);

  type ParsedRow = {
    date?: string;
    description: string;
    amount: number;
    explicitType?: "credit" | "debit";
    balance?: number;
    transactionId?: string;
    balanceOnly?: boolean;
  };

  const rows: ParsedRow[] = [];

  for (const originalLine of lines) {
    const transactionId = /\b(?:txn(?:\s*id)?|transaction(?:\s*id)?|reference|ref)\s*[:#-]?\s*([A-Z0-9-]+)/i.exec(originalLine)?.[1];

    // Capture a labelled running balance before it is stripped from the line.
    let labelledBalance: number | undefined;
    BALANCE_TOKEN_PATTERN.lastIndex = 0;
    const balanceMatch = BALANCE_TOKEN_PATTERN.exec(originalLine);
    if (balanceMatch) {
      const value = Number(balanceMatch[1].replace(/[\s,]/g, ""));
      if (Number.isFinite(value)) labelledBalance = value;
    }

    const dateToken = originalLine.match(SOURCE_DATE_PATTERN)?.[0];
    const transactionDate = dateToken ? parseSourceDate(dateToken) : undefined;

    // Remove balances, references, dates and currency symbols, then read every
    // amount that remains. BARE_AMOUNT_PATTERN never matches inside "NGN250.00",
    // so the currency symbols are blanked out first to expose those amounts.
    const amountText = originalLine
      .replace(BALANCE_TOKEN_PATTERN, " ")
      .replace(SOURCE_ID_CLEANUP_PATTERN, " ")
      .replace(SOURCE_DATE_PATTERN, " ")
      .replace(/(?:NGN|₦)/gi, " ");
    const amounts: { raw: string; value: number }[] = [];
    BARE_AMOUNT_PATTERN.lastIndex = 0;
    for (let match = BARE_AMOUNT_PATTERN.exec(amountText); match; match = BARE_AMOUNT_PATTERN.exec(amountText)) {
      const value = Number(match[1].replace(/[\s,]/g, ""));
      if (Number.isFinite(value)) amounts.push({ raw: match[1], value });
    }
    if (amounts.length === 0) {
      // A line that is only a labelled balance (e.g. "Opening Balance 100,000.00")
      // is not a transaction, but it anchors the running balance so the first
      // real transaction can still be given a direction.
      if (labelledBalance !== undefined) {
        rows.push({
          date: transactionDate,
          description: "",
          amount: 0,
          balance: labelledBalance,
          transactionId,
          balanceOnly: true,
        });
      }
      continue;
    }

    // The last number on a statement row is the running balance, unless a label
    // already gave us one. The transaction amount is the money-like number that
    // remains (ignoring an empty 0.00 debit/credit column).
    let balance = labelledBalance;
    let chosen: { raw: string; value: number } | undefined;
    if (labelledBalance === undefined && amounts.length >= 2) {
      balance = amounts[amounts.length - 1].value;
      chosen = pickAmount(amounts.slice(0, -1));
    } else {
      chosen = pickAmount(amounts);
    }
    if (!chosen || chosen.value === 0) continue;

    const marker = MARKED_AMOUNT_PATTERN.exec(originalLine);
    const markerValue = (marker?.[2] ?? marker?.[3])?.toLowerCase();
    const isCredit = CREDIT_WORDS.test(originalLine);
    const isDebit = DEBIT_WORDS.test(originalLine);
    let explicitType: "credit" | "debit" | undefined;
    if (markerValue === "cr" || markerValue === "dr") {
      explicitType = markerValue === "cr" ? "credit" : "debit";
    } else if (isCredit !== isDebit) {
      explicitType = isCredit ? "credit" : "debit";
    } else if (/^[+-]/.test(chosen.raw.trim())) {
      explicitType = chosen.raw.trim().startsWith("+") ? "credit" : "debit";
    }

    const description = originalLine
      .replace(SOURCE_ID_CLEANUP_PATTERN, " ")
      .replace(BALANCE_TOKEN_PATTERN, " ")
      .replace(SOURCE_DATE_PATTERN, " ")
      .replace(CURRENCY_AMOUNT_PATTERN, " ")
      .replace(MARKED_AMOUNT_PATTERN, " ")
      .replace(BARE_AMOUNT_PATTERN, " ")
      .replace(/\b(?:CR|DR|NGN|Avail Bal|Available Balance|Closing Balance|Txn ID|Acct|Account)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    rows.push({
      date: transactionDate,
      description,
      amount: Math.abs(chosen.value),
      explicitType,
      balance,
      transactionId,
    });
  }

  // Rows whose description carries no direction word can still be read from the
  // running balance: a row's own balance differs from an adjacent row's balance
  // by exactly its transaction amount, and the sign of that difference gives the
  // direction. This works whether the statement runs oldest-first or newest-first,
  // so it handles most banks regardless of column layout.
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.balanceOnly || row.explicitType !== undefined || row.balance === undefined) continue;
    for (const neighbourIndex of [index - 1, index + 1]) {
      const neighbour = rows[neighbourIndex];
      if (!neighbour || neighbour.balance === undefined) continue;
      const delta = roundMoney(row.balance - neighbour.balance);
      if (Math.abs(Math.abs(delta) - row.amount) <= 0.01) {
        row.explicitType = delta > 0 ? "credit" : "debit";
        break;
      }
    }
  }

  const transactions: ExtractedTransaction[] = [];
  for (const row of rows) {
    if (row.balanceOnly || !row.explicitType) continue;
    transactions.push({
      date: row.date,
      description: row.description || (row.explicitType === "credit" ? "Credit received" : "Debit"),
      amount: row.amount,
      type: row.explicitType,
      transactionId: row.transactionId,
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
    // Direction lives in `type`, so a signed amount carries no extra meaning:
    // use its magnitude. Models commonly write debits as negative numbers, and
    // dropping those rows would understate income/expenses.
    const magnitude = Math.abs(amount);
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const hasDate = value.date !== undefined && value.date !== null && value.date !== "";
    const date = coerceIsoDate(value.date);
    const roundedAmount = roundMoney(magnitude);
    if (
      !type
      || !Number.isFinite(amount)
      || magnitude === 0
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
  // Undated rows can't be placed inside a dated audit window. Keeping them would
  // silently inflate the audited month's totals (and make them disagree with the
  // dated monthly breakdown), so they are only kept when the entire dataset is
  // undated and the window has nothing better to anchor on.
  const hasDatedTransactions = normalized.transactions.some((transaction) => Boolean(transaction.date));
  let excludedUndatedTransactions = 0;
  const selectedTransactions = normalized.transactions
    .filter((transaction) => {
      if (transaction.date) return transaction.date >= window.periodStart && transaction.date <= window.periodEnd;
      if (hasDatedTransactions) {
        excludedUndatedTransactions += 1;
        return false;
      }
      return true;
    })
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
      excludedUndatedTransactions,
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
