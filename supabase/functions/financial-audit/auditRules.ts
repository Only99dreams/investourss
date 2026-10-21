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
  /** Months the whole uploaded statement spans (>= 1). */
  statementMonthsCovered: number;
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

const DEFAULT_CHUNK_SIZE = 12000;
const MAX_NUMERIC_15_2_EXCLUSIVE = 10_000_000_000_000;
const LEAKAGE_DESCRIPTION = /\b(bank fee|bank charge|service charge|maintenance fee|commission|stamp duty|vat)\b/i;

// A summary/aggregate line reports a run's closing figure rather than a single
// transaction, e.g. "Closing Balance 90,000.00" or "Total Debit 284,922.80".
// Every bank statement includes these; the row parser must not count them as
// transactions and the detector must not treat them as real rows.
// Forward declaration: used by parseFinancialRecords (below) and defined with
// the detector helpers further down.
function isSummaryLine(line: string): boolean;

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

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeAmount(value: unknown): number {
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
export function coerceIsoDate(value: unknown): string | undefined {
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
    // Skip printed summary/aggregate lines (Total/Closing/Opening balances and
    // totals). They are not transactions; counting them would inflate income
    // and expenses and make the sums disagree with the statement.
    if (isSummaryLine(originalLine)) continue;

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

// ---------------------------------------------------------------------------
// Parser-confidence helpers.
//
// A statement PDF is often extracted COLUMN-GROUPED (all the dates, then all
// the descriptions, then all the debit amounts, then all the credit amounts,
// one column after another) rather than one full row at a time. The row-based
// parser above cannot read that layout: it sees stray bare numbers with no date
// or direction and produces wrong totals. The wording of the column headers
// differs per bank (GTB, Zenith, UBA, Moniepoint, Kuda, PalmPay...), so instead
// of hardcoding bank-specific labels we detect the broken layout by two generic,
// structural signals:
//
//   1. HEADER FRAGMENTATION — the statement declares many table-column headers
//      (Date / Description / Debit / Credit / Balance / Amount / Narration ...)
//      but very few lines carry a date and an amount together (i.e. a real
//      transaction row). Many headers + almost no rows = columns were split.
//   2. PRINTED-TOTAL MISMATCH — most statements print their own "Total Credit"
//      and "Total Debit". If the parser's summed credits/debits disagree with
//      those printed figures, the parser misread the rows.
//
// Either signal alone means "do not trust the deterministic totals; hand the
// raw text to the AI extractor". This works for any bank layout, not just one
// statement type.
// ---------------------------------------------------------------------------
const TABLE_HEADER_WORDS = [
  "date", "value date", "trans. time", "trans time", "transaction date", "posting date",
  "description", "narration", "particulars", "details", "transaction details", "remarks",
  "debit", "credit", "debits", "credits", "amount", "withdrawal", "deposit",
  "balance", "balance after", "running balance", "closing balance", "available balance",
  "channel", "reference", "transaction reference", "txn", "dr", "cr",
];

// A line that is just a header cell: only header words / punctuation / currency
// symbols, no digits other than trivial ones, and quite short.
function isHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return false;
  const stripped = trimmed.toLowerCase().replace(/[₦$.,()/:_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return false;
  // Reject anything that looks like a real amount-bearing row.
  if (/\d{2,}/.test(stripped)) return false;
  const words = stripped.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => TABLE_HEADER_WORDS.includes(word));
}

// A line that plausibly holds a real transaction: carries a recognisable date
// AND a money-like amount.
const ROW_DATE_PATTERN = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]{0,2}\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/;
const ROW_AMOUNT_PATTERN = /(?:₦|NGN)?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₦|NGN)?\s*\d+\.\d{2}/;

function looksLikeRowLine(line: string): boolean {
  return ROW_DATE_PATTERN.test(line) && ROW_AMOUNT_PATTERN.test(line);
}

// A summary/aggregate line reports a run's closing figure rather than a single
// transaction, e.g. "Closing Balance 90,000.00" or "Total Debit 284,922.80".
// Every bank statement includes these, the row parser must not count them as
// transactions, and the detector must not treat them as real rows.
const SUMMARY_LINE_PATTERN = /\b(?:total|closing|opening|sub-?total|balance b\/f|balance c\/f|carried forward)\b/i;

function isSummaryLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (!SUMMARY_LINE_PATTERN.test(trimmed)) return false;
  // A genuine transaction row carries a date; a summary line does not.
  return !ROW_DATE_PATTERN.test(trimmed);
}

