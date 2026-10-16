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

export function itemsToText(items: PdfTextItem[]): string {
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
  if (runs.length === 0) return "";

  // Top-to-bottom, then left-to-right. PDF y increases upwards, so a larger y
  // is higher on the page.
  const ordered = runs.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: { y: number; runs: Run[] }[] = [];
  let current: { y: number; runs: Run[] } | null = null;
  let previousEndedLine = false;
  for (const run of ordered) {
    const tolerance = Math.max(1.5, run.height * 0.5);
    const sameRow = current !== null && !previousEndedLine && Math.abs(current.y - run.y) <= tolerance;
    if (!sameRow) {
      current = { y: run.y, runs: [] };
      rows.push(current);
    }
    current!.runs.push(run);
    previousEndedLine = run.eol;
  }

  const lines = rows.map((row) => {
    const sorted = row.runs.slice().sort((a, b) => a.x - b.x);
    let line = "";
    let previousEndX: number | undefined;
    let previousHeight = sorted[0]?.height ?? 10;
    for (const run of sorted) {
      if (previousEndX !== undefined) {
        const gap = run.x - previousEndX;
        // A small gap is intra-word kerning; a larger gap is a word/column
        // boundary and must become a space.
        const threshold = Math.max(0.75, Math.min(previousHeight, run.height) * 0.15);
        if (gap > threshold) line += " ";
      }
      line += run.str;
      previousEndX = run.x + run.width;
      previousHeight = run.height;
    }
    return line.replace(/[ \t]+/g, " ").trim();
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// <<< itemsToText

interface PdfPageData {
  getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: PdfTextItem[] }>;
}

/**
 * pdf-parse's default page renderer joins same-line text items with no
 * separator, which jams statement columns together. Rebuild each page with
 * column-aware spacing so the amount and running balance stay separate.
 */
async function renderPage(pageData: PdfPageData): Promise<string> {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  return itemsToText(content.items);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    | Promise<unknown>
    | { promise: Promise<any> };
  const doc = await ((task as { promise?: Promise<any> }).promise ?? task) as {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
        items: PdfTextItem[];
      }>;
    }>;
    destroy: () => Promise<void>;
  };

  try {
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      // Rebuild the page with column-aware spacing (see pdfText.ts) instead of
      // gluing every same-line text item together.
      text += itemsToText(content.items) + '\n\n';
    }
    return { text: text.trim(), pages: doc.numPages };
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

    // A password was supplied, so the file is (almost certainly) locked. Unlock
    // it with pdf.js and read the text directly.
    if (suppliedPassword.length > 0) {
      try {
        const { text, pages } = await extractTextWithPassword(bytes, suppliedPassword);
        if (text.length < MIN_TEXT_LENGTH) {
          return jsonResponse({
            success: false,
            error: 'No readable text found after unlocking this PDF. It may be a scanned image — try a text/PDF export from your banking app, or paste the statement text manually.',
          }, 422);
        }
        return jsonResponse({ success: true, text: text.slice(0, 100000), pages });
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
      const parsed = await pdf(bytes, { pagerender: renderPage });
      const text = String(parsed?.text ?? '').trim();
      if (text.length < MIN_TEXT_LENGTH) {
        return jsonResponse({
          success: false,
          error: 'No readable text found in this PDF. It may be a scanned image — try a text/PDF export from your banking app, or paste the statement text manually.',
        }, 422);
      }
      return jsonResponse({ success: true, text: text.slice(0, 100000), pages: parsed?.numpages ?? 1 });
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
