// Shared types and configuration for Bookmaker by Investours.
// Keep this file free of React/DOM imports so the wizard, preview and export
// helpers can all use the same definitions.

import type { CSSProperties } from "react";

export type BookLength = "short" | "medium" | "long";

export type BookStatus =
  | "draft"
  | "configured"
  | "outline_ready"
  | "generating"
  | "manuscript_ready"
  | "designed"
  | "completed"
  | "failed";

export interface OutlineChapter {
  number: number;
  title: string;
  summary: string;
  sections: string[];
  visuals: string[];
}

export interface BookOutline {
  chapters: OutlineChapter[];
}

export type ChapterStatus = "pending" | "generated" | "approved";

export interface BookChapter {
  number: number;
  title: string;
  summary?: string;
  content: string;
  status?: ChapterStatus;
  updatedAt?: string;
}

export interface CoverPalette {
  background: string;
  primary: string;
  accent: string;
  text: string;
}

export type CoverLayout = "stacked" | "centered" | "split" | "framed";

export interface CoverDesign {
  headline: string;
  subheadline: string;
  tagline: string;
  motif: string;
  style: string;
  layout?: CoverLayout;
  concept?: string;
  palette: CoverPalette;
}

/** Motifs the cover renderer knows how to draw. */
export const COVER_MOTIFS = [
  "orbit",
  "summit",
  "doorway",
  "growth",
  "wave",
  "grid",
  "shield",
  "spark",
  "path",
  "bloom",
  "horizon",
  "compass",
  "stack",
  "mosaic",
  "lens",
  "constellation",
  "prism",
] as const;

export const COVER_LAYOUTS: CoverLayout[] = ["stacked", "centered", "split", "framed"];

export function coverLayoutForStyle(style: string | undefined): CoverLayout {
  switch (style) {
    case "premium-minimal":
      return "centered";
    case "academic":
      return "framed";
    case "cinematic":
      return "split";
    default:
      return "stacked";
  }
}

export interface BookCover {
  kind: "none" | "generated" | "uploaded";
  url?: string;
  design?: CoverDesign;
  updatedAt?: string;
}

export type AudiobookLanguage = "en" | "ar";

export interface AudiobookVoice {
  key: string;
  label: string;
  gender: "female" | "male";
  description: string;
  language: AudiobookLanguage;
  model: string;
}

export const AUDIOBOOK_ENGLISH_MODEL = "canopylabs/orpheus-v1-english";
export const AUDIOBOOK_ARABIC_MODEL = "canopylabs/orpheus-arabic-saudi";

