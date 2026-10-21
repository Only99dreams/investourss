# Statement audit pipeline (`tools/`)

Reads a bank statement PDF **with OpenCV**, turns it into a table, writes it to
**Excel**, and runs the same audit the web app runs — in plain Python, on this
machine, with no upload and no AI in the arithmetic.

```
statement.pdf ──► render page (PDFium) ──► OpenCV "sees" the table
                                              │
                     ┌────────────────────────┴─────────────────────────┐
                     │ ruled statement   → rule-line grid = exact cells │
                     │ borderless        → columns anchored on header   │
                     │ neither           → line-by-line text parser     │
                     └────────────────────────┬─────────────────────────┘
                                              ▼
                             transactions ──► audit ──► .xlsx + .audit.json
```

The Python port is **byte-for-byte equivalent to the TypeScript app**
(`supabase/functions/financial-audit/auditRules.ts` and `spreadsheet.ts`). A test
runs one battery of inputs through both implementations and fails on any
difference, so a statement audited here gives the same figures as the web app.

Both sides are also held to one shared fixture, `tools/expected-rules.txt`, which
is the file to update if the arithmetic ever changes on purpose:

```
tools\pyenv\python.exe -m unittest discover -s tools\tests   # Python side
npm run test:audit-rules                                     # TypeScript side
```

One thing Python does not share with the app: `assessParserConfidence`, the
heuristic that decides whether a text read is trustworthy enough to skip the AI
extractor. The desktop tool has no AI to fall back to, so it always keeps the
deterministic rows it read — and it reports them, which is what makes it the
reference to check the app's OpenCV upload against.

## Run it

```
tools\audit-statement.cmd "path\to\statement.pdf"
tools\audit-statement.cmd statement.pdf --months 6 --debug
tools\pyenv\python.exe tools\audit_statement.py statement.csv
```

Options:

| option | meaning |
| --- | --- |
| `-o, --out DIR` | output directory (default `<statement>-audit`) |
| `--months N` | months to audit (default: the whole statement) |
| `--dpi N` | render resolution for OpenCV (default 200) |
| `--ocr auto\|force\|off` | read scanned pages with Tesseract (default `auto`) |
| `--password PW` | password for an encrypted PDF |
| `--debug` | write `debug/page-NN.png` showing the lines OpenCV found |
| `--quiet` | suppress the per-page log lines |

Input can be `.pdf`, `.csv` or `.xlsx`.

## Output

* `<name>.audit.xlsx`
  * **Summary** — verified figures, reconciliation, and how the PDF was read.
  * **Debit-Credit** — one row per counted transaction, amounts in a single
    Debit or Credit column, with a **TOTAL** row. This is exactly what was
    totalled, so any figure can be checked by hand.
  * **As extracted** — the raw cell table OpenCV produced, before cleaning, so
    an extraction problem is visible instead of hidden.
* `<name>.audit.json` — the audit result plus extraction metadata: method, page
  count, row/column counts, warnings, reconciliation, printed totals and a
  parser-confidence verdict.
* `debug/page-NN.png` — only with `--debug`: page image with detected horizontal
  rules (green), vertical rules (blue) and word boxes (red).

The console prints the same summary:

```
Statement : statement.pdf
Read      : spreadsheet path, method grid, 1 page(s), 16 table row(s)
Balance   : 100,000.00 + 1,050,000.00 - 236,000.00 = 914,000.00 vs closing 914,000.00 -> reconciled
Period    : 2025-01-01 to 2025-01-31 (1 month(s))
Result    : income 1,050,000.00 | expenses 236,000.00 | cash flow 814,000.00 | savings 77.52% | score 78 (good)
Rows      : 9 counted, 0 invalid, 0 duplicate, 0 undated
```

## How the PDF is read

1. **Render** each page with PDFium (`pypdfium2`) at `--dpi`.
2. **Let OpenCV look at the ink**: Otsu threshold, then long-kernel morphology
   splits horizontal from vertical rule lines. Their positions give the ruling
   grid.
   * Rows and columns both found → each cell is an exact rectangle, so
     right-aligned amounts, centred headers and wrapped text land in the right
     column. (`method: grid`)
   * Only rules/only a header → rows from the rules, columns anchored on the
     statement's own header row. (`method: grid-rows`)
   * No grid → columns anchored on the header row by x-position, the approach
     used by `supabase/functions/parse-statement/pdfText.ts`.
     (`method: columns`)
   * No header either → a column per line, parsed by the line parser.
     (`method: text`)
