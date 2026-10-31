import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Bookmaker by Investours — AI ebook generation.
 *
 * Every paid AI operation is reserved server-side through
 * `bookmaker_reserve_operation`. The client can never choose the price, and a
 * repeated request key can never charge twice. Zero-credit operations are still
 * recorded so one browser/account cannot run an uncontrolled stream of calls.
 *
 * Actions:
 *   outline             0 cr  — idea -> title + chapter outline
 *   start_manuscript    paid  — reserve the whole book, then call `chapter`
 *   resume              0 cr  — inspect an existing reservation without charging
 *   chapter             paid  — generate one chapter inside an open reservation
 *   complete            0 cr  — settle a reservation once all chapters exist
 *   abandon             0 cr  — settle early and refund ungenerated chapters
 *   regenerate_chapter  paid  — rewrite one chapter (1 credit)
 *   regenerate_visual   paid  — rewrite one visual block (1 credit)
 *   generate_cover      paid  — typographic/vector cover art direction (1 credit)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const LENGTHS = {
  short: { label: "Short guide", chapters: 4, minChapters: 3, maxChapters: 5, words: 2400, credits: 2 },
  medium: { label: "Medium book", chapters: 8, minChapters: 6, maxChapters: 10, words: 5500, credits: 4 },
  long: { label: "Long book", chapters: 12, minChapters: 10, maxChapters: 15, words: 10000, credits: 6 },
} as const;

type LengthKey = keyof typeof LENGTHS;

const AUDIENCES: Record<string, string> = {
  general: "General readers",
  entrepreneurs: "Entrepreneurs and startup founders",
  small_business: "Small business owners",
  professionals: "Employees and working professionals",
  students: "Students and recent graduates",
  investors: "Investors and personal-finance enthusiasts",
  coaches: "Coaches, consultants and trainers",
  creators: "Creators, freelancers and solopreneurs",
  children: "Children (ages 6–12)",
  community: "Non-profit and community leaders",
};

const PURPOSES: Record<string, string> = {
  teach: "Teach a practical skill",
  lead_generation: "Generate leads for a business",
  sell: "Sell a product or service",
  personal_brand: "Build a personal brand",
  corporate_training: "Corporate training or staff development",
  onboarding: "Client or employee onboarding",
  workbook: "Interactive workbook",
  course_companion: "Course companion or study guide",
  thought_leadership: "Thought leadership",
  inspire: "Inspire and motivate",
  reference: "Reference guide",
  children_story: "Children's story or learning book",
  devotional: "Devotional or faith-based guide",
  memoir: "Memoir or personal story",
  marketing: "Marketing lead magnet",
};

const LANGUAGES = [
  "English", "French", "Spanish", "Portuguese", "Arabic", "Swahili",
  "Hausa", "Yoruba", "Igbo", "Amharic", "Chinese (Simplified)", "Hindi", "German",
];

const VISUAL_GUIDE = `Visual content is mandatory and must be genuinely useful — never decorative filler.
Use the custom blocks below inside the chapter markdown. Every block starts with :::type and ends with ::: on its own line.

:::callout Tip
One useful tip, warning or definition. Keep it to 1–2 short sentences.
:::

:::keypoints Key takeaways
- Point one — a specific action or insight
- Point two — why it matters
:::

:::checklist Action checklist
- [ ] Task one
- [x] Completed example
:::

:::diagram How the pieces connect
Idea -> Validation : test demand
Validation -> Launch : build the offer
Launch -> Growth : improve and repeat
:::

:::chart Monthly cash flow
Sales | 120
Costs | 45
Profit | 75
(unit: ₦'000)
:::

:::figure The customer journey
caption: A simple three-stage journey the reader can copy.
:::

Also use markdown tables when comparing options, and numbered lists for procedures.

How to choose the best visual:
- Comparison or decision: a markdown table with clear column headings.
- Process, system or cause-and-effect: a diagram with 3–6 nodes and a short label on each arrow.
- Progress, budget or proportions: a chart with 3–6 labelled values and a unit line.
- Doing the work: a checklist or numbered procedure.
- One idea that must stick: a callout or keypoints block.

Quality rules:
- Each visual must add information the prose does not already repeat. Never write a visual that only restates the paragraph above it.
- Give every visual a specific, useful title (not "Diagram" or "Overview"). Use the reader's language and real examples from the chapter.
- Diagrams must be a linear or branching flow with 3–6 short node labels (max 4 words each) and arrow labels that explain the relationship.
- Charts must have 3–6 bars, short labels, one unit, and numbers that are supplied by the author or clearly labelled as illustrative assumptions. Never invent statistics, studies, dates or sources.
- Prefer one excellent visual over three shallow ones. Include at least ONE visual block per chapter (two for a chapter over 700 words).
- Keep every label short enough to read on a phone and an A5 page. No image URLs, no emoji, no decorative images.`;

const OUTLINE_SYSTEM = `You are Bookmaker by Investours, a senior nonfiction book editor and instructional designer.
You turn a creator's idea into a commercially useful ebook outline that matches their audience, purpose and language.

Return ONLY valid JSON with this exact shape:
{
  "title": "compelling, specific book title",
  "subtitle": "one-line promise or positioning statement",
  "abstract": "one paragraph, 80-140 words, describing what the book covers, who it is for and what the reader can do afterwards",
  "chapters": [
    {
      "title": "chapter title",
      "summary": "2-3 sentence description of the chapter's argument and reader outcome",
      "sections": ["section heading", "section heading"],
      "visuals": ["the single most useful visual for this chapter, e.g. comparison table of pricing models"]
    }
  ]
}

Requirements:
- Write the title, subtitle, abstract, chapter titles, summaries and sections in the requested language.
- The abstract must read as a standalone book description: no headings, no bullet lists, no invented credentials.
- The number of chapters must be exactly the requested number.
- Chapters must build in a logical order and avoid repetition.
- Match the tone and structure to the purpose and audience. A workbook needs exercises, a children's book needs simple scenes and repetition, a business book needs frameworks and examples, a memoir needs narrative.
- Be concrete and practical. Do not invent statistics, studies or sources.
- Do not include markdown fences or commentary outside the JSON.`;

function extractJson(raw: string): any {
  const text = String(raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("The AI returned an unreadable response. Please try again.");
  }
}

// Actual API spend, recorded per operation for the admin dashboard.
const AI_PRICE_USD = {
  inputPerToken: 0.15 / 1_000_000,
  outputPerToken: 0.6 / 1_000_000,
  ttsPerCharacter: { en: 22 / 1_000_000, ar: 40 / 1_000_000 },
} as const;

type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  audioCharacters: number;
  ttsLanguage: "en" | "ar";
};

const createAiUsage = (): AiUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  audioCharacters: 0,
  ttsLanguage: "en",
});

function aiUsageCostUsd(usage: AiUsage): number {
  return (
    usage.inputTokens * AI_PRICE_USD.inputPerToken +
    usage.outputTokens * AI_PRICE_USD.outputPerToken +
    usage.audioCharacters * AI_PRICE_USD.ttsPerCharacter[usage.ttsLanguage]
  );
}

async function recordAiUsage(
  admin: SupabaseClient,
  operationId: string | null,
  usage: AiUsage,
): Promise<void> {
  if (!operationId) return;
  if (usage.inputTokens === 0 && usage.outputTokens === 0 && usage.audioCharacters === 0) return;
  const { error } = await admin.rpc("bookmaker_record_ai_usage", {
    p_operation_id: operationId,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_audio_characters: usage.audioCharacters,
    p_cost_usd: Number(aiUsageCostUsd(usage).toFixed(6)),
  });
  if (error) console.error("bookmaker: could not record AI usage", error);
}

