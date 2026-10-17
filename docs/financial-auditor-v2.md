# Financial Auditor v2 — Spreadsheet-first, AI-explains-only

Status: draft / in progress
Owner: Investours engineering

## 1. Problem

The current Auditor is PDF-first. A bank statement PDF is converted to text,
then the text is parsed back into transaction rows. That reconstruction is the
single weakest link:

- PDF extraction can misplace columns, so dates / descriptions / debits /
  credits / balances get confused.
- Column-grouped exports (Monimepoint wallets, some GTB/Zenith/Kuda exports)
  produce a text blob where the row parser cannot rebuild rows at all.
- Today we route those to an LLM reader. That makes the numbers nondeterministic
  and occasionally wrong, which is exactly what an audit must never be.

Meanwhile the **arithmetic is already deterministic** (`applyFinancialAuditRules`);
income is the sum of credit rows and expenses the sum of debit rows. The AI is
only ever used as a *reader*, never as an analyst. There is no AI interpretation
layer at all today — recommendations are templates.

## 2. Target architecture

Move the AI out of the numbers entirely and put a deterministic table between
every input and the rules engine.

```
                      ┌───────────────────────────┐
  .pdf   ──► PDF→table │  table of cells (string[][]) │
  .csv   ──► CSV→table │  date | desc | dr | cr | bal │
  .xlsx  ──► XLSX→table└───────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │  tableToTransactions()     │  deterministic
                          │  header detection, column  │  (spreadsheet.ts)
                          │  mapping, direction,       │
                          │  summary-row removal       │
                          └───────────────┬───────────┘
                                          ▼
                          ┌───────────────────────────┐
                          │  validate + reconcile      │  deterministic
                          │  opening + credits − debits │
                          │  == closing ?  duplicates, │
                          │  bad dates, transfers      │
                          └───────────────┬───────────┘
                                          ▼
                          ┌───────────────────────────┐
                          │  applyFinancialAuditRules  │  deterministic
                          │  totals, cash flow, score, │  (existing)
                          │  categories, monthly       │
                          └───────────────┬───────────┘
                                          ▼
                          ┌───────────────────────────┐
                          │  AI explains ONLY the      │  optional, non-authoritative
                          │  verified figures          │
                          └───────────────────────────┘
```

Principle: **the AI never produces or recalculates a number.** It receives the
verified metrics and explains them. If the AI is unavailable, the report still
contains every figure.

## 3. Data contracts

### 3.1 Table

A table is `Table = (string | number)[][]` — an array of rows, each an array of
cells. No header assumption at the type level; the header row is detected.

### 3.2 Transaction (existing)

```ts
type ExtractedTransaction = {
  date?: string;          // ISO yyyy-mm-dd, or undefined
  description: string;
  amount: number;         // positive
  type: "credit" | "debit";
  transactionId?: string;
};
```

`tableToTransactions(rows)` returns:

```ts
type SheetParseResult = {
  transactions: ExtractedTransaction[];
  columns: Partial<Record<ColumnRole, number>>;  // role -> column index
  reconciliation?: {
    opening?: number;
    closing?: number;
    credits: number;
    debits: number;
    expectedClosing?: number;
    difference?: number;      // closing - expectedClosing
    reconciled: boolean;      // |difference| <= 0.01
  };
  warnings: string[];         // human-readable data-quality notes
};
```

### 3.3 Column roles

`date | description | debit | credit | amount | type | balance | reference | ignore`

Detection keywords (case-insensitive, bank-agnostic):

| role        | keywords |
|-------------|----------|
| date        | date, trans. time, trans time, transaction date, value date, posting date |
| description | description, narration, particulars, details, memo, remarks, narrative, transaction details |
| debit       | debit(s), withdrawal(s), dr, money out, outflow, paid out |
| credit      | credit(s), deposit(s), cr, money in, inflow, paid in |
| amount      | amount, transaction amount, value |
| type        | type, dr/cr, direction |
| balance     | balance, running balance, balance after, closing balance, available balance, ledger balance |
| reference   | reference, ref, txn id, transaction id, cheque no |

### 3.4 Amount + direction resolution (in order)

1. **Debit and/or credit columns present** — read the non-zero column; that
   column decides direction. This is the most common and most reliable layout.
