import {
  coerceIsoDate,
  normalizeAmount,
  roundMoney,
  type ExtractedTransaction,
} from "./auditRules.ts";

// ---------------------------------------------------------------------------
// Spreadsheet-first transaction extraction.
//
// Every input format (CSV, XLSX, and a PDF that has been reconstructed into a
// table) converges on the same shape: a table of cells. This module turns that
// table into transaction rows deterministically — header detection, column
// mapping, direction resolution, summary-row removal and balance reconciliation
// — with no AI involved. The AI is never asked to read or calculate a number.
//
// See docs/financial-auditor-v2.md for the design.
// ---------------------------------------------------------------------------

export type Table = (string | number)[][];

export type ColumnRole =
  | "date"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "type"
  | "balance"
  | "reference"
  | "ignore";

export interface SheetReconciliation {
  opening?: number;
  closing?: number;
  credits: number;
  debits: number;
  expectedClosing?: number;
  difference?: number;
  reconciled: boolean;
}

export interface SheetParseResult {
  transactions: ExtractedTransaction[];
  columns: Partial<Record<ColumnRole, number>>;
  reconciliation: SheetReconciliation;
  warnings: string[];
}

export function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : String(value).trim();
}

function num(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  return normalizeAmount(cellText(value));
}

// Words that mark a row as an aggregate/closing figure rather than a
// transaction. A row that reads like this AND carries no date is skipped.
const SUMMARY_WORDS = /\b(total|totals|closing|opening|sub-?total|balance b\/f|balance c\/f|brought forward|carried forward)\b/i;
const OPENING_WORDS = /\b(opening|balance b\/f|brought forward)\b/i;
const CLOSING_WORDS = /\b(closing|balance c\/f|carried forward)\b/i;

// Classify one header cell into the column role it names. Bank-agnostic:
// matches on generic statement vocabulary, never a specific bank's layout.
export function classifyHeader(raw: string): ColumnRole {
  const text = raw.toLowerCase().replace(/[^a-z0-9+/()]+/g, " ").trim();
  if (!text) return "ignore";
  if (/(\bref\b|reference|txn|cheque|transaction id|chq|cheque no)/.test(text)) return "reference";
  if (/\bdate\b/.test(text) || text.includes("trans time") || text.includes("transaction time") || text.includes("posting date") || text.includes("value date")) return "date";
  if (/(description|narration|particulars|details|memo|remarks|narrative|transaction details|history)/.test(text)) return "description";
  if (
    /\b(debit|debits|debit amount|debits amount|withdrawal|withdrawals|withdraw|dr|dr amount|paid out|payout|outflow|outflows)\b/.test(text) ||
    /(money out|pay out|amount out|outward)/.test(text) ||
    /\bdebit\b/.test(text) && /\bamount\b/.test(text) ||
    /\(dr\)/.test(text)
  ) return "debit";
  if (
    /\b(credit|credits|credit amount|credits amount|deposit|deposits|cr|cr amount|lodgement|lodgements|paid in|payin|inflow|inflows)\b/.test(text) ||
    /(money in|pay in|amount in|inward)/.test(text) ||
    /\bcredit\b/.test(text) && /\bamount\b/.test(text) ||
    /\(cr\)/.test(text)
  ) return "credit";
  if (/\b(amount|value|transaction amount|trans amount)\b/.test(text) && !/\b(balance)\b/.test(text)) return "amount";
  if (/\b(type|direction|dr cr|dr\/cr)\b/.test(text) || text.includes("dr/cr")) return "type";
  if (/\bbalance\b/.test(text)) return "balance";
  return "ignore";
}

function typeFromCell(raw: string): "credit" | "debit" | null {
  const text = raw.toLowerCase();
  if (/\b(cr|credit|deposit|in)\b/.test(text)) return "credit";
  if (/\b(dr|debit|withdrawal|out)\b/.test(text)) return "debit";
  return null;
}

interface DetectedHeader {
  index: number;
  roles: Partial<Record<ColumnRole, number>>;
  row: Table[number];
}

