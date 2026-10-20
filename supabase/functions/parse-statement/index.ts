import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_TEXT_LENGTH = 20;

// ---------------------------------------------------------------------------
// PDF text reconstruction.
//
// Inlined (rather than imported from pdfText.ts) so this edge function is a
// single self-contained file that any deploy method can bundle. The guarded
// block below is intentionally byte-for-byte identical to pdfText.ts's
// implementation, and pdfText.test.mjs asserts the two copies stay in sync.
// ---------------------------------------------------------------------------
interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

// >>> itemsToText
interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  eol: boolean;
}

function buildRuns(items: PdfTextItem[]): Run[] {
  const runs: Run[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item.str !== "string" || item.str === "") continue;
    const transform = item.transform ?? [];
    const x = Number.isFinite(transform[4]) ? transform[4] : 0;
    const y = Number.isFinite(transform[5]) ? transform[5] : 0;
    const height = item.height && item.height > 0 ? item.height : Math.abs(transform[3] || 10) || 10;
    runs.push({
      str: item.str,
      x,
      y,
      width: item.width && item.width > 0 ? item.width : 0,
      height,
      eol: Boolean(item.hasEOL),
    });
  }
  return runs;
}

// Group runs into visual rows. Top-to-bottom, then left-to-right. PDF y
// increases upwards, so a larger y is higher on the page.
function groupIntoRows(runs: Run[]): Run[][] {
  if (runs.length === 0) return [];
  const ordered = runs.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Run[][] = [];
  let current: Run[] | null = null;
  let currentY = 0;
  let previousEndedLine = false;
  for (const run of ordered) {
    const tolerance = Math.max(1.5, run.height * 0.5);
    const sameRow = current !== null && !previousEndedLine && Math.abs(currentY - run.y) <= tolerance;
    if (!sameRow) {
      current = [];
      currentY = run.y;
      rows.push(current);
    }
    current!.push(run);
    previousEndedLine = run.eol;
  }
  return rows;
}

// Join a row's runs left-to-right, inserting a space at column/word boundaries
// (a small gap is intra-word kerning; a larger gap is a boundary).
function joinRuns(row: Run[]): string {
  const sorted = row.slice().sort((a, b) => a.x - b.x);
  let line = "";
  let previousEndX: number | undefined;
  let previousHeight = sorted[0]?.height ?? 10;
  for (const run of sorted) {
    if (previousEndX !== undefined) {
      const gap = run.x - previousEndX;
      const threshold = Math.max(0.75, Math.min(previousHeight, run.height) * 0.15);
      if (gap > threshold) line += " ";
    }
    line += run.str;
    previousEndX = run.x + run.width;
    previousHeight = run.height;
  }
  return line.replace(/[ \t]+/g, " ").trim();
}

export function itemsToText(items: PdfTextItem[]): string {
  const lines = groupIntoRows(buildRuns(items)).map((row) => joinRuns(row));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// <<< itemsToText

// >>> itemsToTable
interface ColumnAnchor {
  x: number;
  end: number;
}

// Vocabulary that names a statement column. Kept generic (no bank names).
const HEADER_TOKEN = /\b(date|time|description|narration|particulars|details|memo|remarks|balance|debit|debits|credit|credits|amount|withdrawal|withdrawals|deposit|deposits|reference|ref|type|direction|dr|cr)\b/i;
const MONEY_TOKEN = /\b(balance|debit|debits|credit|credits|amount|withdrawal|withdrawals|deposit|deposits|dr|cr)\b/i;

function headerScore(row: Run[]): number {
  let score = 0;
  for (const run of row) if (HEADER_TOKEN.test(run.str)) score += 1;
  return score;
}

// A header row names at least two columns and includes money vocabulary (or a
// date + description pair). This is what stops a title or a stray data row from
// being mistaken for the column definition.
function isHeaderRow(row: Run[]): boolean {
  if (headerScore(row) < 2) return false;
  const text = row.map((run) => run.str).join(" ");
  return MONEY_TOKEN.test(text) || (/\bdate\b/i.test(text) && /(description|narration|particulars|details)/i.test(text));
}

// Merge header runs that are separated by a word gap into single column labels
// (e.g. "Transaction" + "Date" must become one anchor, not two).
function headerAnchors(row: Run[]): ColumnAnchor[] {
  const sorted = row.slice().sort((a, b) => a.x - b.x);
  const anchors: ColumnAnchor[] = [];
  for (const run of sorted) {
    const previous = anchors[anchors.length - 1];
    const threshold = Math.max(0.75, run.height * 0.15);
    if (previous && run.x - previous.end <= threshold) {
      previous.end = Math.max(previous.end, run.x + run.width);
    } else {
      anchors.push({ x: run.x, end: run.x + run.width });
    }
  }
  return anchors;
}

function findAnchors(rows: Run[][]): ColumnAnchor[] | null {
  let best: Run[] | null = null;
  let bestScore = 0;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    if (!isHeaderRow(rows[i])) continue;
    const score = headerScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      best = rows[i];
    }
  }
  return best ? headerAnchors(best) : null;
}