export const AUDIOBOOK_VOICES: AudiobookVoice[] = [
  { key: "autumn", label: "Autumn", gender: "female", description: "Warm and friendly", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
  { key: "diana", label: "Diana", gender: "female", description: "Clear and confident", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
  { key: "hannah", label: "Hannah", gender: "female", description: "Bright and expressive", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
  { key: "austin", label: "Austin", gender: "male", description: "Calm and conversational", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
  { key: "daniel", label: "Daniel", gender: "male", description: "Deep and reassuring", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
  { key: "troy", label: "Troy", gender: "male", description: "Natural and casual", language: "en", model: AUDIOBOOK_ENGLISH_MODEL },
];

export const AUDIOBOOK_ARABIC_VOICES: AudiobookVoice[] = [
  { key: "lulwa", label: "Lulwa", gender: "female", description: "Warm Saudi narration", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
  { key: "noura", label: "Noura", gender: "female", description: "Clear and expressive", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
  { key: "aisha", label: "Aisha", gender: "female", description: "Gentle and natural", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
  { key: "abdullah", label: "Abdullah", gender: "male", description: "Calm and authoritative", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
  { key: "fahad", label: "Fahad", gender: "male", description: "Warm and conversational", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
  { key: "sultan", label: "Sultan", gender: "male", description: "Deep and confident", language: "ar", model: AUDIOBOOK_ARABIC_MODEL },
];

/** AI narration currently supports English and Arabic manuscripts. */
export function audiobookLanguageFor(language: string | null | undefined): AudiobookLanguage | null {
  const value = String(language ?? "").trim().toLowerCase();
  if (value.includes("arabic")) return "ar";
  if (!value || value.includes("english")) return "en";
  return null;
}

export function audiobookVoicesFor(language: string | null | undefined): AudiobookVoice[] {
  return audiobookLanguageFor(language) === "ar" ? AUDIOBOOK_ARABIC_VOICES : AUDIOBOOK_VOICES;
}

export function defaultAudiobookVoice(language: string | null | undefined): string {
  return audiobookLanguageFor(language) === "ar" ? "lulwa" : "autumn";
}

export function audiobookVoiceLabel(voiceKey: string | null | undefined): string {
  const voice = [...AUDIOBOOK_VOICES, ...AUDIOBOOK_ARABIC_VOICES].find((item) => item.key === voiceKey);
  return voice ? `${voice.label} · ${voice.description}` : "Choose a narrator";
}

export function audiobookCostForLength(_length: BookLength): number {
  return 3;
}

export interface AudiobookChapter {
  number: number;
  title: string;
  url: string;
  path?: string;
  voice?: string;
  characters?: number;
  bytes?: number;
  durationSeconds?: number;
  updatedAt?: string;
}

export interface AudiobookFullFile {
  url: string;
  path?: string;
  bytes?: number;
  durationSeconds?: number;
  updatedAt?: string;
}

export interface AudiobookState {
  status?: "generating" | "ready" | "failed";
  operationId?: string | null;
  voice?: string;
  model?: string;
  language?: AudiobookLanguage;
  chapters?: AudiobookChapter[];
  full?: AudiobookFullFile | null;
  updatedAt?: string;
}

export interface BookPalette {
  background: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
}

export interface BookTheme {
  preset: ThemePresetKey;
  name: string;
  palette: BookPalette;
  headingFont: string;
  bodyFont: string;
}

export interface BookmakerBook {
  id: string;
  user_id: string;
  title: string;
  subtitle: string | null;
  idea: string;
  idea_input_mode: "text" | "voice";
  audience: string;
  custom_audience: string | null;
  purpose: string;
  custom_purpose: string | null;
  language: string;
  custom_language: string | null;
  length: BookLength;
  status: BookStatus;
  outline: BookOutline;
  chapters: BookChapter[];
  cover: BookCover;
  theme: Partial<BookTheme> | null;
  design: Record<string, unknown> | null;
  audiobook: AudiobookState | null;
  metadata: Record<string, unknown> | null;
  credits_spent: number;
  created_at: string;
  updated_at: string;
}

export interface BookmakerEntitlement {
  authenticated: boolean;
  subscription_active: boolean;
  subscription_type?: string | null;
  subscription_credits_remaining: number;
  subscription_credits_granted: number;
  subscription_credits_used: number;
  subscription_period_end?: string | null;
  pack_credits_remaining: number;
  total_available: number;
  costs: Record<string, number>;
}

export const DEFAULT_ENTITLEMENT: BookmakerEntitlement = {
  authenticated: false,
  subscription_active: false,
  subscription_credits_remaining: 0,
  subscription_credits_granted: 0,
  subscription_credits_used: 0,
  pack_credits_remaining: 0,
  total_available: 0,
  costs: {
    short: 2,
    medium: 4,
    long: 6,
    chapter_regeneration: 1,
    visual_regeneration: 1,
    cover_generation: 1,
    audiobook: 3,
    full_regeneration_short: 2,
    full_regeneration_medium: 4,
    full_regeneration_long: 6,
  },
};

export interface AudienceOption {
  key: string;
  label: string;
  description: string;
}

export const AUDIENCES: AudienceOption[] = [
  { key: "general", label: "General readers", description: "Everyday readers looking for clear, useful guidance." },
  { key: "entrepreneurs", label: "Entrepreneurs & founders", description: "Builders starting or scaling a venture." },
  { key: "small_business", label: "Small business owners", description: "Owner-operators growing a local business." },
  { key: "professionals", label: "Employees & professionals", description: "Career-focused people building workplace skills." },
  { key: "students", label: "Students & graduates", description: "Learners preparing for work, exams or business." },
  { key: "investors", label: "Investors & finance enthusiasts", description: "People growing wealth and financial literacy." },
  { key: "coaches", label: "Coaches, consultants & trainers", description: "Experts packaging their method for clients." },
  { key: "creators", label: "Creators & freelancers", description: "Independent creators monetising their knowledge." },
  { key: "children", label: "Children (ages 6–12)", description: "Young readers who need simple language and playful design." },
  { key: "community", label: "Non-profit & community leaders", description: "Change-makers educating a community." },
];

export type ThemePresetKey =
  | "premium"
  | "modern"
  | "workbook"
  | "playful"
  | "warm"
  | "academic"
  | "cinematic"
  | "minimal";

export interface PurposeOption {
  key: string;
  label: string;
  description: string;
  theme: ThemePresetKey;
}

export const PURPOSES: PurposeOption[] = [
  { key: "teach", label: "Teach a practical skill", description: "Step-by-step instruction with exercises.", theme: "modern" },
  { key: "lead_generation", label: "Generate leads", description: "A valuable lead magnet that ends with a next step.", theme: "premium" },
  { key: "sell", label: "Sell a product or service", description: "Persuasive, proof-led content that supports an offer.", theme: "premium" },
  { key: "personal_brand", label: "Build a personal brand", description: "Thoughtful point of view that positions you as the expert.", theme: "cinematic" },
  { key: "corporate_training", label: "Corporate training", description: "Structured learning for teams and staff.", theme: "academic" },
  { key: "onboarding", label: "Client or employee onboarding", description: "Clear orientation, expectations and first steps.", theme: "modern" },
  { key: "workbook", label: "Interactive workbook", description: "Prompts, checklists and space to apply the ideas.", theme: "workbook" },
  { key: "course_companion", label: "Course companion", description: "A study guide that reinforces a course or programme.", theme: "academic" },
  { key: "thought_leadership", label: "Thought leadership", description: "A credible, well-argued perspective for your field.", theme: "minimal" },
  { key: "inspire", label: "Inspire & motivate", description: "Stories and ideas that move the reader to act.", theme: "warm" },
  { key: "reference", label: "Reference guide", description: "Fast, well-organised answers the reader can revisit.", theme: "minimal" },
  { key: "children_story", label: "Children's story", description: "Simple scenes, repetition and gentle lessons.", theme: "playful" },
  { key: "devotional", label: "Devotional guide", description: "Reflective readings with prompts for practice.", theme: "warm" },
  { key: "memoir", label: "Memoir or personal story", description: "A personal narrative with a universal lesson.", theme: "cinematic" },
  { key: "marketing", label: "Marketing lead magnet", description: "Short, high-value content designed to be shared.", theme: "premium" },
];

export const LANGUAGES = [
  "English",
  "French",
  "Spanish",
  "Portuguese",
  "Arabic",
  "Swahili",
  "Hausa",
  "Yoruba",
  "Igbo",
  "Amharic",
  "Chinese (Simplified)",
  "Hindi",
  "German",
];

export interface LengthOption {
  key: BookLength;
  label: string;
  range: string;
  words: [number, number];
  chapters: [number, number];
  chapterTarget: number;
  credits: number;
  description: string;
}

export const LENGTHS: Record<BookLength, LengthOption> = {
  short: {
    key: "short",
    label: "Short",
    range: "1,500–3,000 words",
    words: [1500, 3000],
    chapters: [3, 5],
    chapterTarget: 4,
    credits: 2,
    description: "A focused guide or lead magnet. Fast to read and share.",
  },
  medium: {
    key: "medium",
    label: "Medium",
    range: "4,000–7,000 words",
    words: [4000, 7000],
    chapters: [6, 10],
    chapterTarget: 8,
    credits: 4,
    description: "A complete short book with room for examples and exercises.",
  },
  long: {
    key: "long",
    label: "Long",
    range: "8,000–12,000 words",
    words: [8000, 12000],
    chapters: [10, 15],
    chapterTarget: 12,
    credits: 6,
    description: "A substantial book for a course, client or authority position.",
  },
};

export const LENGTH_OPTIONS: LengthOption[] = [LENGTHS.short, LENGTHS.medium, LENGTHS.long];

export const CREDIT_COSTS = {
  initial: (length: BookLength) => LENGTHS[length].credits,
  fullRegeneration: (length: BookLength) => LENGTHS[length].credits,
  chapterRegeneration: 1,
  visualRegeneration: 1,
  coverGeneration: 1,
  audiobook: 3,
  outline: 0,
  manualEdit: 0,
  pdfExport: 0,
} as const;

export const THEME_PRESETS: Record<ThemePresetKey, BookTheme> = {
  premium: {
    preset: "premium",
    name: "Premium authority",
    palette: {
      background: "#ffffff",
      surface: "#f6f3fb",
      primary: "#3b1d6e",
      accent: "#b58b2a",
      text: "#1f1730",
      muted: "#6f6580",
    },
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
  modern: {
    preset: "modern",
    name: "Modern clarity",
    palette: {
      background: "#ffffff",
      surface: "#eef7f4",
      primary: "#0f5f56",
      accent: "#e07a3f",
      text: "#14211f",
      muted: "#5f7370",
    },
    headingFont: "'Trebuchet MS', 'DM Sans', sans-serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
  workbook: {
    preset: "workbook",
    name: "Workbook energy",
    palette: {
      background: "#fffdf7",
      surface: "#fff2d9",
      primary: "#1d4ed8",
      accent: "#f59e0b",
      text: "#1f2937",
      muted: "#6b7280",
    },
    headingFont: "'Trebuchet MS', 'DM Sans', sans-serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
  playful: {
    preset: "playful",
    name: "Playful learning",
    palette: {
      background: "#fffaf0",
      surface: "#ffe7ef",
      primary: "#c026d3",
      accent: "#f59e0b",
      text: "#3b0764",
      muted: "#7e5b86",
    },
    headingFont: "'Comic Sans MS', 'Trebuchet MS', sans-serif",
    bodyFont: "'Trebuchet MS', 'DM Sans', sans-serif",
  },
  warm: {
    preset: "warm",
    name: "Warm & reflective",
    palette: {
      background: "#fffaf5",
      surface: "#f7e8d8",
      primary: "#8a4b2a",
      accent: "#d97706",
      text: "#2f2118",
      muted: "#7a675a",
    },
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "Georgia, 'Times New Roman', serif",
  },
  academic: {
    preset: "academic",
    name: "Academic reference",
    palette: {
      background: "#ffffff",
      surface: "#eef2f8",
      primary: "#1e3a8a",
      accent: "#0e7490",
      text: "#111827",
      muted: "#5b6779",
    },
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
  cinematic: {
    preset: "cinematic",
    name: "Cinematic story",
    palette: {
      background: "#101014",
      surface: "#1c1c24",
      primary: "#e9c46a",
      accent: "#ef6f6c",
      text: "#f7f4ef",
      muted: "#b9b2a7",
    },
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
  minimal: {
    preset: "minimal",
    name: "Quiet minimal",
    palette: {
      background: "#ffffff",
      surface: "#f4f4f5",
      primary: "#18181b",
      accent: "#0f766e",
      text: "#18181b",
      muted: "#6b7280",
    },
    headingFont: "'DM Sans', system-ui, sans-serif",
    bodyFont: "'DM Sans', system-ui, sans-serif",
  },
};

export const THEME_KEYS = Object.keys(THEME_PRESETS) as ThemePresetKey[];

export function emptyOutline(): BookOutline {
  return { chapters: [] };
}

export function createBlankBook(overrides: Partial<BookmakerBook> = {}): BookmakerBook {
  const now = new Date().toISOString();
  return {
    id: "",
    user_id: "",
    title: "",
    subtitle: null,
    idea: "",
    idea_input_mode: "text",
    audience: "general",
    custom_audience: null,
    purpose: "teach",
    custom_purpose: null,
    language: "English",
    custom_language: null,
    length: "medium",
    status: "draft",
    outline: emptyOutline(),
    chapters: [],
    cover: { kind: "none" },
    theme: null,
    design: {},
    audiobook: null,
    metadata: {},
    credits_spent: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function audienceLabel(book: Pick<BookmakerBook, "audience" | "custom_audience">): string {
  return book.custom_audience?.trim() || AUDIENCES.find((a) => a.key === book.audience)?.label || "General readers";
}

export function purposeLabel(book: Pick<BookmakerBook, "purpose" | "custom_purpose">): string {
  return book.custom_purpose?.trim() || PURPOSES.find((p) => p.key === book.purpose)?.label || "Teach a practical skill";
}

export function purposePreset(purpose: string): ThemePresetKey {
  return PURPOSES.find((p) => p.key === purpose)?.theme ?? "modern";
}

export function resolveTheme(book: Pick<BookmakerBook, "theme" | "purpose">): BookTheme {
  const stored = book.theme;
  if (stored?.palette && stored?.headingFont && stored?.bodyFont) {
    return {
      ...(THEME_PRESETS[(stored.preset as ThemePresetKey) ?? "modern"] ?? THEME_PRESETS.modern),
      ...stored,
      palette: { ...(THEME_PRESETS[(stored.preset as ThemePresetKey) ?? "modern"] ?? THEME_PRESETS.modern).palette, ...stored.palette },
    };
  }
  return THEME_PRESETS[purposePreset(book.purpose)];
}

export function themeStyle(theme: BookTheme): CSSProperties {
  return {
    ["--book-bg" as string]: theme.palette.background,
    ["--book-surface" as string]: theme.palette.surface,
    ["--book-primary" as string]: theme.palette.primary,
    ["--book-accent" as string]: theme.palette.accent,
    ["--book-text" as string]: theme.palette.text,
    ["--book-muted" as string]: theme.palette.muted,
    ["--book-heading-font" as string]: theme.headingFont,
    ["--book-body-font" as string]: theme.bodyFont,
  } as CSSProperties;
}

export function themeCssVariables(theme: BookTheme): string {
  return [
    `--book-bg:${theme.palette.background}`,
    `--book-surface:${theme.palette.surface}`,
    `--book-primary:${theme.palette.primary}`,
    `--book-accent:${theme.palette.accent}`,
    `--book-text:${theme.palette.text}`,
    `--book-muted:${theme.palette.muted}`,
    `--book-heading-font:${theme.headingFont}`,
    `--book-body-font:${theme.bodyFont}`,
  ].join(";");
}

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text
    .replace(/^:::.*$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|~[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

export function bookWordCount(book: Pick<BookmakerBook, "chapters">): number {
  return (book.chapters ?? []).reduce((total, chapter) => total + wordCount(chapter.content), 0);
}

export function outlineChapterCount(book: Pick<BookmakerBook, "outline" | "length">): number {
  const count = book.outline?.chapters?.length ?? 0;
  return count > 0 ? count : LENGTHS[book.length]?.chapterTarget ?? 8;
}

export function lengthLabel(length: BookLength): string {
  return LENGTHS[length]?.label ?? "Medium";
}

export function creditCostForLength(length: BookLength): number {
  return LENGTHS[length]?.credits ?? 4;
}

export function makeIdempotencyKey(action: string, bookId?: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${action}:${bookId ?? "new"}:${random}`;
}

export function validateIdea(idea: string): string | null {
  const trimmed = idea.trim();
  if (!trimmed) return "Tell us what your ebook is about.";
  if (trimmed.length < 20) return "Add a little more detail — at least 20 characters.";
  if (trimmed.length > 4000) return "Keep the idea under 4,000 characters.";
  return null;
}

export function validateConfiguration(input: {
  audience: string;
  purpose: string;
  language: string;
  customAudience?: string | null;
  customPurpose?: string | null;
  customLanguage?: string | null;
}): string | null {
  if (input.audience === "custom" && !input.customAudience?.trim()) return "Describe your custom audience.";
  if (input.purpose === "custom" && !input.customPurpose?.trim()) return "Describe your custom purpose.";
  if (!input.language?.trim() && !input.customLanguage?.trim()) return "Choose a language.";
  return null;
}

export const STATUS_LABELS: Record<BookStatus, string> = {
  draft: "Draft",
  configured: "Configured",
  outline_ready: "Outline ready",
  generating: "Writing",
  manuscript_ready: "Manuscript ready",
  designed: "Designed",
  completed: "Completed",
  failed: "Needs attention",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as BookStatus] ?? "Draft";
}

export function formatBookDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

/** "9m 42s" style duration for audiobook chapters and totals. */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  return `${secs}s`;
}

/** Relative luminance of a 6-digit hex colour (WCAG formula). */
export function hexLuminance(hex: string): number {
  const value = String(hex ?? "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
  const channel = (part: string) => {
    const srgb = parseInt(part, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6));
}

export function contrastRatio(a: string, b: string): number {
  const first = hexLuminance(a);
  const second = hexLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Keeps the AI's preferred text colour when it is readable, otherwise switches
 * to white or near-black. Generated covers should never ship with unreadable
 * type just because the model picked a low-contrast palette.
 */
export function readableTextColor(background: string, preferred?: string): string {
  if (preferred && contrastRatio(preferred, background) >= 4.5) return preferred;
  return contrastRatio("#ffffff", background) >= contrastRatio("#111111", background) ? "#ffffff" : "#111111";
}

export function ensureCoverContrast(palette: CoverPalette): CoverPalette {
  if (!/^#[0-9a-f]{6}$/i.test(palette.background)) return palette;
  return { ...palette, text: readableTextColor(palette.background, palette.text) };
}

export function coverPalette(book: Pick<BookmakerBook, "cover" | "theme" | "purpose">): CoverPalette {
  const theme = resolveTheme(book);
  const palette =
    book.cover?.design?.palette ?? {
      background: theme.palette.primary,
      primary: theme.palette.background,
      accent: theme.palette.accent,
      text: theme.palette.background,
    };
  return ensureCoverContrast(palette);
}

/** URL that safely returns the member to the book after buying credits. */
export function purchaseUrl(bookId: string | null, kind: "packs" | "subscribe" = "packs"): string {
  const base = kind === "subscribe" ? "/subscribe" : "/pricing";
  const params = new URLSearchParams({ from: "bookmaker" });
  if (bookId) params.set("book", bookId);
  return `${base}?${params.toString()}`;
}

export function checkoutReturnUrl(bookId: string | null): string {
  return bookId ? `/bookmaker/create?book=${encodeURIComponent(bookId)}` : "/bookmaker/create";
}