// Read a statement's own printed totals (e.g. "Total Credit ... ₦149,058.43"
// or "Credit(s)₦149,058.43"). Returns the credit/debit figures the bank itself
// declares, which we use as ground truth to sanity-check the parser.
function readPrintedTotals(text: string): { credit?: number; debit?: number } {
  const find = (labels: RegExp): number | undefined => {
    // Label, then up to ~30 chars, then an amount on the same or next line.
    const match = labels.exec(text);
    if (!match) return undefined;
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const amountMatch = /(?:₦|NGN)?\s*([+-]?[\d,]+(?:\.\d{1,2})?)/.exec(tail);
    if (!amountMatch) return undefined;
    const value = Number(amountMatch[1].replace(/[,\s]/g, ""));
    return Number.isFinite(value) ? value : undefined;
  };
  const credit = find(/\btotal\s+credits?\b|\bcredits?\s*\(₦\)|\btotal\s+credit\b/i);
  const debit = find(/\btotal\s+debits?\b|\bdebits?\s*\(₦\)|\btotal\s+debit\b/i);
  return { credit, debit };
}

export interface PrintedTotalsComparison {
  printedCredit?: number;
  printedDebit?: number;
  parsedCredits: number;
  parsedDebits: number;
  /** undefined when the statement does not print a matching total. */
  creditMatches?: boolean;
  debitMatches?: boolean;
}

// Compare the parser's credit/debit sums against the totals the statement
// prints itself (its own ground truth). Returns structured detail so callers
// can both judge reliability and show the user how the figures tally.
export function comparePrintedTotals(
  text: string,
  parsedTransactions: ExtractedTransaction[],
  tolerance = 1, // ₦1 rounding tolerance
): PrintedTotalsComparison {
  const printed = readPrintedTotals(text);
  const parsedCredits = roundMoney(
    parsedTransactions.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0),
  );
  const parsedDebits = roundMoney(
    parsedTransactions.filter((t) => t.type === "debit").reduce((sum, t) => sum + t.amount, 0),
  );
  const creditMatches = printed.credit === undefined
    ? undefined
    : Math.abs(parsedCredits - printed.credit) <= tolerance;
  const debitMatches = printed.debit === undefined
    ? undefined
    : Math.abs(parsedDebits - printed.debit) <= tolerance;
  return {
    printedCredit: printed.credit,
    printedDebit: printed.debit,
    parsedCredits,
    parsedDebits,
    creditMatches,
    debitMatches,
  };
}

export interface ParserConfidence {
  reliable: boolean;
  reason: "ok" | "header-fragmented" | "total-mismatch";
}

// Decide whether the deterministic row parser produced a trustworthy reading of
// the statement. Purely structural and bank-agnostic — no per-bank labels.
export function assessParserConfidence(
  text: string,
  parsedTransactions: ExtractedTransaction[],
): ParserConfidence {
  const lines = text.split(/\r?\n/);
  let headerLines = 0;
  let rowLines = 0;
  for (const line of lines) {
    if (isHeaderLine(line)) headerLines += 1;
    // Summary lines (Total/Closing/Openings) are genuine single-row content the
    // row parser should read, so they count toward real rows too.
    else if (looksLikeRowLine(line) || isSummaryLine(line)) rowLines += 1;
  }

  // Signal 1: the export declares a table (several column headers) but the
  // lines carry almost no real rows to match them — the columns were split into
  // separate blocks. This is the classic column-grouped PDF extraction.
  if (headerLines >= 3 && rowLines <= Math.max(2, Math.floor(headerLines / 3))) {
    return { reliable: false, reason: "header-fragmented" };
  }

  // Signal 2: the statement prints its own totals and the parser's sums do not
  // reproduce them. A mismatch is meaningful whenever the statement declares
  // totals; it holds even if the parser read zero rows (0 vs a real printed
  // total is a mismatch).
  const totals = comparePrintedTotals(text, parsedTransactions);
  if (totals.creditMatches === false || totals.debitMatches === false) {
    return { reliable: false, reason: "total-mismatch" };
  }

  return { reliable: true, reason: "ok" };
}

/**
 * Whether the rows in a request must be trusted verbatim.
 *
 * A PDF the OpenCV service read arrives as rows, and those rows ARE the
 * statement — re-reading their text with the AI extractor could change the
 * totals, so the auditor keeps them instead. A CSV/XLSX the browser parsed also
 * arrives as rows that nothing needs to re-read.
 *
 * The one table that is not final on its own is one reconstructed from text
 * without OpenCV, where a column can be mis-assigned; the caller may then fall
 * back to the statement text. Hence `false` for those.
 *
 * This lives in auditRules.ts, not index.ts, so it can be unit-tested without
 * the Deno-only imports the edge function needs.
 */
export function rowsAreFinal(tableReader: string): boolean {
  return tableReader === "opencv" || tableReader === "browser-spreadsheet";
}

export type SheetRoute =
  /** Sum the rows the reader produced. */
  | "sum-rows"
  /** The reader produced a page reading we could not break into rows: report
   *  that, and never silently substitute a different read of the text. */
  | "reader-unreadable"
  /** No page reading; read the statement text (deterministically, then AI). */
  | "read-text";