// Find the header row: the earliest row that names at least two columns, one of
// which is a money column or a date+description pair.
export function detectHeader(rows: Table): DetectedHeader | null {
  let best: { index: number; roles: Partial<Record<ColumnRole, number>>; score: number } | null = null;
  const limit = Math.min(rows.length, 50);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const roles: Partial<Record<ColumnRole, number>> = {};
    let score = 0;
    row.forEach((cell, col) => {
      const role = classifyHeader(cellText(cell));
      if (role === "ignore") return;
      if (roles[role] === undefined) roles[role] = col;
      score += 1;
    });
    const hasMoney = roles.debit !== undefined || roles.credit !== undefined
      || roles.amount !== undefined || roles.balance !== undefined;
    const hasCore = (roles.date !== undefined && roles.description !== undefined) || hasMoney || (roles.date !== undefined && hasMoney);
    if (score >= 1 && hasCore && (!best || score > best.score)) {
      best = { index: i, roles, score };
    }
  }
  // Fallback: if no header found but table has numeric data, try to infer columns
  if (!best && rows.length > 1) {
    // Look for rows with numbers that might be transactions
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i] ?? [];
      const roles: Partial<Record<ColumnRole, number>> = {};
      let score = 0;
      row.forEach((cell, col) => {
        const text = cellText(cell).toLowerCase();
        if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
          if (roles.date === undefined) { roles.date = col; score += 1; }
        } else if (/[₦$€£]?\s*\d+[.,]\d{2}/.test(text) || /^\d+[.,]\d{2}$/.test(text.replace(/,/g,''))) {
          // Could be amount - assign to amount if no money columns
          if (roles.amount === undefined && roles.debit === undefined && roles.credit === undefined) {
            roles.amount = col; score += 1;
          }
        } else if (text.length > 3 && !/^[\d\s,.-]+$/.test(text) && roles.description === undefined) {
          roles.description = col; score += 1;
        }
      });
      if (score >= 2) {
        best = { index: i, roles, score };
        break;
      }
    }
  }
  return best ? { index: best.index, roles: best.roles, row: rows[best.index] ?? [] } : null;
}

function isRepeatedHeader(row: Table[number], headerRow: Table[number]): boolean {
  if (row.length !== headerRow.length) return false;
  let compared = 0;
  for (let i = 0; i < row.length; i++) {
    const a = cellText(row[i]).toLowerCase();
    const b = cellText(headerRow[i]).toLowerCase();
    if (!a && !b) continue;
    if (a !== b) return false;
    compared += 1;
  }
  return compared >= 2;
}

// Reconstruct a description when the table has no recognised description column:
// keep every non-money, non-date text cell.
function fallbackDescription(row: Table[number], roles: DetectedHeader["roles"]): string {
  const used = new Set(Object.values(roles).filter((value): value is number => value !== undefined));
  const parts: string[] = [];
  row.forEach((cell, index) => {
    if (used.has(index)) return;
    const text = cellText(cell);
    if (text && !/^[\d.,+\-()]+$/.test(text)) parts.push(text);
  });
  return parts.join(" ").trim();
}

interface ResolvedAmount {
  amount: number;
  type: "credit" | "debit" | null;
  balance: number;
}

// Decide a row's amount and direction from the mapped columns, in order of
// reliability: explicit debit/credit columns, then amount + type, then a signed
// amount, then the change in the running balance.
function resolveAmount(
  row: Table[number],
  roles: DetectedHeader["roles"],
  previousBalance: number,
): ResolvedAmount {
  const debitValue = roles.debit !== undefined ? num(row[roles.debit]) : Number.NaN;
  const creditValue = roles.credit !== undefined ? num(row[roles.credit]) : Number.NaN;
  const balance = roles.balance !== undefined ? num(row[roles.balance]) : Number.NaN;
  const explicitType = roles.type !== undefined ? typeFromCell(cellText(row[roles.type])) : null;

  const hasDebit = Number.isFinite(debitValue) && debitValue > 0;
  const hasCredit = Number.isFinite(creditValue) && creditValue > 0;

  if (hasDebit && !hasCredit) return { amount: Math.abs(debitValue), type: "debit", balance };
  if (hasCredit && !hasDebit) return { amount: Math.abs(creditValue), type: "credit", balance };
  if (hasDebit && hasCredit) {
    if (explicitType) {
      return { amount: Math.abs(explicitType === "debit" ? debitValue : creditValue), type: explicitType, balance };
    }
    return { amount: Number.NaN, type: null, balance };
  }

  if (roles.amount !== undefined) {
    const value = num(row[roles.amount]);
    if (Number.isFinite(value) && value !== 0) {
      const type = explicitType ?? (value < 0 ? "debit" : "credit");
      return { amount: Math.abs(value), type, balance };
    }
  }

  if (Number.isFinite(balance) && Number.isFinite(previousBalance)) {
    const delta = roundMoney(balance - previousBalance);
    if (delta > 0) return { amount: delta, type: "credit", balance };
    if (delta < 0) return { amount: Math.abs(delta), type: "debit", balance };
  }

  return { amount: Number.NaN, type: null, balance };
}