2. **Amount column + type column** — `dr/debit` → debit, `cr/credit` → credit.
3. **Amount column only** — a leading `-` means debit, otherwise credit.
4. **Balance column only** — infer direction from the balance delta from the
   previous row (`balance` up → credit, down → debit).

Rows whose description matches a summary token (`total`, `closing`, `opening`,
`sub-total`, `balance b/f`, `balance c/f`, `carried forward`) and which carry no
date are **not** transactions and are skipped. A balance is never an amount.

### 3.5 Reconciliation

When a balance column (or explicit opening/closing balance rows) is present:

```
expectedClosing = opening + credits − debits
difference      = closing − expectedClosing
```

`reconciled` is true when `|difference| <= 0.01` (NGN). A non-reconciling
statement is surfaced as a warning and a report limitation, never hidden.

## 4. PDF → table

The current `parse-statement` edge function already reconstructs each PDF page
into lines using the x/y position of every text item (`itemsToText`). The next
step is to keep the **x coordinate** so we can cluster items into *columns* and
emit a real table instead of a flat string.

Plan:

1. Extend the page renderer to return `{ rows: { y, cells: { x, text }[] }[] }`.
2. Cluster cell x-positions across the page into column bands (gap-based).
3. Emit `Table` = each row's cells in column order (empty string when a row has
   no value in a column).
4. Feed the table to `tableToTransactions`.

This deterministically repairs column-grouped exports **without an LLM**, which
is the whole point. The AI reader becomes a last-resort fallback behind a flag,
not the default for wallets.

## 5. Validation & cleaning rules

Applied deterministically before calculation:

- Drop non-transaction rows (headers, footers, page numbers, summary lines).
- Require a usable direction and a positive amount; keep undated rows (they are
  still credits/debits) and report the count.
- Deduplicate only **exact** duplicate rows (same date + description + amount +
  type + reference); distinct rows that reuse a reference are kept.
- Flag: rows with unparseable dates, zero/negative amounts, missing direction,
  and any reconciliation difference.
- Run everything through the audit window = the whole statement.

## 6. Self / internal transfers

Net cash flow is **not** profit. Transfers between the user's own accounts
(e.g. "Auto-save to OWealth Balance", "OWealth Withdrawal", "Transfer from
<account holder name>") are money *movement*, not income or expense. These are
detected by description patterns plus counter-account names and surfaced in a
separate `internalTransfers` bucket, excluded from `totalIncome` /
`totalExpenses`, and shown as a report limitation. Needs product confirmation of
the exact pattern list.

## 7. AI interpretation layer (explain-only)

- Input: the **computed** report object (totals, cash flow, categories, monthly,
  reconciliation status, data-quality flags).
- Output: prose — spending patterns, risks, and actions — each referencing a
  figure that already exists in the report.
- Hard rules in the system prompt: never invent, recalculate, or "correct" a
  number; never call cash flow profit; never call a flagged pattern confirmed
  fraud; if a figure is missing, say so.
- The report is fully usable without this layer; the AI section is additive.

## 8. Phased delivery

| Phase | Deliverable | Where |
|-------|-------------|-------|
| 0 | This plan | `docs/` |
| 1 | `tableToTransactions` + `parseCsv`, unit-tested | `financial-audit/spreadsheet.ts` |
| 2 | Accept `.csv` upload end-to-end; reuse rules engine | `parse-statement`, `AuditorConnect` |
| 3 | `.xlsx` parsing (SheetJS) → same table | `parse-statement` |
| 4 | PDF → table via x-clustering | `parse-statement/pdfText.ts` |
| 5 | Validation + reconciliation surfaced in the report | `auditRules.ts`, report UI |
| 6 | Internal-transfer exclusion (needs product sign-off) | `auditRules.ts` |
| 7 | AI explain-only layer | `financial-audit/index.ts` |

## 9. Test strategy

- Unit tests for `parseCsv` (quotes, CRLF, delimiters, BOM).
- Unit tests for `tableToTransactions`: header detection, each layout in §3.4,
  summary-row skipping, balance reconciliation, duplicates.
- Integration: table → `applyFinancialAuditRules` → assert totals equal the
  hand-computed sum of credits/debits.
- Golden fixtures: one CSV per bank layout (GTB, Zenith, Moniepoint, Kuda).

## 10. Non-goals

- OCR of scanned statements (out of scope; ask for a text/CSV export).
- AI doing any arithmetic.
- Changing the free/paid access model (unrelated to this work).
