import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "npm:pdf-parse@1.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { path } = await req.json();
    if (!path || typeof path !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing file path.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: blob, error: dlErr } = await supabase.storage.from('statements').download(path);
    if (dlErr || !blob) {
      console.error('download error:', dlErr);
      return new Response(
        JSON.stringify({ success: false, error: 'Could not read the uploaded statement.' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = await pdf(bytes);

    const text = String(parsed?.text ?? '').trim();
    if (text.length < 20) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No readable text found in this PDF. It may be a scanned image — try a text/PDF export from your banking app, or paste the statement text manually.',
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, text: text.slice(0, 100000), pages: parsed?.numpages ?? 1 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error('parse-statement error:', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to parse the PDF. Try a different export format or paste the text manually.' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