// Turn a table into transactions plus a reconciliation of the running balance.
export function tableToTransactions(rows: Table): SheetParseResult {
  const empty: SheetParseResult = {
    transactions: [],
    columns: {},
    reconciliation: { credits: 0, debits: 0, reconciled: false },
    warnings: [],
  };
  const header = detectHeader(rows);
  if (!header) {
    return { ...empty, warnings: ["No header row with transaction columns was found in this table."] };
  }

  const { roles } = header;
  const warnings: string[] = [];
  const transactions: ExtractedTransaction[] = [];
  let opening: number | undefined;
  let closing: number | undefined;
  let firstBalance: number | undefined;
  let lastBalance: number | undefined;
  let previousBalance = Number.NaN;
  let skippedSummary = 0;
  let ambiguousRows = 0;
  let invalidDates = 0;
  let creditsTotal = 0;
  let debitsTotal = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every((cell) => cellText(cell) === "")) continue;
    if (isRepeatedHeader(row, header.row)) continue;

    const description = roles.description !== undefined
      ? cellText(row[roles.description])
      : fallbackDescription(row, roles);
    const dateRaw = roles.date !== undefined ? cellText(row[roles.date]) : "";
    const date = coerceIsoDate(dateRaw);
    const balance = roles.balance !== undefined ? num(row[roles.balance]) : Number.NaN;

    const debitProbe = roles.debit !== undefined ? num(row[roles.debit]) : Number.NaN;
    const creditProbe = roles.credit !== undefined ? num(row[roles.credit]) : Number.NaN;
    const amountProbe = roles.amount !== undefined ? num(row[roles.amount]) : Number.NaN;
    const hasAnyAmount = (Number.isFinite(debitProbe) && debitProbe > 0)
      || (Number.isFinite(creditProbe) && creditProbe > 0)
      || (Number.isFinite(amountProbe) && amountProbe !== 0);

    // Opening/closing/summary rows are not transactions. They are skipped even
    // when dated, so a printed "Total" can never be counted as a transaction.
    // Their balance is still captured so the statement can be reconciled.
    if (SUMMARY_WORDS.test(description) && (!date || !hasAnyAmount)) {
      if (Number.isFinite(balance)) {
        if (OPENING_WORDS.test(description)) opening = balance;
        else if (CLOSING_WORDS.test(description)) closing = balance;
        if (firstBalance === undefined) firstBalance = balance;
        lastBalance = balance;
        previousBalance = balance;
      }
      skippedSummary += 1;
      continue;
    }

    const resolved = resolveAmount(row, roles, previousBalance);
    if (Number.isFinite(resolved.balance)) {
      if (firstBalance === undefined) firstBalance = resolved.balance;
      lastBalance = resolved.balance;
      previousBalance = resolved.balance;
    }

    if (!Number.isFinite(resolved.amount) || resolved.amount <= 0 || !resolved.type) {
      if (description || dateRaw) ambiguousRows += 1;
      continue;
    }

    if (dateRaw && !date) invalidDates += 1;

    const reference = roles.reference !== undefined ? cellText(row[roles.reference]) : "";
    transactions.push({
      date,
      description: description || "Transaction",
      amount: roundMoney(resolved.amount),
      type: resolved.type,
      transactionId: reference || undefined,
    });
    if (resolved.type === "credit") creditsTotal += resolved.amount;
    else debitsTotal += resolved.amount;
  }

  const credits = roundMoney(creditsTotal);
  const debits = roundMoney(debitsTotal);
  const open = opening ?? firstBalance;
  const close = closing ?? lastBalance;
  let expectedClosing: number | undefined;
  let difference: number | undefined;
  let reconciled = false;
  if (open !== undefined) {
    expectedClosing = roundMoney(open + credits - debits);
    if (close !== undefined) {
      difference = roundMoney(close - expectedClosing);
      reconciled = Math.abs(difference) <= 0.01;
    }
  }

  if (skippedSummary > 0) warnings.push(`Ignored ${skippedSummary} summary/balance row(s).`);
  if (invalidDates > 0) warnings.push(`${invalidDates} row(s) had an unreadable date.`);
  if (ambiguousRows > 0) warnings.push(`${ambiguousRows} row(s) had no usable amount or direction.`);
  if (open !== undefined && close !== undefined && !reconciled) {
    warnings.push(`Statement does not reconcile: expected closing ${expectedClosing}, found ${close} (difference ${difference}).`);
  }

  return {
    transactions,
    columns: { ...roles },
    reconciliation: { opening: open, closing: close, credits, debits, expectedClosing, difference, reconciled },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CSV parsing.
// ---------------------------------------------------------------------------

function pickDelimiter(line: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

// Parse delimited text into a table, honouring RFC-4180 quoting (embedded
// delimiters/newlines, doubled quotes) and tolerating a BOM, CRLF/LF, and
// comma/semicolon/tab delimiters.
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^\uFEFF/, "");
  const firstBreak = content.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? content : content.slice(0, firstBreak);
  const delimiter = pickDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