async function callGroq(
  messages: { role: string; content: string }[],
  options: { maxTokens?: number; temperature?: number; usage?: AiUsage } = {},
): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: messages.map(({ role, content }) => ({
          role: role === "system" ? "developer" : role,
          content,
        })),
        temperature: options.temperature ?? 0.65,
        max_tokens: options.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) throw new Error("The AI is busy right now. Please try again in a moment.");
      if (response.status === 402) throw new Error("The AI service is temporarily unavailable.");
      console.error("bookmaker: Groq error", response.status, text.slice(0, 500));
      throw new Error(`AI generation failed (${response.status}). Please try again.`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("The AI returned an empty response. Please try again.");
    if (options.usage) {
      options.usage.inputTokens += Number(data?.usage?.prompt_tokens ?? 0);
      options.usage.outputTokens += Number(data?.usage?.completion_tokens ?? 0);
    }
    return String(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function callGroqJson(
  messages: { role: string; content: string }[],
  options: { maxTokens?: number; temperature?: number; usage?: AiUsage } = {},
): Promise<any> {
  const raw = await callGroq(messages, options);
  return extractJson(raw);
}

// ---------------------------------------------------------------------------
// Audiobook narration (Groq Orpheus)
// ---------------------------------------------------------------------------

const AUDIO_BUCKET = "bookmaker-audio";
const AUDIO_MODELS = {
  en: "canopylabs/orpheus-v1-english",
  ar: "canopylabs/orpheus-arabic-saudi",
} as const;

const AUDIO_VOICES: Record<string, { label: string; language: "en" | "ar" }> = {
  autumn: { label: "Autumn", language: "en" },
  diana: { label: "Diana", language: "en" },
  hannah: { label: "Hannah", language: "en" },
  austin: { label: "Austin", language: "en" },
  daniel: { label: "Daniel", language: "en" },
  troy: { label: "Troy", language: "en" },
  lulwa: { label: "Lulwa", language: "ar" },
  noura: { label: "Noura", language: "ar" },
  aisha: { label: "Aisha", language: "ar" },
  abdullah: { label: "Abdullah", language: "ar" },
  fahad: { label: "Fahad", language: "ar" },
  sultan: { label: "Sultan", language: "ar" },
};

const AUDIO_CHUNK_CHARS = 190;
const AUDIO_MAX_CHUNKS = 140;
const AUDIO_CONCURRENCY = 3;
const AUDIO_MAX_OUTPUT_BYTES = 240 * 1024 * 1024;

function audiobookLanguageFor(language: unknown): "en" | "ar" | null {
  const value = String(language ?? "").trim().toLowerCase();
  if (value.includes("arabic")) return "ar";
  if (!value || value.includes("english")) return "en";
  return null;
}

function resolveNarrator(book: any, requestedVoice: unknown) {
  const language = audiobookLanguageFor(book?.language) ?? "en";
  const requested = String(requestedVoice ?? "").trim();
  const candidate = AUDIO_VOICES[requested];
  const key = candidate && candidate.language === language
    ? requested
    : language === "ar" ? "lulwa" : "autumn";
  return {
    key,
    label: AUDIO_VOICES[key].label,
    language,
    model: AUDIO_MODELS[language],
  };
}

/** Turn chapter markdown into clean prose for narration. */
function speechText(content: unknown): string {
  return String(content ?? "")
    .replace(/^:::[a-z]+\b[\s\S]*?^:::\s*$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[*_~`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Orpheus accepts at most 200 characters per request, so split on sentences. */
function splitSpeechChunks(text: string, max = AUDIO_CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?…؟۔]+[.!?…؟۔]+["'”’)\]]*|[^.!?…؟۔]+$/g) ?? [text];
  const chunks: string[] = [];

  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };

  const pushLong = (sentence: string) => {
    let rest = sentence.trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut < max * 0.5) cut = max;
      push(rest.slice(0, cut));
      rest = rest.slice(cut).trim();
    }
    push(rest);
  };

  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length > max) {
      push(current);
      current = "";
      pushLong(part);
      continue;
    }
    if ((current + " " + part).trim().length > max) {
      push(current);
      current = part;
    } else {
      current = (current + " " + part).trim();
    }
  }
  push(current);
  return chunks;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(bytes[offset + i] ?? 0);
  return value;
}

interface WavParts {
  fmt: Uint8Array;
  data: Uint8Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  bytesPerSecond: number;
}

function parseWav(bytes: Uint8Array): WavParts {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("The narration service returned an invalid audio file.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmt: Uint8Array | null = null;
  let data: Uint8Array | null = null;

  while (offset + 8 <= bytes.length) {
    const id = readAscii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = Math.min(start + size, bytes.length);
    if (id === "fmt " && !fmt) fmt = bytes.slice(offset, Math.min(end, bytes.length));
    if (id === "data" && !data) data = bytes.slice(start, end);
    offset = start + size + (size % 2);
  }

  if (!fmt || !data || fmt.length < 24) {
    throw new Error("The narration service returned an incomplete audio file.");
  }

  const fmtView = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  const channels = fmtView.getUint16(10, true);
  const sampleRate = fmtView.getUint32(12, true);
  const bitsPerSample = fmtView.getUint16(22, true);
  const bytesPerSecond = Math.max(1, channels * sampleRate * (bitsPerSample / 8));

  return { fmt, data, sampleRate, channels, bitsPerSample, bytesPerSecond };
}

/** Join WAV clips without re-encoding, preserving the first clip's format. */
function concatWav(parts: Uint8Array[], gapSeconds = 0): Uint8Array {
  const parsed = parts.map(parseWav);
  if (parsed.length === 0) throw new Error("There is no narration to combine.");
  const first = parsed[0];
  const gapBytes = gapSeconds > 0 ? Math.floor(first.bytesPerSecond * gapSeconds) : 0;
  const totalBytes = parsed.reduce((total, part) => total + part.data.length, 0)
    + gapBytes * Math.max(0, parsed.length - 1);

  const data = new Uint8Array(totalBytes);
  const silence = first.bitsPerSample === 8 ? 128 : 0;
  let offset = 0;
  parsed.forEach((part, index) => {
    data.set(part.data, offset);
    offset += part.data.length;
    if (index < parsed.length - 1 && gapBytes > 0) {
      data.fill(silence, offset, offset + gapBytes);
      offset += gapBytes;
    }
  });

  const fmt = first.fmt;
  const fmtPadded = fmt.length % 2 === 0 ? fmt : new Uint8Array([...fmt, 0]);
  const header = new Uint8Array(12 + fmtPadded.length + 8);
  const headerView = new DataView(header.buffer);
  header.set(new TextEncoder().encode("RIFF"), 0);
  headerView.setUint32(4, 4 + fmtPadded.length + 8 + data.length, true);
  header.set(new TextEncoder().encode("WAVE"), 8);
  header.set(fmtPadded, 12);
  header.set(new TextEncoder().encode("data"), 12 + fmtPadded.length);
  headerView.setUint32(12 + fmtPadded.length + 4, data.length, true);

  const output = new Uint8Array(header.length + data.length);
  output.set(header, 0);
  output.set(data, header.length);
  return output;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGroqSpeech(
  input: string,
  voice: string,
  model: string,
  usage?: AiUsage,
): Promise<Uint8Array> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fatal = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input,
          voice,
          response_format: "wav",
        }),
      });

      if (response.ok) {
        if (usage) usage.audioCharacters += input.length;
        return new Uint8Array(await response.arrayBuffer());
      }

      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 900 * (attempt + 1);
        lastError = new Error("The narration service is busy. Please try again in a moment.");
        console.error("bookmaker: TTS busy", response.status, text.slice(0, 300));
        await sleep(wait);
        continue;
      }

      console.error("bookmaker: TTS error", response.status, text.slice(0, 500));
      if (response.status === 401 || response.status === 403) {
        fatal = true;
        throw new Error("Narration is not configured on the server.");
      }

      let detail = "";
      let code = "";
      try {
        const parsed = JSON.parse(text);
        detail = String(parsed?.error?.message ?? parsed?.message ?? "").trim();
        code = String(parsed?.error?.code ?? parsed?.code ?? "").trim();
      } catch {
        // Groq sometimes answers with a non-JSON body
      }
      if (code === "model_terms_required") {
        fatal = true;
        throw new Error(
          "Groq has not enabled the narration model for this account yet. An organisation admin must accept the Orpheus terms at https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english, then start the audiobook again.",
        );
      }
      throw new Error(detail ? `Narration failed: ${detail}` : `Narration failed (${response.status}). Please try again.`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Narration failed.");
      if (fatal || attempt === 2) throw lastError;
      await sleep(900 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Narration failed. Please try again.");
}

async function synthesizeChapter(
  content: unknown,
  voice: string,
  model: string,
  usage?: AiUsage,
): Promise<Uint8Array> {
  const text = speechText(content);
  if (text.length < 20) throw new Error("This chapter is too short to narrate.");

  const chunks = splitSpeechChunks(text, AUDIO_CHUNK_CHARS);
  if (chunks.length === 0) throw new Error("There is no readable text in this chapter.");
  if (chunks.length > AUDIO_MAX_CHUNKS) {
    throw new Error("This chapter is too long for a single narration pass. Shorten it and try again.");
  }

  // Synthesis runs in a small worker pool so a long chapter finishes well
  // inside the edge-function wall clock. Order is preserved by writing into a
  // pre-sized array, and a failed chunk fails the whole chapter for a clean
  // retry (nothing is uploaded until every chunk succeeded).
  const parts = new Array<Uint8Array>(chunks.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= chunks.length) return;
      parts[index] = await callGroqSpeech(chunks[index], voice, model, usage);
    }
  };

  const results = await Promise.allSettled(
    Array.from({ length: Math.min(AUDIO_CONCURRENCY, chunks.length) }, () => worker()),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;

  return concatWav(parts, 0.12);
}

async function storeNarration(
  admin: SupabaseClient,
  path: string,
  wav: Uint8Array,
): Promise<void> {
  const { error } = await admin.storage.from(AUDIO_BUCKET).upload(path, wav, {
    cacheControl: "3600",
    upsert: true,
    contentType: "audio/wav",
  });
  if (error) throw error;
}

// The audio bucket is private, so members never receive a permanent URL. The
// player signs the stored object paths on demand instead.
async function signNarration(admin: SupabaseClient, path: string, expiresIn = 60 * 60): Promise<string> {
  const { data, error } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Could not prepare the narration file.");
  }
  return data.signedUrl;
}


function normalizeConfig(body: any) {
  const lengthKey: LengthKey = body?.length === "short" || body?.length === "long" ? body.length : "medium";
  const customAudience = String(body?.customAudience ?? "").trim();
  const customPurpose = String(body?.customPurpose ?? "").trim();
  const customLanguage = String(body?.customLanguage ?? "").trim();

  const audience = customAudience || AUDIENCES[String(body?.audience ?? "")] || "General readers";
  const purpose = customPurpose || PURPOSES[String(body?.purpose ?? "")] || "Teach a practical skill";
  const requestedLanguage = customLanguage || String(body?.language ?? "English");
  const language = LANGUAGES.includes(requestedLanguage) ? requestedLanguage : requestedLanguage.slice(0, 40);

  return {
    lengthKey,
    length: LENGTHS[lengthKey],
    audience,
    purpose,
    language,
    idea: String(body?.idea ?? "").trim(),
  };
}

function clampText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const COVER_MOTIFS = [
  "orbit", "summit", "doorway", "growth", "wave", "grid", "shield", "spark",
  "path", "bloom", "horizon", "compass", "stack", "mosaic", "lens",
  "constellation", "prism",
];

const COVER_STYLES = [
  "bold-editorial", "warm-modern", "premium-minimal", "playful", "academic", "cinematic",
];

const COVER_LAYOUTS = ["stacked", "centered", "split", "framed"];

function hexLuminance(hex: unknown): number {
  const value = String(hex ?? "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
  const channel = (part: string) => {
    const srgb = parseInt(part, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6));
}

function contrastRatio(a: unknown, b: unknown): number {
  const first = hexLuminance(a);
  const second = hexLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Fix AI palettes that would print as unreadable cover type. */
function readableTextColor(background: string, preferred: unknown): string {
  if (typeof preferred === "string" && contrastRatio(preferred, background) >= 4.5) return preferred;
  return contrastRatio("#ffffff", background) >= contrastRatio("#111111", background) ? "#ffffff" : "#111111";
}

/** Truncate long prose without destroying its paragraph and visual markup. */
function truncateText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function chapterPrompt(
  book: any,
  outlineChapter: any,
  chapterNumber: number,
  totalChapters: number,
) {
  const config = normalizeConfig(book);
  const previous = Array.isArray(book?.chapters) ? book.chapters : [];
  const previousContext = previous
    .filter((c: any) => Number(c?.number) < chapterNumber)
    .slice(-3)
    .map((c: any) => `Chapter ${c.number} — ${c.title}: ${clampText(c.summary, 300)}`)
    .join("\n") || "This is the opening chapter.";

  // Divide the package word budget by the outline that was actually approved,
  // not by the ideal package chapter count. Otherwise a 5-chapter "short" book
  // or an edited outline produces chapters that are far too long or short.
  const plannedChapters = Math.max(1, totalChapters);
  const targetWords = Math.max(450, Math.round(config.length.words / plannedChapters));

  return `Write Chapter ${chapterNumber} of ${totalChapters} for this book.

Book title: ${book.title}
Subtitle: ${book.subtitle || ""}
Reader idea: ${book.idea}
Audience: ${config.audience}
Purpose: ${config.purpose}
Language: ${config.language}
Book length: ${config.length.label} (${config.length.words.toLocaleString()} words across ${plannedChapters} chapters)
Chapter title: ${outlineChapter.title}
Chapter brief: ${outlineChapter.summary}
Planned sections: ${(outlineChapter.sections ?? []).join("; ")}
Best visual for this chapter: ${(outlineChapter.visuals ?? []).join("; ") || "choose the most useful comparison, checklist or diagram"}

What came before:
${previousContext}

Write approximately ${targetWords}–${targetWords + 180} words.

Return ONLY valid JSON:
{
  "content": "chapter body in markdown with the custom visual blocks",
  "summary": "one sentence summary of what this chapter covered"
}

Body requirements:
- Start directly with the chapter body. Do NOT repeat the chapter title as a heading; the app adds it.
- Use ## for section headings, short paragraphs, and bullets where they help.
- Write for the stated audience and purpose in ${config.language}.
- Include concrete examples, steps, exercises or reflection prompts appropriate to the book type.
- ${VISUAL_GUIDE}
- Do not invent statistics, studies, quotes or sources. If a number is an illustration, label it clearly as an example.
- Finish with a short transition or action step for the reader.
- Do not use markdown fences around the whole answer.`;
}

function stripLeadingHeading(content: string): string {
  return String(content ?? "")
    .replace(/^\s*```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^\s*#{1,2}\s*(chapter\s+\d+[^\n]*)\n+/i, "")
    .trim();
}

function findVisualBlocks(content: string) {
  const blocks: { start: number; end: number; raw: string; type: string }[] = [];
  const re = /^:::[a-z]+\b[\s\S]*?^:::\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const raw = match[0];
    const type = raw.match(/^:::([a-z]+)/)?.[1] ?? "visual";
    blocks.push({ start: match.index, end: match.index + raw.length, raw, type });
  }
  return blocks;
}

function normalizeOutline(parsed: any, config: ReturnType<typeof normalizeConfig>) {
  const chapters = Array.isArray(parsed?.chapters) ? parsed.chapters : [];
  const desired = config.length.chapters;

  if (chapters.length === 0) {
    throw new Error("The AI did not return a usable outline. Please try again.");
  }

  const normalized = chapters.slice(0, desired).map((chapter: any, index: number) => ({
    number: index + 1,
    title: clampText(chapter?.title, 140) || `Chapter ${index + 1}`,
    summary: clampText(chapter?.summary, 600) || "",
    sections: Array.isArray(chapter?.sections)
      ? chapter.sections.map((s: unknown) => clampText(s, 140)).filter(Boolean).slice(0, 8)
      : [],
    visuals: Array.isArray(chapter?.visuals)
      ? chapter.visuals.map((s: unknown) => clampText(s, 160)).filter(Boolean).slice(0, 3)
      : [],
  }));

  // Never silently generate fewer chapters than the package promises.
  while (normalized.length < config.length.minChapters) {
    const n = normalized.length + 1;
    normalized.push({
      number: n,
      title: `Chapter ${n}`,
      summary: "Continue the book with the next practical step for the reader.",
      sections: [],
      visuals: [],
    });
  }

  return {
    title: clampText(parsed?.title, 160) || "Untitled Book",
    subtitle: clampText(parsed?.subtitle, 220),
    abstract: clampText(parsed?.abstract, 1200),
    chapters: normalized,
  };
}

async function getOwnedBook(admin: SupabaseClient, bookId: string, userId: string) {
  const { data, error } = await admin
    .from("bookmaker_books")
    .select("*")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function settleFailure(admin: SupabaseClient, operationId: string | null | undefined, reason: string) {
  if (!operationId) return;
  try {
    await admin.rpc("bookmaker_fail_operation", {
      p_operation_id: operationId,
      p_reason: reason.slice(0, 500),
    });
  } catch (err) {
    console.error("bookmaker: could not refund failed operation", operationId, err);
  }
}

function reserveErrorResponse(reserved: any) {
  const status = reserved?.reason === "unauthenticated" ? 401 : 200;
  return json({ ...reserved, success: false }, status);
}

function chaptersArray(book: any): any[] {
  return Array.isArray(book?.chapters) ? [...book.chapters] : [];
}

function upsertChapter(book: any, chapter: any): any[] {
  const chapters = chaptersArray(book);
  const index = chapters.findIndex((c: any) => Number(c?.number) === Number(chapter.number));
  if (index >= 0) chapters[index] = { ...chapters[index], ...chapter };
  else chapters.push(chapter);
  chapters.sort((a: any, b: any) => Number(a?.number) - Number(b?.number));
  return chapters;
}

function coveredByOperation(op: any): number[] {
  const generated = op?.metadata?.generated_chapters;
  if (!Array.isArray(generated)) return [];
  return generated.map((n: unknown) => Number(n)).filter((n) => Number.isFinite(n));
}

async function loadOperation(admin: SupabaseClient, operationId: string) {
  const { data, error } = await admin
    .from("bookmaker_credit_operations")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function duplicateInProgress(message: string, book: any, entitlement: unknown) {
  return json({
    success: false,
    reason: "operation_in_progress",
    message,
    book,
    entitlement,
  }, 409);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("bookmaker: missing Supabase environment configuration");
    return json({ success: false, message: "Server configuration error." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, reason: "unauthenticated", message: "Please sign in to continue." }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ success: false, reason: "unauthenticated", message: "Please sign in to continue." }, 401);
  }
  const userId = userData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "Invalid request body." }, 400);
  }

  const action = String(body?.action ?? "").trim();
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  let operationId: string | null = null;

  try {
    switch (action) {
      // ---------------------------------------------------------------------
      // Outline (0 credits, but idempotent and logged)
      // ---------------------------------------------------------------------
      case "outline": {
        const config = normalizeConfig(body);
        if (config.idea.length < 20) {
          return json({ success: false, message: "Describe your ebook idea in at least 20 characters." }, 400);
        }
        if (config.idea.length > 4000) {
          return json({ success: false, message: "Please keep the idea under 4,000 characters." }, 400);
        }
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        let book: any = null;
        let bookId = String(body?.bookId ?? "").trim() || null;
        if (bookId) {
          book = await getOwnedBook(admin, bookId, userId);
          if (!book) return json({ success: false, message: "Book not found." }, 404);

          // Never rewrite the saved configuration while another generation is
          // running for this book (the reservation guard would reject it, but
          // the book has already been edited by then).
          const { data: pendingOperation } = await admin
            .from("bookmaker_credit_operations")
            .select("id, operation")
            .eq("user_id", userId)
            .eq("book_id", bookId)
            .eq("status", "pending")
            .maybeSingle();
          if (pendingOperation) {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish.",
              book,
              null,
            );
          }

          // Rebuilding the outline after writing has started would orphan the
          // manuscript, change the chapter count and invalidate the paid
          // package. Structural changes belong to a new book.
          const writtenChapters = chaptersArray(book).filter(
            (chapter: any) => String(chapter?.content ?? "").trim().length > 0,
          );
          if (writtenChapters.length > 0) {
            return json({
              success: false,
              reason: "chapters_exist",
              message: "This book already has written chapters. Create a new book to change its outline structure.",
            }, 409);
          }
        }

        // Save the draft first so an upgrade/login detour never loses the idea.
        // `length` is only written together with the new outline below: changing
        // it before the AI succeeds could leave a 12-chapter outline labelled
        // "short" and under-price the manuscript.
        const bookFields = {
          idea: config.idea,
          idea_input_mode: body?.ideaInputMode === "voice" ? "voice" : "text",
          audience: String(body?.audience ?? book?.audience ?? "general"),
          custom_audience: String(body?.customAudience ?? "").trim() || null,
          purpose: String(body?.purpose ?? book?.purpose ?? "teach"),
          custom_purpose: String(body?.customPurpose ?? "").trim() || null,
          language: config.language,
          custom_language: String(body?.customLanguage ?? "").trim() || null,
          status: "configured",
        };

        if (book) {
          const { data: updated, error: updateError } = await admin
            .from("bookmaker_books")
            .update(bookFields)
            .eq("id", bookId)
            .eq("user_id", userId)
            .select("*")
            .single();
          if (updateError) throw updateError;
          book = updated;
        } else {
          const { data: created, error: createError } = await admin
            .from("bookmaker_books")
            .insert({ user_id: userId, ...bookFields })
            .select("*")
            .single();
          if (createError) throw createError;
          book = created;
          bookId = created.id;
        }

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: "outline",
          p_idempotency_key: idempotencyKey,
          p_length: config.lengthKey,
          p_metadata: { stage: "outline" },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);

        operationId = reserved.data.operation_id;
        if (reserved.data.duplicate) {
          const reservedOperation = await loadOperation(admin, operationId!);
          if (reservedOperation?.operation !== "outline") {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish.",
              book,
              reserved.data.entitlement,
            );
          }
          book = await getOwnedBook(admin, bookId, userId);
          const existingOutline = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
          if (existingOutline.length === 0) {
            return json({
              success: false,
              reason: "in_progress",
              message: "An outline is already being generated for this book. Please wait a moment.",
              book,
            }, 409);
          }
          return json({
            success: true,
            duplicate: true,
            book,
            outline: book?.outline ?? { chapters: [] },
            entitlement: reserved.data.entitlement,
          });
        }

        const usage = createAiUsage();
        const parsed = await callGroqJson(
          [
            { role: "system", content: OUTLINE_SYSTEM },
            {
              role: "user",
              content: `Create the outline for this ebook.

Idea: ${config.idea}
Audience: ${config.audience}
Purpose: ${config.purpose}
Language: ${config.language}
Length: ${config.length.label} — exactly ${config.length.chapters} chapters, roughly ${config.length.words.toLocaleString()} words total.
Book type hints: adapt structure, examples and exercises to the purpose and audience.`,
            },
          ],
          { maxTokens: 4000, temperature: 0.6, usage },
        );

        const outline = normalizeOutline(parsed, config);
        const filled = {
          ...outline,
          chapters: outline.chapters.map((c: any, i: number) => ({ ...c, number: i + 1 })),
        };

        const { data: saved, error: saveError } = await admin
          .from("bookmaker_books")
          .update({
            title: filled.title,
            subtitle: filled.subtitle,
            length: config.lengthKey,
            outline: { chapters: filled.chapters, abstract: filled.abstract, author: book?.outline?.author ?? "" },
            status: "outline_ready",
          })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        const completed = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationId });
        if (completed.error) console.error("bookmaker: complete outline failed", completed.error);
        await recordAiUsage(admin, operationId, usage);

        return json({
          success: true,
          book: saved,
          outline: saved.outline,
          entitlement: completed.data?.entitlement ?? reserved.data.entitlement,
        });
      }

      // ---------------------------------------------------------------------
      // Start a full manuscript (reserve once)
      // ---------------------------------------------------------------------
      case "start_manuscript": {
        const bookId = String(body?.bookId ?? "").trim();
        if (!bookId) return json({ success: false, message: "Book is required." }, 400);
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const outlineChapters = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
        if (outlineChapters.length === 0) {
          return json({ success: false, message: "Generate and review the outline before writing the manuscript." }, 400);
        }

        // Price and package must agree. Without this, a "short" book with a
        // long outline could be written for 2 credits.
        const packageLength = LENGTHS[(book.length as LengthKey)] ?? LENGTHS.medium;
        if (outlineChapters.length < packageLength.minChapters || outlineChapters.length > packageLength.maxChapters) {
          return json({
            success: false,
            message: `A ${packageLength.label} needs ${packageLength.minChapters}–${packageLength.maxChapters} chapters, but this outline has ${outlineChapters.length}. Adjust the outline or choose a different length.`,
          }, 400);
        }

        // "full_rework" restarts the whole book from the saved outline and
        // ignores approvals; "full_regeneration" keeps approved chapters.
        const requestedMode = String(body?.operation ?? "");
        const operation = requestedMode === "full_rework"
          ? "full_rework"
          : requestedMode === "full_regeneration"
            ? "full_regeneration"
            : "initial_book";
        const isRework = operation === "full_rework";
        const allIndexes = outlineChapters.map((_: unknown, i: number) => i);

        // A saved outline must never be shorter than chapters that already
        // contain content. Otherwise chapter numbers shift and approved work
        // would be relabelled with a different outline chapter's title. A full
        // rework replaces everything, so it is exempt and trims extras below.
        const writtenNumbers = chaptersArray(book)
          .map((chapter: any) => Number(chapter?.number))
          .filter((number: number) => Number.isInteger(number) && number > 0);
        const highestWrittenNumber = writtenNumbers.length > 0 ? Math.max(...writtenNumbers) : 0;
        if (!isRework && highestWrittenNumber > outlineChapters.length) {
          return json({
            success: false,
            reason: "outline_changed",
            message: "The outline was shortened after chapters were written. Restore the missing chapters or start a new book so the manuscript stays aligned.",
          }, 409);
        }
        const requestedLocked = Array.isArray(body?.lockedChapters)
          ? body.lockedChapters.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < outlineChapters.length)
          : [];
        // Approved chapters are locked server-side too. A stale or tampered
        // client must never overwrite work the author already approved.
        const approvedLocked = isRework ? [] : chaptersArray(book)
          .filter((chapter: any) => chapter?.status === "approved" && String(chapter?.content ?? "").trim().length > 0)
          .map((chapter: any) => Number(chapter?.number) - 1)
          .filter((index: number) => Number.isInteger(index) && index >= 0 && index < outlineChapters.length);
        const locked = isRework ? [] : [...new Set([...requestedLocked, ...approvedLocked])].sort((a, b) => a - b);
        const generateChapters = isRework ? allIndexes : allIndexes.filter((i: number) => !locked.includes(i));

        if (generateChapters.length === 0) {
          return json({ success: false, message: "All chapters are approved. Unlock at least one chapter to regenerate." }, 400);
        }

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: operation,
          p_idempotency_key: idempotencyKey,
          p_length: book.length,
          p_metadata: {
            total_chapters: outlineChapters.length,
            generate_chapters: generateChapters,
            locked_chapters: locked,
            mode: operation,
          },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);

        operationId = reserved.data.operation_id;

        let openOperation: any = null;
        const { data: opRow } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("id", operationId)
          .maybeSingle();
        openOperation = opRow;

        if (reserved.data.duplicate) {
          const openOperationType = String(openOperation?.operation ?? "");
          if (
            openOperationType !== "initial_book" &&
            openOperationType !== "full_regeneration" &&
            openOperationType !== "full_rework"
          ) {
            return json({
              success: false,
              reason: "operation_in_progress",
              message: "Another paid action is still running for this book. Please wait for it to finish, then try again.",
              book,
            }, 409);
          }
          const requested = Array.isArray(openOperation?.metadata?.generate_chapters)
            ? openOperation.metadata.generate_chapters.map((n: unknown) => Number(n))
            : generateChapters;
          const alreadyGenerated = new Set(coveredByOperation(openOperation));
          const pendingChapters = requested.filter((index: number) => !alreadyGenerated.has(index + 1));
          return json({
            success: true,
            duplicate: true,
            operationId,
            operation: openOperationType,
            totalChapters: outlineChapters.length,
            pendingChapters,
            generatedChapters: [...alreadyGenerated],
            cost: reserved.data.cost,
            book,
            entitlement: reserved.data.entitlement,
            message: "A generation is already in progress for this book.",
          });
        }

        // A rework replaces the manuscript, so any chapters left over from a
        // longer previous outline are removed before writing starts.
        if (isRework) {
          const existingChapters = chaptersArray(book);
          const trimmed = existingChapters.filter(
            (chapter: any) => Number(chapter?.number) <= outlineChapters.length,
          );
          if (trimmed.length !== existingChapters.length) {
            const { error: trimError } = await admin
              .from("bookmaker_books")
              .update({ chapters: trimmed })
              .eq("id", bookId)
              .eq("user_id", userId);
            if (trimError) throw trimError;
          }
        }

        await admin
          .from("bookmaker_books")
          .update({ status: "generating" })
          .eq("id", bookId)
          .eq("user_id", userId);

        return json({
          success: true,
          operationId,
          operation,
          totalChapters: outlineChapters.length,
          pendingChapters: generateChapters,
          generatedChapters: [],
          cost: reserved.data.cost,
          creditsFromSubscription: reserved.data.credits_from_subscription ?? 0,
          creditsFromPacks: reserved.data.credits_from_packs ?? 0,
          book,
          entitlement: reserved.data.entitlement,
        });
      }

      // ---------------------------------------------------------------------
      // Inspect an active manuscript reservation (0 credits, never charges)
      // ---------------------------------------------------------------------
      case "resume": {
        const bookId = String(body?.bookId ?? "").trim();
        if (!bookId) return json({ success: false, message: "Book is required." }, 400);

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const { data: openOperation, error: operationError } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("user_id", userId)
          .eq("book_id", bookId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (operationError) throw operationError;

        if (!openOperation) {
          return json({
            success: false,
            reason: "no_pending_operation",
            message: "There is no active generation for this book. Start writing again to continue.",
            book,
          });
        }

        const operationType = String(openOperation.operation ?? "");

        if (operationType === "audiobook") {
          const requestedAudio = Array.isArray(openOperation?.metadata?.generate_chapters)
            ? openOperation.metadata.generate_chapters.map((n: unknown) => Number(n))
            : [];
          const narrated = new Set(
            (Array.isArray(book?.audiobook?.chapters) ? book.audiobook.chapters : [])
              .map((chapter: any) => Number(chapter?.number))
              .filter((number: number) => Number.isInteger(number)),
          );
          const pendingAudio = requestedAudio.filter((number: number) => !narrated.has(number));

          return json({
            success: true,
            operationId: openOperation.id,
            operation: operationType,
            mode: "audiobook",
            voice: openOperation?.metadata?.voice ?? null,
            narrator: openOperation?.metadata?.narrator ?? null,
            model: openOperation?.metadata?.model ?? null,
            language: openOperation?.metadata?.language ?? null,
            totalChapters: requestedAudio.length,
            pendingChapters: pendingAudio,
            generatedChapters: [...narrated],
            cost: openOperation.credit_cost,
            book,
            entitlement: await caller.rpc("bookmaker_get_entitlement").then((result) => result.data),
          });
        }

        if (
          operationType !== "initial_book" &&
          operationType !== "full_regeneration" &&
          operationType !== "full_rework"
        ) {
          return json({
            success: false,
            reason: "operation_in_progress",
            message: "Another paid action is still running for this book. Please wait for it to finish.",
            operation: operationType,
            book,
          }, 409);
        }

        const outlineChapters = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
        const requested = Array.isArray(openOperation?.metadata?.generate_chapters)
          ? openOperation.metadata.generate_chapters.map((n: unknown) => Number(n))
          : outlineChapters.map((_: unknown, index: number) => index);
        const alreadyGenerated = new Set(coveredByOperation(openOperation));
        const pendingChapters = requested.filter((index: number) => !alreadyGenerated.has(index + 1));

        return json({
          success: true,
          operationId: openOperation.id,
          operation: operationType,
          totalChapters: outlineChapters.length,
          pendingChapters,
          generatedChapters: [...alreadyGenerated],
          cost: openOperation.credit_cost,
          book,
          entitlement: await caller.rpc("bookmaker_get_entitlement").then((result) => result.data),
        });
      }

      // ---------------------------------------------------------------------
      // Generate one chapter inside an open reservation
      // ---------------------------------------------------------------------
      case "chapter": {
        const bookId = String(body?.bookId ?? "").trim();
        const chapterIndex = Number(body?.chapterIndex);
        const operationIdValue = String(body?.operationId ?? "").trim();
        if (!bookId || !operationIdValue || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
          return json({ success: false, message: "Book, operation and chapter are required." }, 400);
        }

        const { data: op, error: opError } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("id", operationIdValue)
          .eq("user_id", userId)
          .eq("book_id", bookId)
          .maybeSingle();
        if (opError) throw opError;
        if (!op || op.status !== "pending") {
          return json({ success: false, message: "This generation is no longer active. Start again or resume from your book.", reason: "stale_operation" }, 409);
        }
        if (op.operation !== "initial_book" && op.operation !== "full_regeneration" && op.operation !== "full_rework") {
          return json({ success: false, message: "This reservation was not for a manuscript. Start writing to continue.", reason: "stale_operation" }, 409);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const outlineChapters = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
        const outlineChapter = outlineChapters[chapterIndex];
        if (!outlineChapter) return json({ success: false, message: "Chapter not found in the outline." }, 400);

        const requested = Array.isArray(op.metadata?.generate_chapters)
          ? op.metadata.generate_chapters.map((n: unknown) => Number(n))
          : [];
        if (!requested.includes(chapterIndex)) {
          return json({ success: false, message: "This chapter is protected or was not part of this reservation.", reason: "chapter_locked" }, 409);
        }

        const reservedTotal = Number(op.metadata?.total_chapters);
        if (Number.isFinite(reservedTotal) && reservedTotal > 0 && outlineChapters.length > reservedTotal) {
          return json({ success: false, message: "The outline changed after credits were reserved. Start a new generation so the price matches the book.", reason: "outline_changed" }, 409);
        }
        const reservedLength = String(op.metadata?.length ?? "");
        if (reservedLength && book.length !== reservedLength) {
          return json({ success: false, message: "The book length changed after credits were reserved. Start a new generation so the price matches the book.", reason: "outline_changed" }, 409);
        }

        const number = chapterIndex + 1;
        const existingChapter = chaptersArray(book).find((c: any) => Number(c?.number) === number);

        // A retry for a chapter already generated does not charge and returns the saved copy.
        if (coveredByOperation(op).includes(number) && existingChapter) {
          return json({
            success: true,
            duplicate: true,
            chapter: existingChapter,
            generatedChapters: coveredByOperation(op),
            totalChapters: outlineChapters.length,
            book,
          });
        }

        const usage = createAiUsage();
        const parsed = await callGroqJson(
          [
            {
              role: "system",
              content: `You are Bookmaker by Investours, an expert nonfiction author and instructional designer. Write publication-quality ebook chapters that match the requested audience, purpose and language. Never invent statistics, studies, quotes or sources. Return only valid JSON.

${VISUAL_GUIDE}`,
            },
            { role: "user", content: chapterPrompt(book, outlineChapter, number, outlineChapters.length) },
          ],
          { maxTokens: 6500, temperature: 0.7, usage },
        );

        const content = stripLeadingHeading(String(parsed?.content ?? ""));
        if (content.length < 200) {
          throw new Error("The chapter came back too short. Please retry this chapter.");
        }

        const chapter = {
          number,
          title: outlineChapter.title,
          summary: clampText(parsed?.summary, 500) || outlineChapter.summary,
          content,
          status: "generated",
          updatedAt: new Date().toISOString(),
        };
        const chapters = upsertChapter(book, chapter);

        const { data: updatedBook, error: saveError } = await admin
          .from("bookmaker_books")
          .update({ chapters, status: "generating", metadata: { ...(book.metadata ?? {}), lastChapterAt: new Date().toISOString() } })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        const progress = await admin.rpc("bookmaker_record_chapter_progress", {
          p_operation_id: operationIdValue,
          p_chapter_number: number,
          p_total_chapters: outlineChapters.length,
        });
        if (progress.error) console.error("bookmaker: chapter progress failed", progress.error);
        await recordAiUsage(admin, operationIdValue, usage);

        return json({
          success: true,
          chapter,
          chapters,
          generatedChapters: progress.data?.generated_chapters ?? [...coveredByOperation(op), number],
          totalChapters: outlineChapters.length,
          book: updatedBook,
        });
      }

      // ---------------------------------------------------------------------
      // Settle a completed manuscript
      // ---------------------------------------------------------------------
      case "complete": {
        const bookId = String(body?.bookId ?? "").trim();
        const operationIdValue = String(body?.operationId ?? "").trim();
        if (!bookId || !operationIdValue) {
          return json({ success: false, message: "Book and operation are required." }, 400);
        }
        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        // Never let a partially generated reservation be marked complete: an
        // early completion would silently forfeit the refund for the chapters
        // that were never written.
        const { data: operation, error: operationError } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("id", operationIdValue)
          .eq("book_id", bookId)
          .eq("user_id", userId)
          .maybeSingle();
        if (operationError) throw operationError;
        if (!operation) {
          return json({ success: false, message: "This generation is no longer active." }, 409);
        }

        // Safe retry: a manuscript that was already settled must not fail just
        // because the browser retried the request after a network hiccup.
        if (operation.status === "completed") {
          if (!["initial_book", "full_regeneration", "full_rework"].includes(String(operation.operation))) {
            return json({ success: false, message: "This generation is no longer active." }, 409);
          }
          const entitlement = await caller.rpc("bookmaker_get_entitlement");
          if (entitlement.error) console.error("bookmaker: entitlement read failed", entitlement.error);
          return json({
            success: true,
            duplicate: true,
            book,
            entitlement: entitlement.data ?? null,
          });
        }

        if (operation.status !== "pending") {
          return json({ success: false, message: "This generation is no longer active." }, 409);
        }
        if (["initial_book", "full_regeneration", "full_rework"].includes(String(operation.operation))) {
          const requested = Array.isArray(operation?.metadata?.generate_chapters)
            ? operation.metadata.generate_chapters.map((n: unknown) => Number(n))
            : [];
          const generated = new Set(coveredByOperation(operation));
          const missingChapters = requested.filter((index: number) => !generated.has(index + 1));
          if (missingChapters.length > 0) {
            return json({
              success: false,
              reason: "chapters_missing",
              message: "Some chapters are still missing. Retry them before completing the book.",
              missingChapters,
            }, 409);
          }
        }

        const result = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationIdValue });
        if (result.error) throw result.error;
        if (!result.data?.success) return json({ success: false, ...result.data }, 409);

        const { data: saved } = await admin
          .from("bookmaker_books")
          .update({ status: "manuscript_ready" })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();

        return json({ success: true, book: saved ?? book, entitlement: result.data.entitlement });
      }

      // ---------------------------------------------------------------------
      // Stop early; refund ungenerated chapters
      // ---------------------------------------------------------------------
      case "abandon": {
        const bookId = String(body?.bookId ?? "").trim();
        const operationIdValue = String(body?.operationId ?? "").trim();
        if (!operationIdValue) return json({ success: false, message: "Operation is required." }, 400);

        // The operation must belong to this member and, when a book is given,
        // to that same book. Otherwise a caller could settle another book's
        // reservation and then mark the wrong book as ready.
        let operationQuery = admin
          .from("bookmaker_credit_operations")
          .select("id, book_id, operation, status")
          .eq("id", operationIdValue)
          .eq("user_id", userId);
        if (bookId) operationQuery = operationQuery.eq("book_id", bookId);
        const { data: ownedOperation, error: ownedOperationError } = await operationQuery.maybeSingle();
        if (ownedOperationError) throw ownedOperationError;
        if (!ownedOperation) {
          return json({ success: false, message: "Operation not found for this book." }, 404);
        }
        if (ownedOperation.status !== "pending") {
          return json({ success: false, message: "This generation is already settled." }, 409);
        }

        const result = await caller.rpc("bookmaker_abandon_operation", {
          p_operation_id: operationIdValue,
          p_reason: clampText(body?.reason, 300) || "Cancelled by user",
        });
        if (result.error) throw result.error;

        let saved: any = null;
        if (bookId) {
          const { data: current } = await admin
            .from("bookmaker_books")
            .select("*")
            .eq("id", bookId)
            .eq("user_id", userId)
            .maybeSingle();
          if (current) {
            const status = chaptersArray(current).length > 0 ? "manuscript_ready" : "outline_ready";
            const patch: Record<string, unknown> = { status };

            // A stopped narration pass should leave the chapters that were
            // already voiced usable, and clearly show that the rest is missing.
            if (ownedOperation.operation === "audiobook") {
              const audiobook = (current.audiobook && typeof current.audiobook === "object") ? current.audiobook : {};
              const narrated = Array.isArray(audiobook.chapters) ? audiobook.chapters : [];
              patch.status = current.status;
              patch.audiobook = {
                ...audiobook,
                status: narrated.length > 0 ? "ready" : "failed",
                operationId: null,
                full: null,
                updatedAt: new Date().toISOString(),
              };
            }

            const updated = await admin
              .from("bookmaker_books")
              .update(patch)
              .eq("id", bookId)
              .eq("user_id", userId)
              .select("*")
              .single();
            saved = updated.data;
          }
        }

        return json({ ...result.data, book: saved });
      }

      // ---------------------------------------------------------------------
      // Regenerate one chapter (1 credit)
      // ---------------------------------------------------------------------
      case "regenerate_chapter": {
        const bookId = String(body?.bookId ?? "").trim();
        const chapterIndex = Number(body?.chapterIndex);
        if (!bookId || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
          return json({ success: false, message: "Book and chapter are required." }, 400);
        }
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: "chapter_regeneration",
          p_idempotency_key: idempotencyKey,
          p_length: book.length,
          p_metadata: { chapter_index: chapterIndex },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);
        operationId = reserved.data.operation_id;

        if (reserved.data.duplicate) {
          const duplicateOperation = await loadOperation(admin, operationId!);
          const sameRequest =
            duplicateOperation?.operation === "chapter_regeneration" &&
            Number(duplicateOperation?.metadata?.chapter_index) === chapterIndex;
          if (!sameRequest) {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish, then try again.",
              book,
              reserved.data.entitlement,
            );
          }
          if (duplicateOperation.status === "pending") {
            return json({
              success: false,
              reason: "in_progress",
              message: "This chapter is already being rewritten. Please wait a moment for it to finish.",
              book,
            }, 409);
          }
          const current = await getOwnedBook(admin, bookId, userId);
          return json({
            success: true,
            duplicate: true,
            chapter: chaptersArray(current).find((c: any) => Number(c?.number) === chapterIndex + 1) ?? null,
            book: current,
            entitlement: reserved.data.entitlement,
          });
        }

        try {
          const outlineChapters = Array.isArray(book?.outline?.chapters) ? book.outline.chapters : [];
          const outlineChapter = outlineChapters[chapterIndex] ?? {
            title: `Chapter ${chapterIndex + 1}`,
            summary: "",
            sections: [],
            visuals: [],
          };
          const existing = chaptersArray(book).find((c: any) => Number(c?.number) === chapterIndex + 1);

          const usage = createAiUsage();
          const parsed = await callGroqJson(
            [
              {
                role: "system",
                content: `You are Bookmaker by Investours, an expert editor. Rewrite a single chapter so it fits the rest of the book. Never invent statistics, studies, quotes or sources. Return only valid JSON.

${VISUAL_GUIDE}`,
              },
              {
                role: "user",
                content: `${chapterPrompt(book, outlineChapter, chapterIndex + 1, outlineChapters.length)}

The author asked for this change: ${clampText(body?.instruction, 600) || "Improve clarity, depth and usefulness while keeping the same topic."}

Current chapter (rewrite it, do not repeat it verbatim):
---
${truncateText(existing?.content, 9000) || "(not written yet)"}
---`,
              },
            ],
            { maxTokens: 6500, temperature: 0.75, usage },
          );

          const content = stripLeadingHeading(String(parsed?.content ?? ""));
          if (content.length < 200) throw new Error("The rewritten chapter came back too short. Please try again.");

          const chapter = {
            number: chapterIndex + 1,
            title: outlineChapter.title,
            summary: clampText(parsed?.summary, 500) || existing?.summary || outlineChapter.summary,
            content,
            status: "generated",
            updatedAt: new Date().toISOString(),
          };
          const chapters = upsertChapter(book, chapter);

          const { data: saved, error: saveError } = await admin
            .from("bookmaker_books")
            .update({ chapters, status: "generating" })
            .eq("id", bookId)
            .eq("user_id", userId)
            .select("*")
            .single();
          if (saveError) throw saveError;

          const completed = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationId });
          if (completed.error) throw completed.error;
          await recordAiUsage(admin, operationId, usage);

          await admin
            .from("bookmaker_books")
            .update({ status: "manuscript_ready" })
            .eq("id", bookId)
            .eq("user_id", userId);

          return json({
            success: true,
            chapter,
            book: saved,
            entitlement: completed.data?.entitlement,
          });
        } catch (err) {
          await settleFailure(admin, operationId, err instanceof Error ? err.message : "Chapter regeneration failed");
          throw err;
        }
      }

      // ---------------------------------------------------------------------
      // Regenerate one visual block (1 credit)
      // ---------------------------------------------------------------------
      case "regenerate_visual": {
        const bookId = String(body?.bookId ?? "").trim();
        const chapterIndex = Number(body?.chapterIndex);
        const blockIndex = Number(body?.blockIndex);
        if (!bookId || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
          return json({ success: false, message: "Book and chapter are required." }, 400);
        }
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const chapters = chaptersArray(book);
        const chapter = chapters.find((c: any) => Number(c?.number) === chapterIndex + 1);
        if (!chapter) return json({ success: false, message: "Write the chapter before regenerating its visuals." }, 400);

        const blocks = findVisualBlocks(String(chapter.content ?? ""));
        if (blocks.length === 0) {
          return json({ success: false, message: "This chapter has no visual to regenerate." }, 400);
        }
        const targetIndex = Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < blocks.length ? blockIndex : 0;
        const target = blocks[targetIndex];

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: "visual_regeneration",
          p_idempotency_key: idempotencyKey,
          p_length: book.length,
          p_metadata: { chapter_index: chapterIndex, block_index: targetIndex },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);
        operationId = reserved.data.operation_id;

        if (reserved.data.duplicate) {
          const duplicateOperation = await loadOperation(admin, operationId!);
          const sameRequest =
            duplicateOperation?.operation === "visual_regeneration" &&
            Number(duplicateOperation?.metadata?.chapter_index) === chapterIndex &&
            Number(duplicateOperation?.metadata?.block_index) === targetIndex;
          if (!sameRequest) {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish, then try again.",
              book,
              reserved.data.entitlement,
            );
          }
          if (duplicateOperation.status === "pending") {
            return json({
              success: false,
              reason: "in_progress",
              message: "This visual is already being refreshed. Please wait a moment for it to finish.",
              book,
            }, 409);
          }
          const current = await getOwnedBook(admin, bookId, userId);
          return json({
            success: true,
            duplicate: true,
            book: current,
            chapter: chaptersArray(current).find((c: any) => Number(c?.number) === chapterIndex + 1) ?? null,
            entitlement: reserved.data.entitlement,
          });
        }

        try {
          const before = String(chapter.content).slice(Math.max(0, target.start - 900), target.start);
          const after = String(chapter.content).slice(target.end, target.end + 900);
          const usage = createAiUsage();
          const raw = await callGroq(
            [
              {
                role: "system",
                content: `You are Bookmaker by Investours, a data-visualisation and instructional-design editor. Rewrite exactly one visual block so it explains the surrounding text better, is more specific and reads clearly on a phone. Never invent statistics, studies or sources. Return ONLY the replacement block, starting with ::: and ending with :::. Use one of these block types: callout, keypoints, checklist, diagram, chart, figure.

If the current visual only repeats the prose, replace it with the visual type that genuinely helps: a table-comparison idea becomes a diagram, a process becomes a 3–6 node flow, progress or proportions become a 3–6 bar chart, and actions become a checklist. Give it a specific title and short labels.

${VISUAL_GUIDE}`,
              },
              {
                role: "user",
                content: `Chapter: ${chapter.title}
Language: ${book.language || "English"}
Book: ${book.title}

Context before the visual:
${before}

CURRENT VISUAL:
${target.raw}

Context after the visual:
${after}

Author instruction: ${clampText(body?.instruction, 500) || "Make this visual clearer, more specific and more useful to the reader."}

Return only the replacement visual block.`,
              },
            ],
            { maxTokens: 1800, temperature: 0.7, usage },
          );

          let replacement = String(raw ?? "").trim().replace(/^```(?:\w+)?\s*/i, "").replace(/```\s*$/i, "").trim();
          if (!replacement.startsWith(":::")) {
            const first = replacement.indexOf(":::");
            replacement = first >= 0 ? replacement.slice(first) : "";
          }
          if (!replacement.startsWith(":::") || !/^:::\s*$/m.test(replacement)) {
            throw new Error("The AI returned an invalid visual. Please try again.");
          }

          const content =
            String(chapter.content).slice(0, target.start) +
            replacement +
            String(chapter.content).slice(target.end);

          const updatedChapter = { ...chapter, content, updatedAt: new Date().toISOString() };
          const nextChapters = chapters.map((c: any) =>
            Number(c?.number) === chapterIndex + 1 ? updatedChapter : c
          );

          const { data: saved, error: saveError } = await admin
            .from("bookmaker_books")
            .update({ chapters: nextChapters })
            .eq("id", bookId)
            .eq("user_id", userId)
            .select("*")
            .single();
          if (saveError) throw saveError;

          const completed = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationId });
          if (completed.error) throw completed.error;
          await recordAiUsage(admin, operationId, usage);

          return json({
            success: true,
            chapter: updatedChapter,
            visual: replacement,
            book: saved,
            entitlement: completed.data?.entitlement,
          });
        } catch (err) {
          await settleFailure(admin, operationId, err instanceof Error ? err.message : "Visual regeneration failed");
          throw err;
        }
      }

      // ---------------------------------------------------------------------
      // Narrate the whole book (4/8/12 credits by length, chapter by chapter)
      // ---------------------------------------------------------------------
      case "start_audiobook": {
        const bookId = String(body?.bookId ?? "").trim();
        if (!bookId) return json({ success: false, message: "Book is required." }, 400);
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const language = audiobookLanguageFor(book.language);
        if (!language) {
          return json({
            success: false,
            reason: "unsupported_language",
            message: "AI narration is available for English and Arabic books. You can still export the PDF or read the book aloud in your browser.",
          }, 400);
        }

        const written = chaptersArray(book)
          .filter((chapter: any) => String(chapter?.content ?? "").trim().length > 0)
          .sort((a: any, b: any) => Number(a?.number) - Number(b?.number));
        if (written.length === 0) {
          return json({ success: false, message: "Write at least one chapter before creating an audiobook." }, 400);
        }

        const narrator = resolveNarrator(book, body?.voice);
        const chapterNumbers = written
          .map((chapter: any) => Number(chapter?.number))
          .filter((number: number) => Number.isInteger(number) && number > 0);

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: "audiobook",
          p_idempotency_key: idempotencyKey,
          p_length: book.length,
          p_metadata: {
            voice: narrator.key,
            narrator: narrator.label,
            model: narrator.model,
            language: narrator.language,
            total_chapters: chapterNumbers.length,
            generate_chapters: chapterNumbers,
            mode: "audiobook",
          },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);
        operationId = reserved.data.operation_id;

        if (reserved.data.duplicate) {
          const openOperation = await loadOperation(admin, operationId!);
          if (openOperation?.operation !== "audiobook") {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish, then try again.",
              book,
              reserved.data.entitlement,
            );
          }
          const requested = Array.isArray(openOperation?.metadata?.generate_chapters)
            ? openOperation.metadata.generate_chapters.map((n: unknown) => Number(n))
            : chapterNumbers;
          const generated = new Set(coveredByOperation(openOperation));
          const pendingChapters = requested.filter((number: number) => !generated.has(number));
          const current = await getOwnedBook(admin, bookId, userId);
          return json({
            success: true,
            duplicate: true,
            operationId,
            operation: "audiobook",
            voice: openOperation?.metadata?.voice ?? narrator.key,
            model: openOperation?.metadata?.model ?? narrator.model,
            language: openOperation?.metadata?.language ?? narrator.language,
            pendingChapters,
            totalChapters: requested.length,
            cost: reserved.data.cost,
            book: current,
            entitlement: reserved.data.entitlement,
            message: pendingChapters.length
              ? "Narration is already in progress for this book."
              : "All chapters are narrated. Finalising the audiobook now.",
          });
        }

        // Starting a new narration pass replaces the previous voice, so the
        // chapter list is cleared until the new files exist.
        const audiobook = {
          status: "generating",
          operationId,
          voice: narrator.key,
          model: narrator.model,
          language: narrator.language,
          chapters: [],
          full: null,
          updatedAt: new Date().toISOString(),
        };

        // Remove the previous pass's files so stale audio can never be mixed
        // into the new voice. The database state is saved first, so a storage
        // hiccup can never leave the book pointing at deleted audio.
        const { data: saved, error: saveError } = await admin
          .from("bookmaker_books")
          .update({ audiobook })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        try {
          const folder = `${userId}/${bookId}`;
          const { data: stale } = await admin.storage.from(AUDIO_BUCKET).list(folder);
          const paths = (stale ?? [])
            .map((file: any) => String(file?.name ?? ""))
            .filter((name: string) => name.endsWith(".wav"))
            .map((name: string) => `${folder}/${name}`);
          if (paths.length > 0) {
            await admin.storage.from(AUDIO_BUCKET).remove(paths);
          }
        } catch (err) {
          console.error("bookmaker: could not clear old narration", err);
        }

        return json({
          success: true,
          operationId,
          operation: "audiobook",
          voice: narrator.key,
          model: narrator.model,
          language: narrator.language,
          pendingChapters: chapterNumbers,
          totalChapters: chapterNumbers.length,
          cost: reserved.data.cost,
          creditsFromSubscription: reserved.data.credits_from_subscription ?? 0,
          creditsFromPacks: reserved.data.credits_from_packs ?? 0,
          book: saved,
          entitlement: reserved.data.entitlement,
        });
      }

      // ---------------------------------------------------------------------
      // Narrate one chapter inside an audiobook reservation
      // ---------------------------------------------------------------------
      case "audiobook_chapter": {
        const bookId = String(body?.bookId ?? "").trim();
        const chapterNumber = Number(body?.chapterNumber);
        const operationIdValue = String(body?.operationId ?? "").trim();
        if (!bookId || !operationIdValue || !Number.isInteger(chapterNumber) || chapterNumber < 1) {
          return json({ success: false, message: "Book, operation and chapter are required." }, 400);
        }

        const { data: op, error: opError } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("id", operationIdValue)
          .eq("user_id", userId)
          .eq("book_id", bookId)
          .maybeSingle();
        if (opError) throw opError;
        if (!op || op.status !== "pending" || op.operation !== "audiobook") {
          return json({
            success: false,
            reason: "stale_operation",
            message: "This narration session is no longer active. Start narration again from the audiobook card.",
          }, 409);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const requested = Array.isArray(op.metadata?.generate_chapters)
          ? op.metadata.generate_chapters.map((n: unknown) => Number(n))
          : [];
        if (!requested.includes(chapterNumber)) {
          return json({ success: false, message: "This chapter was not part of this narration session.", reason: "chapter_locked" }, 409);
        }

        const audiobook = (book.audiobook && typeof book.audiobook === "object") ? book.audiobook : {};
        const existingChapters = Array.isArray(audiobook.chapters) ? audiobook.chapters : [];
        const existing = existingChapters.find((chapter: any) => Number(chapter?.number) === chapterNumber);
        if (existing) {
          const progress = await admin.rpc("bookmaker_record_chapter_progress", {
            p_operation_id: operationIdValue,
            p_chapter_number: chapterNumber,
            p_total_chapters: requested.length,
          });
          return json({
            success: true,
            duplicate: true,
            chapter: existing,
            chapters: existingChapters,
            generatedChapters: progress.data?.generated_chapters ?? [...coveredByOperation(op), chapterNumber],
            totalChapters: requested.length,
            book,
          });
        }

        const chapter = chaptersArray(book).find((item: any) => Number(item?.number) === chapterNumber);
        if (!chapter || String(chapter?.content ?? "").trim().length === 0) {
          return json({ success: false, message: "This chapter has no text to narrate." }, 400);
        }

        const voice = String(op.metadata?.voice ?? "autumn");
        const model = String(op.metadata?.model ?? AUDIO_MODELS.en);
        const usage = createAiUsage();
        usage.ttsLanguage = String(op.metadata?.language ?? "en") === "ar" ? "ar" : "en";
        const wav = await synthesizeChapter(chapter.content, voice, model, usage);
        const parsed = parseWav(wav);
        const path = `${userId}/${bookId}/chapter-${chapterNumber}.wav`;
        await storeNarration(admin, path, wav);
        const updatedAt = new Date().toISOString();
        const entry = {
          number: chapterNumber,
          title: clampText(chapter.title, 160) || `Chapter ${chapterNumber}`,
          path,
          voice,
          characters: speechText(chapter.content).length,
          bytes: wav.byteLength,
          durationSeconds: Math.round(parsed.data.length / parsed.bytesPerSecond),
          updatedAt,
        };

        const nextChapters = [...existingChapters, entry]
          .sort((a: any, b: any) => Number(a?.number) - Number(b?.number));
        const nextAudiobook = {
          ...audiobook,
          status: "generating",
          operationId: operationIdValue,
          voice,
          model,
          chapters: nextChapters,
          full: null,
          updatedAt,
        };

        const { data: saved, error: saveError } = await admin
          .from("bookmaker_books")
          .update({ audiobook: nextAudiobook })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        const progress = await admin.rpc("bookmaker_record_chapter_progress", {
          p_operation_id: operationIdValue,
          p_chapter_number: chapterNumber,
          p_total_chapters: requested.length,
        });
        if (progress.error) console.error("bookmaker: audio chapter progress failed", progress.error);
        await recordAiUsage(admin, operationIdValue, usage);

        return json({
          success: true,
          chapter: entry,
          chapters: nextChapters,
          generatedChapters: progress.data?.generated_chapters ?? [...coveredByOperation(op), chapterNumber],
          totalChapters: requested.length,
          book: saved,
        });
      }

      // ---------------------------------------------------------------------
      // Narrator preview (0 credits, cached per voice)
      // ---------------------------------------------------------------------
      case "preview_voice": {
        const voiceKey = String(body?.voice ?? "").trim();
        const voice = AUDIO_VOICES[voiceKey];
        if (!voice) return json({ success: false, message: "Choose a narrator to preview." }, 400);

        const fileName = `${voiceKey}.wav`;
        const path = `previews/${fileName}`;
        const { data: existing } = await admin.storage.from(AUDIO_BUCKET).list("previews", { limit: 100 });
        if ((existing ?? []).some((file) => file.name === fileName)) {
          return json({ success: true, voice: voiceKey, url: await signNarration(admin, path), cached: true });
        }

        const sample = voice.language === "ar"
          ? "هكذا سيبدو كتابك عندما يقرأه هذا الراوي. يمكنك تغيير الراوي في أي وقت قبل إنشاء الكتاب الصوتي."
          : "This is how your book will sound when this narrator reads it. You can switch narrators any time before creating the audiobook.";
        const wav = await synthesizeChapter(sample, voiceKey, AUDIO_MODELS[voice.language]);
        await storeNarration(admin, path, wav);
        return json({ success: true, voice: voiceKey, url: await signNarration(admin, path), cached: false });
      }

      // ---------------------------------------------------------------------
      // Finish an audiobook reservation
      // ---------------------------------------------------------------------
      case "complete_audiobook": {
        const bookId = String(body?.bookId ?? "").trim();
        const operationIdValue = String(body?.operationId ?? "").trim();
        if (!bookId || !operationIdValue) {
          return json({ success: false, message: "Book and operation are required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const { data: op, error: opError } = await admin
          .from("bookmaker_credit_operations")
          .select("*")
          .eq("id", operationIdValue)
          .eq("book_id", bookId)
          .eq("user_id", userId)
          .maybeSingle();
        if (opError) throw opError;
        if (!op || op.operation !== "audiobook") {
          return json({ success: false, message: "This narration session is no longer active." }, 409);
        }

        if (op.status === "completed") {
          const entitlement = await caller.rpc("bookmaker_get_entitlement");
          return json({
            success: true,
            duplicate: true,
            book,
            audiobook: book.audiobook ?? null,
            entitlement: entitlement.data ?? null,
          });
        }
        if (op.status !== "pending") {
          return json({ success: false, message: "This narration session is no longer active." }, 409);
        }

        const requested = Array.isArray(op.metadata?.generate_chapters)
          ? op.metadata.generate_chapters.map((n: unknown) => Number(n))
          : [];
        const generated = new Set(coveredByOperation(op));
        // Progress is recorded after each upload; the saved chapter list is the
        // source of truth if a progress write was interrupted.
        const audioChapters = Array.isArray(book?.audiobook?.chapters) ? book.audiobook.chapters : [];
        for (const chapter of audioChapters) {
          const number = Number(chapter?.number);
          if (Number.isInteger(number)) generated.add(number);
        }
        const missingChapters = requested.filter((number: number) => !generated.has(number));
        if (missingChapters.length > 0) {
          return json({
            success: false,
            reason: "chapters_missing",
            message: "Some chapters are still being narrated. Retry them before finishing the audiobook.",
            missingChapters,
          }, 409);
        }

        const result = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationIdValue });
        if (result.error) throw result.error;
        if (!result.data?.success) return json({ success: false, ...result.data }, 409);

        const audiobook = {
          ...((book.audiobook && typeof book.audiobook === "object") ? book.audiobook : {}),
          status: "ready",
          operationId: null,
          updatedAt: new Date().toISOString(),
        };
        const { data: saved, error: saveError } = await admin
          .from("bookmaker_books")
          .update({ audiobook })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        return json({
          success: true,
          book: saved ?? book,
          audiobook,
          entitlement: result.data.entitlement,
        });
      }

      // ---------------------------------------------------------------------
      // Combine narrated chapters into one downloadable WAV (0 credits)
      // ---------------------------------------------------------------------
      case "assemble_audiobook": {
        const bookId = String(body?.bookId ?? "").trim();
        if (!bookId) return json({ success: false, message: "Book is required." }, 400);

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const audiobook = (book.audiobook && typeof book.audiobook === "object") ? book.audiobook : {};
        const chapters = Array.isArray(audiobook.chapters)
          ? [...audiobook.chapters].sort((a: any, b: any) => Number(a?.number) - Number(b?.number))
          : [];
        if (chapters.length === 0) {
          return json({ success: false, message: "Narrate at least one chapter before combining the audiobook." }, 400);
        }

        const parts: Uint8Array[] = [];
        for (const chapter of chapters) {
          const path = String(chapter?.path ?? "");
          if (!path) continue;
          const { data, error } = await admin.storage.from(AUDIO_BUCKET).download(path);
          if (error || !data) {
            throw new Error(`Could not read the narration for chapter ${chapter?.number ?? "?"}. Please regenerate it.`);
          }
          parts.push(new Uint8Array(await data.arrayBuffer()));
        }
        if (parts.length === 0) {
          return json({ success: false, message: "There are no saved audio files to combine." }, 400);
        }

        const wav = concatWav(parts, 0.5);
        if (wav.byteLength > AUDIO_MAX_OUTPUT_BYTES) {
          return json({
            success: false,
            reason: "audio_too_large",
            message: "This audiobook is too large to combine into one WAV file. Download the chapters individually instead.",
          }, 400);
        }

        const parsed = parseWav(wav);
        const path = `${userId}/${bookId}/audiobook.wav`;
        await storeNarration(admin, path, wav);
        const updatedAt = new Date().toISOString();
        const full = {
          path,
          bytes: wav.byteLength,
          durationSeconds: Math.round(parsed.data.length / parsed.bytesPerSecond),
          updatedAt,
        };
        const nextAudiobook = { ...audiobook, full, updatedAt };

        const { data: saved, error: saveError } = await admin
          .from("bookmaker_books")
          .update({ audiobook: nextAudiobook })
          .eq("id", bookId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (saveError) throw saveError;

        return json({ success: true, full, audiobook: nextAudiobook, book: saved ?? book });
      }

      // ---------------------------------------------------------------------
      // Generate cover art direction (1 credit)
      // ---------------------------------------------------------------------
      case "generate_cover": {
        const bookId = String(body?.bookId ?? "").trim();
        if (!bookId) return json({ success: false, message: "Book is required." }, 400);
        if (idempotencyKey.length < 8) {
          return json({ success: false, message: "A valid request key is required." }, 400);
        }

        const book = await getOwnedBook(admin, bookId, userId);
        if (!book) return json({ success: false, message: "Book not found." }, 404);

        const reserved = await caller.rpc("bookmaker_reserve_operation", {
          p_book_id: bookId,
          p_operation: "cover_generation",
          p_idempotency_key: idempotencyKey,
          p_length: book.length,
          p_metadata: { style: clampText(body?.style, 80) || "auto" },
        });
        if (reserved.error) throw reserved.error;
        if (!reserved.data?.success) return reserveErrorResponse(reserved.data);
        operationId = reserved.data.operation_id;

        if (reserved.data.duplicate) {
          const duplicateOperation = await loadOperation(admin, operationId!);
          if (duplicateOperation?.operation !== "cover_generation") {
            return duplicateInProgress(
              "Another AI action is already running for this book. Please wait for it to finish, then try again.",
              book,
              reserved.data.entitlement,
            );
          }
          if (duplicateOperation.status === "pending") {
            return json({
              success: false,
              reason: "in_progress",
              message: "A cover is already being designed. Please wait a moment for it to finish.",
              book,
            }, 409);
          }
          const current = await getOwnedBook(admin, bookId, userId);
          return json({
            success: true,
            duplicate: true,
            book: current,
            cover: current?.cover ?? book.cover,
            entitlement: reserved.data.entitlement,
          });
        }

        try {
          const usage = createAiUsage();
          const parsed = await callGroqJson(
            [
              {
                role: "system",
                content: `You are Bookmaker by Investours, an award-winning book cover art director. You design modern typographic/vector covers — no photographs, no image URLs, no mockup text.

Return ONLY valid JSON:
{
  "concept": "the single concrete visual metaphor behind the cover, max 12 words",
  "headline": "short cover title, 3-7 words",
  "subheadline": "specific supporting promise, max 14 words",
  "tagline": "category or reader benefit, max 8 words",
  "motif": "one of: ${COVER_MOTIFS.join(", ")}",
  "style": "one of: ${COVER_STYLES.join(", ")}",
  "layout": "one of: ${COVER_LAYOUTS.join(", ")}",
  "palette": {
    "background": "#hex",
    "primary": "#hex",
    "accent": "#hex",
    "text": "#hex"
  }
}

Art direction rules:
- The concept must come from the book's actual idea, not a generic business cliché. A pricing guide might use "stack" or "compass"; a memoir might use "horizon" or "path"; a children's book might use "bloom" or "spark".
- Choose the motif, layout and palette that make that concept obvious at thumbnail size.
- Style meanings: bold-editorial = oversized type and strong contrast; warm-modern = human, warm and optimistic; premium-minimal = restrained, centred and expensive; playful = bright, rounded and friendly; academic = structured, framed and credible; cinematic = dramatic, dark and atmospheric.
- Palette: exactly one dominant background, one readable text colour and one luminous accent. Use rich, deliberate colours, not default blues. Background and text must reach at least 4.5:1 contrast. Only 6-digit hex values.
- Headline must be a tighter, more commercial version of the book title — not the whole subtitle. No author name, emoji, URLs, quotation marks or hashtags.
- Do not put text inside the motif. Do not mention "Bookmaker" in the headline or tagline.`,
              },
              {
                role: "user",
                content: `Design a cover for:
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Idea: ${truncateText(book.idea, 1200)}
Audience: ${book.custom_audience || book.audience}
Purpose: ${book.custom_purpose || book.purpose}
Language: ${book.language}
Length: ${book.length}
Chapter themes: ${(book.outline?.chapters ?? []).slice(0, 8).map((chapter: any) => clampText(chapter?.title, 80)).filter(Boolean).join(" | ") || "not outlined yet"}
Requested style: ${clampText(body?.style, 80) || "art director's choice"}`,
              },
            ],
            { maxTokens: 1200, temperature: 0.8, usage },
          );

          const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
          const fallback = {
            background: "#1f1235",
            primary: "#6d28d9",
            accent: "#34d399",
            text: "#ffffff",
          };
          const palette = parsed?.palette ?? {};
          const background = isHex(palette.background) ? palette.background : fallback.background;
          const design = {
            concept: clampText(parsed?.concept, 120),
            headline: clampText(parsed?.headline, 90) || clampText(book.title, 90),
            subheadline: clampText(parsed?.subheadline, 150) || clampText(book.subtitle, 150),
            tagline: clampText(parsed?.tagline, 80) || "Bookmaker by Investours",
            motif: COVER_MOTIFS.includes(parsed?.motif) ? parsed.motif : "orbit",
            style: COVER_STYLES.includes(parsed?.style) ? parsed.style : "bold-editorial",
            layout: COVER_LAYOUTS.includes(parsed?.layout) ? parsed.layout : undefined,
            palette: {
              background,
              primary: isHex(palette.primary) ? palette.primary : fallback.primary,
              accent: isHex(palette.accent) ? palette.accent : fallback.accent,
              text: readableTextColor(background, palette.text),
            },
          };

          const cover = {
            kind: "generated",
            design,
            updatedAt: new Date().toISOString(),
          };

          const { data: saved, error: saveError } = await admin
            .from("bookmaker_books")
            .update({ cover, status: book.status === "draft" ? "outline_ready" : book.status })
            .eq("id", bookId)
            .eq("user_id", userId)
            .select("*")
            .single();
          if (saveError) throw saveError;

          const completed = await caller.rpc("bookmaker_complete_operation", { p_operation_id: operationId });
          if (completed.error) throw completed.error;
          await recordAiUsage(admin, operationId, usage);

          return json({
            success: true,
            cover,
            book: saved,
            entitlement: completed.data?.entitlement,
          });
        } catch (err) {
          await settleFailure(admin, operationId, err instanceof Error ? err.message : "Cover generation failed");
          throw err;
        }
      }

      default:
        return json({ success: false, message: `Unknown action: ${action || "(missing)"}` }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
    console.error("bookmaker: unhandled error", action, message, err);
    await settleFailure(admin, operationId, message);
    return json({ success: false, message }, 500);
  }
});