3. **Text for each cell** comes from the PDF text layer: per-character boxes
   from PDFium are grouped into words (split on real separations and on baseline
   changes, so `1,000.00` and `Bank charge` stay whole). A page with no text
   layer is read with Tesseract when it is installed (`--ocr`).

### Known limits

Honest by design — every one of these produces a warning or a safe fallback,
never a silently wrong number:

* **Rotation.** The rule search looks for horizontal and vertical lines, so it
  tolerates about 2° of skew (verified: 0.5° and 1.5° still read as `grid`, 3°
  loses the rules). Digital PDFs are never rotated, so this only matters for
  scans — which need Tesseract anyway, plus deskewing, before they are reliable.
* **Wrapped descriptions, borderless PDFs.** In the grid path a wrapped cell is
  kept in one row and reassembled line by line. Without rules
  (`method: columns`) the continuation of a wrapped description is still a
  separate visual row, so the description text is truncated to its first line —
  the date and the amount are unaffected. Follow-up.
* **Two tables on one page.** The page's ruling is detected once, so a second
  table on the same page is not framed separately.
* **A header bound into one wide box.** A scanner or an underline can bind a
  header line into a single word-box, so the header words carry one x-position.
  The reader rebuilds the columns from the ink the data uses and names them from
  the header text (money names take the right-hand columns, in reading order).
  That is a best-effort placement: with no ruling to check against, a page whose
  columns are irregular could still put an amount in the wrong column. It is
  reported through the usual reconciliation notes rather than assumed correct.
* **A statement the text parser cannot read at all.** For a PDF read *without*
  OpenCV (the `pdf-parse` fallback), the web auditor still falls back to the AI
  extractor when the text read looks unreliable — that path has no page reading to
  trust. Statements read by OpenCV never take it: their rows are kept as-is. When
  an OpenCV table cannot be broken into rows at all, the audit says so instead of
  re-reading the text, so its figures are never swapped for a different reading.

## The app reads every upload with OpenCV

The web auditor parses uploads in the `parse-statement` Edge Function, which runs
in Deno — and Deno cannot load OpenCV. So the function forwards each uploaded
statement to the **parser service** here (`tools/parser_service.py`), which
renders the page, lets OpenCV find the ruling and the cells, and answers in the
very JSON contract the app already consumes (`success`, `text`, `pages`,
`table`). The preview, the spreadsheet rules and the audit downstream are
untouched, so an upload read this way yields the same figures as the CLI.

```
upload → storage → parse-statement ──(OPENCV_PARSER_URL)──► parser_service
                            │                                    │
                            │◄──── {success, text, pages, table} ─┘
                            │
                   pdf-parse inside Deno  ← fallback when the service is
                                            unset / slow / erroring
```

Everything a normal statement needs already works: locked PDFs (the app's
password prompt is driven by the service's `PASSWORD_REQUIRED` /
`INCORRECT_PASSWORD` replies), multi-page statements, and scans when Tesseract
is installed on the service. **If the service is unreachable the upload does not
fail** — the built-in Deno parser answers instead, so wiring this up can never
break the auditor.

When OpenCV read the page, its rows are **final**: the auditor sums the
credit/debit columns and nothing re-reads them, so the same upload gives the same
figures every time. If those rows do not tally with the statement's running
balance or its printed totals, the report says so in its notes — it does not swap
in different rows. That is what makes the app line up with
`tools\audit-statement.cmd` on the same statement.

Note: `.csv` / `.xlsx` uploads are read in the browser by SheetJS (there is no
page to look at), so they do not pass through the service — only PDF uploads do.
The audit arithmetic stays in the Edge Function, whose rules the Python port is
proven identical to.

### Reading a statement on a PC, outside the app

`audit-statement.cmd` runs the same reader and spreadsheet rules on a file, so a
statement can be checked without uploading it:

```
tools\audit-statement.cmd "C:\path\to\statement.pdf"
```

It writes a `<name>-audit\` folder beside the PDF (a workbook and a CSV) and
prints the totals — the figures to compare against the app when auditing the
same statement by hand.

### Run it

```
tools\pyenv\python.exe tools\parser_service.py --port 8787
curl -X POST --data-binary "@statement.pdf" http://127.0.0.1:8787/parse
```

Open `http://127.0.0.1:8787/check` in a browser to try it by hand: `/health`,
then pick a PDF and read it with OpenCV. The same page sits at
`https://your-host/check` on the deployed service. It asks for the token only
if one is configured (a deployed service always should be).

