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

### 4a. Desktop pipeline (`tools/`) — PDF → Excel → audit, in Python

The same deterministic path is also implemented locally, so an auditor can drop
in any statement PDF and get the workbook without uploading it. See
`tools/README.md`.

* **OpenCV "sees" the table.** Each page is rendered with PDFium
  (`pypdfium2`) and Otsu-thresholded; long-kernel morphology separates the
  horizontal and vertical rule lines. When both are found, cells are exact
  rectangles, so right-aligned amounts and centred headers land in the right
  column (`method: grid`). When there is no grid, columns are anchored on the
  statement's own header row exactly as in §4 above, and a statement with
  neither falls back to the line parser (`method: text`).
* **Cell text** comes from the PDF text layer (per-character boxes grouped into
  words); a page without a text layer is read with Tesseract when it is
  installed.
* **Same rules, same figures.** `tools/statement_audit/audit_rules.py` and
  `spreadsheet.py` are ports of the TypeScript modules named in §4/§5, and a
  test (`tools/tests/test_typescript_parity.py`) runs one battery through both
  and fails on any difference.
* **Output** is `<name>.audit.xlsx` (Summary / Debit-Credit / As extracted, per
  §5a) plus `<name>.audit.json` with the extraction metadata, reconciliation,
  printed-total comparison and parser confidence.

### 4b. Web uploads go through OpenCV too

Deno (the Edge Function runtime) cannot load OpenCV, so the reader runs as a
small HTTP service next to the app rather than inside it. `tools/parser_service.py`
exposes `POST /parse` (raw PDF bytes in, the parse-statement contract out:
`success`, `text`, `pages`, `table`, plus `reader`/`method`/`warnings`), and the
`parse-statement` edge function calls it *before* its own parser whenever
`OPENCV_PARSER_URL` is configured. The table it returns is the same shape the
preview, `tableToTransactions` and the audit already consume, so the audit
arithmetic stays where it is (identical rules, §4).

* **Every upload** is read by OpenCV, including locked PDFs (the service answers
  `PASSWORD_REQUIRED` / `INCORRECT_PASSWORD`, which is what drives the app's
  password prompt) and multi-page statements.
* **OpenCV's rows are final.** When the reader that produced the table is OpenCV,
  the auditor keeps those rows as-is. A model is never asked to re-read them, so
  the same upload always yields the same figures — nothing non-deterministic sits
  between the PDF and the totals. Disagreements with the running balance or the
  statement's printed totals are *reported* in the notes with the figures, not
  used to swap in different rows. (`rowsAreFinal` in `auditRules.ts` decides this;
  a table reconstructed from text *without* OpenCV can still be cross-checked
  against the statement text, as before.)
* **A reader's table is not discarded.** `routeSheetAudit` (in `auditRules.ts`)
  decides how a request is read. Rows from a reader are summed when they exist.
  When a reader produced a table that could not be broken into rows — a scan
  whose header did not resolve to columns — the audit reports that instead of
  falling through to an AI re-read of the text. Re-reading is how a scan's real
  `₦50,000` / `₦12,000` columns became `₦0` / `₦0` on the audit page while the
  preview showed the reader's own columns. Only a request with no page reading at
  all (pasted SMS, a text-only upload) is read from its text.
* **A header bound into one box still yields columns.** A scanner or an
  underline can bind a header line into a single word-box. The reader rebuilds
  the columns from the ink the data uses and names them from the header text
  (`anchors_from_columns`, `place_merged_header` in `pdf_table.py`), so a scanned
  statement's Debit and Credit columns are read rather than inferred.
* **Never a hard dependency.** If the service is unset, slow or erroring the
  function falls back to the built-in pdf-parse path, so an upload cannot fail
  because of it. Verified for a wrong token (401) and an unreachable host.
* `.csv` / `.xlsx` uploads are structured already and are read in the browser;
  there is no page to look at. Their rows are final for the same reason.

## 5. Validation & cleaning rules

Applied deterministically before calculation:

- Drop non-transaction rows (headers, footers, page numbers, summary lines).
- Require a usable direction and a positive amount; keep undated rows when the
  audit window covers the whole statement (they are still credits/debits) and
  report the count, but exclude them when the statement extends beyond the
  window because they cannot be attributed to the selected months.
- Deduplicate only **exact** duplicate rows (same date + description + amount +
  type + reference); distinct rows that reuse a reference are kept.
- Flag: rows with unparseable dates, zero/negative amounts, missing direction,
  and any reconciliation difference.
- Run everything through the audit window = the **selected number of months**,
  anchored on the first month present in the statement. Total income is the sum
  of the credit rows inside that window and total expenses is the sum of the
  debit rows inside it; the statement's own printed totals / running balance are
  only cross-checked when the window covers the whole statement.

### 5a. Review gate (upload page)

Before an audit runs, the converted statement is shown to the user as a
spreadsheet and the run button is "Proceed to Audit". The preview has two views:

- **Cleaned Debit / Credit** (default): one row per transaction the audit will
  count, with the amount placed in a single **Debit** or **Credit** column and a
  labelled `TOTAL` row, plus a header line showing the windowed Debit/Credit
  totals. Summary/opening/closing rows are removed.
- **As extracted**: the raw converted rows, so any extraction problem is visible.

The cleaned view is built with the *same* rules the audit uses
(`tableToTransactions` → `applyFinancialAuditRules`), so what the user reviews is
exactly what gets totalled. Those modules are dynamically imported on the client
to stay out of the initial bundle. "Download Excel" writes the currently shown
view as an `.xlsx` (the cleaned view by default).

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

| Phase | Deliverable | Where | Status |
|-------|-------------|-------|--------|
| 0 | This plan | `docs/` | done |
| 1 | `tableToTransactions` + `parseCsv`, unit-tested | `financial-audit/spreadsheet.ts` | done |
| 2 | Accept `.csv` upload end-to-end; reuse rules engine | `parse-statement`, `AuditorConnect` | done |
| 3 | `.xlsx` parsing (SheetJS) → same table | `src/lib/spreadsheetFile.ts` | done |
| 4 | PDF → table via x-clustering | `parse-statement/pdfText.ts` | done |
| 5 | Validation + reconciliation surfaced in the report | `auditRules.ts`, report UI | done |
| 6 | Internal-transfer exclusion (needs product sign-off) | `auditRules.ts` | pending |
| 7 | AI explain-only layer | `financial-audit/insights.ts` | done |

### What shipped in phases 1–5

- `.xlsx` (and `.xls`) uploads: `src/lib/spreadsheetFile.ts` lazily loads
  SheetJS only when a workbook is uploaded (it stays code-split, ~424 kB), reads
  the first sheet, turns dates into ISO strings and numbers into numerics, drops
  blank rows, and reuses the same `table` path as CSV/PDF. An editable text
  preview still backs the textarea.
- `spreadsheet.ts`: `parseCsv` + `tableToTransactions` (header detection, column
  mapping, direction resolution, summary-row skipping, reconciliation).
- `pdfText.ts`: `itemsToText` (unchanged behaviour) plus `itemsToTable` /
  `pagesToTable`, which anchor columns on the statement's own header row using
  each item's x-position and regroup rows by y-position. This repairs
  column-grouped PDF exports deterministically, with no AI.
- `parse-statement`: returns `{ text, table }`; both the fast path and the
  password path collect page items and build one table across pages.
- `financial-audit`: accepts `table` (2D array) or `csv` (string). When present
  and usable it sums the credit/debit rows directly (`extractionMethod:
  "spreadsheet"`), skipping the AI entirely. Otherwise the existing text/AI path
  is unchanged. The request may also carry `tableReader` ("opencv" /
  "browser-spreadsheet"); when it names a real reader the rows are kept verbatim
  and never handed to the AI (see §4b). When a named reader produced a table that
  yields no rows, the function answers `422` with a plain explanation rather than
  re-reading the text.