/**
 * Which reading an audit should use, given what the request carried.
 *
 * A reader that looked at the page is the highest authority on what the page
 * says — higher than a text re-read, which for a scan is OCR output the row
 * parser cannot reassemble. So when a table came from a reader:
 *
 *  - if it yielded transactions, those are the figures (nothing re-reads them);
 *  - if it yielded none, the reader's table still exists and is still the page
 *    reading. The audit reports that it could not be broken into rows instead of
 *    throwing the reading away — because falling through to an AI re-read of
 *    column-grouped OCR text is how a correct ₦50,000/₦12,000 scan becomes
 *    ₦0/₦0 on the audit page while the preview shows the reader's real columns.
 *
 * Only a request that carried no page reading at all (`read-text`, e.g. pasted
 * SMS or a text-only upload) is read from its text.
 */
export function routeSheetAudit(input: {
  tableReader: string;
  hasTable: boolean;
  transactionCount: number;
}): SheetRoute {
  if (rowsAreFinal(input.tableReader)) {
    return input.transactionCount > 0 ? "sum-rows" : "reader-unreadable";
  }
  if (input.transactionCount > 0) return "sum-rows";
  if (input.hasTable) return "sum-rows";
  return "read-text";
}

// Number of calendar months a statement spans, from its earliest to its latest
// dated transaction (at least 1). The audit uses this so it always covers the
// whole uploaded statement rather than trimming it to a fixed month count.
export function monthsCoveredByStatement(
  dates: (string | undefined)[],
  referenceDate = new Date(),
): number {
  const referenceDay = referenceDate.toISOString().slice(0, 10);
  const valid = dates
    .filter((date): date is string => validIsoDate(date) && date <= referenceDay)
    .sort();
  if (valid.length === 0) return 1;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const firstYear = Number(first.slice(0, 4));
  const firstMonth = Number(first.slice(5, 7));
  const lastYear = Number(last.slice(0, 4));
  const lastMonth = Number(last.slice(5, 7));
  return Math.max(1, (lastYear - firstYear) * 12 + (lastMonth - firstMonth) + 1);
}

export function getAuditWindow(
  dates: (string | undefined)[],
  months: number,
  referenceDate = new Date(),
): { periodStart: string; periodEnd: string; auditMonths: number } {
  const auditMonths = Number.isFinite(months) && months >= 1 ? Math.floor(months) : 1;
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
  const seenSignatures = new Set<string>();
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
    // A row is only invalid when it carries no direction, no usable amount, or a
    // date the extractor mangled. An empty description is NOT a reason to drop a
    // row: the money still moved, so it must still count toward income or
    // expenses. This is how a credit/debit row from a column-grouped statement
    // (where the description column may not pair up) stays in the totals.
    if (
      !type
      || !Number.isFinite(amount)
      || magnitude === 0
      || roundedAmount >= MAX_NUMERIC_15_2_EXCLUSIVE
      || (hasDate && !date)
    ) {
      excludedInvalidTransactions += 1;
      continue;
    }
    if (!date) undatedTransactions += 1;

    const rawId = value.transactionId;
    const transactionId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : undefined;
    const resolvedDescription = description || "Transaction";
    // Only drop a row that is an EXACT duplicate of one already kept. Deduping on
    // the source ID alone silently deleted distinct transactions that happen to
    // share a reference (common on wallet exports where many rows carry the same
    // channel/ref code), which understated income and expenses.
    if (transactionId) {
      const signature = [transactionId, date ?? "", resolvedDescription, roundedAmount, type].join("\u0000");
      if (seenSignatures.has(signature)) {
        duplicateRowsIgnored += 1;
        continue;
      }
      seenSignatures.add(signature);
    }

    transactions.push({
      date,
      description: resolvedDescription,
      amount: roundedAmount,
      type,
      category: categoryFromDescription(resolvedDescription),
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
  // Every transaction in the uploaded statement is totalled, so the figures are
  // exactly the statement's own columns: total income is the sum of ALL credit
  // rows and total expenses the sum of ALL debit rows. The selected months are
  // reported (periodStart/periodEnd, the monthly breakdown, statementMonthsCovered)
  // but they no longer trim the totals — trimming is what made an audited
  // statement show less income than the Credit column printed on it.
  const statementDates = normalized.transactions.map((transaction) => transaction.date);
  const statementMonthsCovered = monthsCoveredByStatement(statementDates, referenceDate);
  const auditMonths = Number.isFinite(requestedMonths) && requestedMonths >= 1
    ? Math.floor(requestedMonths)
    : 1;
  const window = getAuditWindow(statementDates, auditMonths, referenceDate);
  // Nothing is trimmed, so no row is excluded from the totals: every credit and
  // every debit in the statement counts. Kept at zero for the data-quality block,
  // which still reports rows dropped for other reasons.
  const excludedUndatedTransactions = 0;
  const selectedTransactions = normalized.transactions
    .slice()
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
    statementMonthsCovered,
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