| option | env | meaning |
| --- | --- | --- |
| `--host` | `PARSER_HOST` | bind address (default `0.0.0.0`) |
| `--port` | `PARSER_PORT`, then `PORT` | port (default `8787`; PaaS-provided `PORT` is honoured) |
| `--token` | `PARSER_TOKEN` | require `Authorization: Bearer <token>` |
| `--dpi` | `PARSER_DPI` | render resolution (default 200) |

### Deploy it

Any container host works (Render, Fly, Railway, a VPS…). A `Dockerfile` with
Tesseract included is provided, and `render.yaml` at the repo root pins the
Docker paths for Render (repo root → `tools/Dockerfile`, build context `tools`):

```
docker build -f tools/Dockerfile -t statement-parser tools
docker run --rm -p 8787:8787 -e PARSER_TOKEN=choose-a-secret statement-parser
```

Then point the app at it and redeploy the function (with the CLI installed, or
`npx supabase` if it is not):

```
npx supabase login
npx supabase secrets set OPENCV_PARSER_URL=https://your-host OPENCV_PARSER_TOKEN=choose-a-secret
npx supabase functions deploy parse-statement
```

Rolling back is instant: `npx supabase secrets unset OPENCV_PARSER_URL` returns
the app to its built-in parser with no redeploy.

`OPENCV_PARSER_TIMEOUT_MS` (default 90000) bounds how long the function waits
before falling back to the built-in parser. The service answers only to the
token, so an open port is not free compute for anyone.

## Requirements

Everything lives under `tools/` — **no system install, no admin rights**:

* `tools/pyenv/` — portable CPython 3.12 (embed build) with
  `pypdfium2`, `opencv-python-headless`, `numpy`, `openpyxl`, `pytesseract`
  (`tools/requirements.txt`). `pypdfium2` is used instead of PyMuPDF because its
  wheels are self-contained and need no Visual C++ redistributable.
* **Optional:** the Tesseract binary on `PATH` for scanned pages. Without it the
  pipeline still works for any PDF with a text layer, and says so in the report.

Recreate the environment from scratch:

```
curl -L -o tools\python-embed.zip https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip
tar -xf tools\python-embed.zip -C tools\pyenv
# then uncomment "import site" in tools\pyenv\python312._pth
curl -L -o tools\get-pip.py https://bootstrap.pypa.io/get-pip.py
tools\pyenv\python.exe tools\get-pip.py
tools\pyenv\python.exe -m pip install -r tools\requirements.txt
```

## Layout

| path | role |
| --- | --- |
| `audit_statement.py` | entry point (also `audit-statement.cmd`) |
| `parser_service.py` | HTTP service the app uploads through (OpenCV behind Supabase) |
| `Dockerfile`, `requirements-service.txt` | container image for hosting the service |
| `statement_audit/pdf_table.py` | render + OpenCV table reading |
| `statement_audit/spreadsheet.py` | table → transactions (port of `spreadsheet.ts`) |
| `statement_audit/text_parser.py` | line-based fallback (port of `parseFinancialRecords`) |
| `statement_audit/audit_rules.py` | the audit arithmetic (port of `auditRules.ts`) |
| `statement_audit/excel.py` | the `.xlsx` writer |
| `statement_audit/cli.py` | orchestration, JSON report, console summary |
| `tests/` | unit tests, PDF end-to-end tests, TypeScript parity test |

## Tests

```
tools\pyenv\python.exe -m unittest discover -s tools\tests -v
```

* **PDF end-to-end:** generates synthetic statements with fpdf2 — a ruled one
  (grid path), a borderless one (header-anchor path) — plus a CSV of the same
  data, and asserts the same hand-computed totals, reconciliation and workbook
  contents for all three.
* **OpenCV:** asserts the ruling is actually detected on the ruled fixture.
* **Unit:** rounding, amount normalisation, dates, categories, every column
  layout, summary-row skipping, balance-delta direction, CSV parsing, the
  jammed-line text parser, audit-window behaviour.
* **Service:** starts `parser_service.py` on an ephemeral port and drives it
  over real HTTP — reads the fixture with OpenCV, proves the table matches the
  auditor's expected totals, checks the locked-PDF password flow, the token
  guard, an empty body and a file that is not a PDF.
* **TypeScript parity:** runs `tests/ts_battery.mjs` through the real
  `supabase/functions` sources with Node and diffs the results. Skips itself
  when Node or those sources are unavailable.