- `auditRules.ts`: `comparePrintedTotals(text, transactions)` returns the
  statement's printed credit/debit totals alongside the parser's sums and
  whether each side matches. `assessParserConfidence` now reuses it.
  `rowsAreFinal(tableReader)` says whether a request's rows are a real reading of
  the page and must therefore be trusted as-is. `routeSheetAudit({tableReader,
  hasTable, transactionCount})` turns that into the reading to use: `sum-rows`,
  `reader-unreadable`, or `read-text`.
- Reconciliation + data quality in the report: the auditor returns a
  `meta.validation` block (`method`, `reconciled`, `reconciliation`,
  `dataQuality`, `warnings`, `notes`, `aiExtraction`) which `AuditorConnect` folds
  into `report_json`. `AuditDataQuality.tsx` renders it on the dashboard: how the
  statement was read, whether the totals reconcile, and any rows skipped /
  duplicated / undated. `aiExtraction` records, per text chunk, whether the model
  or the local parser supplied the rows — the record to compare when two audits of
  one statement are expected to match.
- Guarded cross-check: if a reconstructed table does not tally with its own
  running balance, but the statement text reproduces the bank's printed totals,
  the audit switches to the text parse (and says so in the notes).
- `AuditorConnect.tsx`: uploads `.csv` (read in-browser) or `.pdf`; passes the
  parsed table/csv to the auditor; editing the text falls back to the text path.

### What shipped in phase 7 (AI explain-only)

- `insights.ts` (new): `buildInsightFacts(report, notes)` turns the finished
  report into a compact FACTS payload — totals, cash flow, savings rate, score,
  category/income shares (computed deterministically, never by the AI), the
  monthly breakdown and the reconciliation status. `buildExplainPrompt(facts)`
  renders it, and `EXPLAIN_SYSTEM_PROMPT` carries the hard rules (only FACTS
  numbers, no arithmetic, cash flow is not profit, a flag is never confirmed
  fraud, say when a figure is missing).
- `sanitizeInsights(raw, facts)` verifies the AI's prose **after** it returns:
  every number in the output must be traceable to a fact (money to the cent,
  percentages within rounding, counts/scales allowed). A sentence or bullet that
  cites an invented or recalculated figure is dropped, not shown. `textMatchesFacts`
  and `extractNumberTokens` expose the check for testing.
- `financial-audit/index.ts`: `callAI` was split into a shared `callGroq(...)`
  plus a thin extraction wrapper, and a new best-effort `explainReport(...)` runs
  **after** the figures are final. The explanation is skipped when the audit has
  already used most of the edge function's wall clock and never fails the audit;
  `report.insights` and `meta.validation.aiExplanation` (`status`, `droppedFigures`)
  carry the result.
- `AiInterpretation.tsx` (new): renders `report_json.insights` on the dashboard
  (summary + what's working / watch out for / next steps + data-quality notes) as
  an additive section labelled as explaining the verified figures.
- Tests: `insights.test.mjs` covers facts building, prompt contents, number
  allow-listing (real vs invented figures, percentage tolerance, dates,
  structural integers), sentence/bullet dropping and empty/failed responses.

### Known follow-ups

- Multi-line descriptions that wrap across columns can defeat header anchoring;
  a wrapped-row heuristic is a future refinement.


## 9. Test strategy

- Unit tests for `parseCsv` (quotes, CRLF, delimiters, BOM).
- Unit tests for `tableToTransactions`: header detection, each layout in §3.4,
  summary-row skipping, balance reconciliation, duplicates.
- Integration: table → `applyFinancialAuditRules` → assert totals equal the
  hand-computed sum of credits/debits.
- Golden fixtures: one CSV per bank layout (GTB, Zenith, Moniepoint, Kuda).

## 10. Non-goals

- OCR of scanned statements in the **web app** (out of scope there; ask for a
  text/CSV export). The local pipeline in §4a does read scanned pages with
  Tesseract when it is installed on the machine.
- AI doing any arithmetic.
- Changing the free/paid access model (unrelated to this work).
