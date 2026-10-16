import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_TEXT_LENGTH = 20;

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
        items: Array<{ str?: string; transform?: number[] }>;
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
      // Group text items into lines the same way pdf-parse does.
      let lastY: number | undefined;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (lastY === undefined || lastY === y) text += item.str;
        else text += '\n' + item.str;
        lastY = y;
      }
      text += '\n\n';
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
      const parsed = await pdf(bytes);
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