// Assign every run in a row to its nearest column anchor (by left edge) and
// join the runs that land in the same column.
function buildTable(rows: Run[][], anchors: ColumnAnchor[]): string[][] {
  return rows.map((row) => {
    const buckets: Run[][] = anchors.map(() => []);
    for (const run of row) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const distance = Math.abs(run.x - anchors[i].x);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      buckets[best].push(run);
    }
    return buckets.map((bucket) => joinRuns(bucket));
  });
}

// Build one table across every page. Columns are anchored on the first page
// that carries a header, then applied to all pages so continuation pages without
// a repeated header still line up.
export function pagesToTable(pages: PdfTextItem[][]): string[][] {
  const pagesOfRows = pages.map((items) => groupIntoRows(buildRuns(items)));
  let anchors: ColumnAnchor[] | null = null;
  for (const rows of pagesOfRows) {
    anchors = findAnchors(rows);
    if (anchors) break;
  }
  if (!anchors) {
    // No header anywhere: fall back to one cell per row so the caller can use
    // the plain-text parser instead.
    return pagesOfRows.flat().map((row) => [joinRuns(row)]);
  }
  return pagesOfRows.flatMap((rows) => buildTable(rows, anchors));
}

export function itemsToTable(items: PdfTextItem[]): string[][] {
  return pagesToTable([items]);
}
// <<< itemsToTable

interface PdfPageData {
  getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: PdfTextItem[] }>;
}

/**
 * pdf-parse's default page renderer joins same-line text items with no
 * separator, which jams statement columns together. Rebuild each page with
 * column-aware spacing so the amount and running balance stay separate, and
 * collect the page's raw items so we can also build a deterministic table.
 */
async function renderPageInto(pageData: PdfPageData, pages: PdfTextItem[][]): Promise<string> {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  pages.push(content.items ?? []);
  return itemsToText(content.items);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// The OpenCV reader.
//
// Deno cannot load OpenCV, so when OPENCV_PARSER_URL is configured every
// uploaded statement is handed to the Python parser service
// (tools/parser_service.py), which rasterises the page and finds the ruling and
// cells with OpenCV. It answers in this function's own contract, so everything
// downstream — the preview, the spreadsheet rules and the audit — is unchanged.
//
// If the service is unset, slow or erroring, the pdf-parse path below takes
// over silently: an upload must never fail because of this service.
// ---------------------------------------------------------------------------
const OPENCV_PARSER_URL = (Deno.env.get('OPENCV_PARSER_URL') ?? '').replace(/\/+$/, '');
const OPENCV_PARSER_TOKEN = Deno.env.get('OPENCV_PARSER_TOKEN') ?? '';
const OPENCV_TIMEOUT_MS = Number(Deno.env.get('OPENCV_PARSER_TIMEOUT_MS') ?? '90000');

interface ReaderResult {
  success?: boolean;
  text?: string;
  pages?: number;
  table?: unknown;
  reader?: string;
  method?: string;
  warnings?: unknown;
  code?: string;
  error?: string;
}

async function parseWithOpenCv(bytes: Uint8Array, password: string): Promise<ReaderResult | null> {
  if (!OPENCV_PARSER_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENCV_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPENCV_PARSER_URL}/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        ...(password ? { 'X-Pdf-Password': password } : {}),
        ...(OPENCV_PARSER_TOKEN ? { Authorization: `Bearer ${OPENCV_PARSER_TOKEN}` } : {}),
      },
      body: bytes,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('opencv parser returned HTTP', response.status);
      return null;
    }
    const result = (await response.json()) as ReaderResult;
    return result && typeof result === 'object' ? result : null;
  } catch (error) {
    console.error('opencv parser unavailable, falling back to pdf-parse:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pass the reader's answer through in the shape the app already reads, or null
 * when the built-in parser should answer instead (nothing readable, or a
 * malformed reply). A locked file keeps driving the app's password flow.
 */
function readerResponse(result: ReaderResult): Response | null {
  if (result.success === false) {
    if (result.code === 'PASSWORD_REQUIRED' || result.code === 'INCORRECT_PASSWORD') {
      return jsonResponse({ success: false, code: result.code, error: result.error });
    }
    return null;
  }
  const text = typeof result.text === 'string' ? result.text : '';
  const table = Array.isArray(result.table) ? result.table : [];
  if (result.success !== true || text.length < MIN_TEXT_LENGTH || table.length === 0) {
    return null;
  }
  return jsonResponse({
    success: true,
    text: text.slice(0, 100000),
    pages: typeof result.pages === 'number' ? result.pages : 1,
    table: table.slice(0, 5000),
    reader: 'opencv',
    method: typeof result.method === 'string' ? result.method : undefined,
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 20) : [],
  });
}

/**
 * pdf-parse never forwards a password to pdf.js, so a locked statement throws
 * a PasswordException (name "PasswordException", with a message such as
 * "No password given" / "Incorrect Password"). Detect it so we can ask the
 * user for a password instead of failing with a generic error.
 */
function isPasswordException(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'PasswordException' || /password/i.test(e.message ?? '');
}

interface PdfPageText {
  getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
    items: PdfTextItem[];
  }>;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageText>;
  destroy: () => Promise<void>;
}

/**
 * Unlock a password-protected PDF and extract its text.
 *
 * We reach for the pdf.js build that pdf-parse already ships (the same engine
 * that runs today), but call it ourselves so we can pass `password`. The
 * import is lazy: if it ever fails, only locked-file requests are affected,
 * never the function's cold start.
 */
async function extractTextWithPassword(bytes: Uint8Array, password: string) {
  const mod = await import("npm:pdf-parse@1.1.1/lib/pdf.js/v1.10.100/build/pdf.js");
  const PDFJS = ((mod as { default?: unknown }).default ?? mod) as {
    disableWorker?: boolean;
    getDocument: (params: { data: Uint8Array; password: string }) => unknown;
  };
  PDFJS.disableWorker = true;

  const task = PDFJS.getDocument({ data: bytes, password }) as
    | Promise<PdfDocument>
    | { promise: Promise<PdfDocument> };
  const doc = (await ((task as { promise?: Promise<PdfDocument> }).promise ?? task)) as PdfDocument;

  try {
    let text = '';
    const pageItems: PdfTextItem[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      // Rebuild the page with column-aware spacing (see pdfText.ts) instead of
      // gluing every same-line text item together, and keep the raw items so we
      // can also build a deterministic table.
      pageItems.push(content.items ?? []);
      text += itemsToText(content.items) + '\n\n';
    }
    return { text: text.trim(), pages: doc.numPages, table: pagesToTable(pageItems) };
  } finally {
    try {
      await doc.destroy();
    } catch {
      // ignore cleanup errors
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const { path, password } = await req.json();
    if (!path || typeof path !== 'string') {
      return jsonResponse({ success: false, error: 'Missing file path.' }, 400);
    }

    const { data: blob, error: dlErr } = await supabase.storage.from('statements').download(path);
    if (dlErr || !blob) {
      console.error('download error:', dlErr);
      return jsonResponse({ success: false, error: 'Could not read the uploaded statement.' }, 500);
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const suppliedPassword = typeof password === 'string' ? password : '';

    // Every upload goes through the OpenCV reader first when it is configured.
    // The reader answers in this function's own contract, so a locked file, a
    // scan and a normal statement all keep their existing behaviour.
    const read = await parseWithOpenCv(bytes, suppliedPassword);
    if (read) {
      const answered = readerResponse(read);
      if (answered) return answered;
    }

    // A password was supplied, so the file is (almost certainly) locked. Unlock
    // it with pdf.js and read the text directly.
    if (suppliedPassword.length > 0) {
      try {
        const { text, pages, table } = await extractTextWithPassword(bytes, suppliedPassword);
        if (text.length < MIN_TEXT_LENGTH) {
          return jsonResponse({
            success: false,
            error: 'No readable text found after unlocking this PDF. It may be a scanned image — try a text/PDF export from your banking app, or paste the statement text manually.',
          }, 422);
        }
        return jsonResponse({ success: true, text: text.slice(0, 100000), pages, table: table.slice(0, 5000) });
      } catch (err) {
        if (isPasswordException(err)) {
          // 200 so the app can treat this as a normal branch rather than a failure.
          return jsonResponse({
            success: false,
            code: 'INCORRECT_PASSWORD',
            error: 'That password did not unlock the PDF. Please check it and try again.',
          });
        }
        throw err;
      }
    }

    // No password yet: use the fast parser. If the PDF turns out to be locked,
    // tell the app so it can prompt the user for the password.
    try {
      const pageItems: PdfTextItem[][] = [];
      const parsed = await pdf(bytes, { pagerender: (pageData: PdfPageData) => renderPageInto(pageData, pageItems) });
      const text = String(parsed?.text ?? '').trim();
      if (text.length < MIN_TEXT_LENGTH) {
        return jsonResponse({
          success: false,
          error: 'No readable text found in this PDF. It may be a scanned image — try a text/PDF export from your banking app, or paste the statement text manually.',
        }, 422);
      }
      const table = pagesToTable(pageItems);
      return jsonResponse({ success: true, text: text.slice(0, 100000), pages: parsed?.numpages ?? 1, table: table.slice(0, 5000) });
    } catch (err) {
      if (isPasswordException(err)) {
        // 200 so the app can treat this as a normal branch rather than a failure.
        return jsonResponse({
          success: false,
          code: 'PASSWORD_REQUIRED',
          error: 'This statement is password-protected. Enter the PDF password to continue.',
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('parse-statement error:', err);
    return jsonResponse({
      success: false,
      error: 'Failed to parse the PDF. Try a different export format or paste the text manually.',
    }, 500);
  }
});
