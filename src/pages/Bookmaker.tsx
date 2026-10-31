import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Coins,
  Download,
  Edit3,
  FileText,
  Globe2,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  Palette,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookPreview } from "@/components/bookmaker/BookPreview";
import { CoverPreview } from "@/components/bookmaker/CoverPreview";
import { AudiobookPlayer } from "@/components/bookmaker/AudiobookPlayer";
import { CreditGateDialog } from "@/components/bookmaker/BookmakerDialogs";
import { BookmakerPurchaseDialog } from "@/components/bookmaker/BookmakerPurchaseDialog";
import {
  AUDIENCES,
  DEFAULT_ENTITLEMENT,
  LANGUAGES,
  LENGTHS,
  LENGTH_OPTIONS,
  PURPOSES,
  STATUS_LABELS,
  THEME_KEYS,
  THEME_PRESETS,
  type BookLength,
  type BookmakerBook,
  type BookmakerEntitlement,
  type BookOutline,
  type ChapterStatus,
  type ThemePresetKey,
  audienceLabel,
  audiobookCostForLength,
  audiobookLanguageFor,
  audiobookVoicesFor,
  defaultAudiobookVoice,
  bookWordCount,
  creditCostForLength,
  emptyOutline,
  formatBookDate,
  lengthLabel,
  makeIdempotencyKey,
  purposeLabel,
  resolveTheme,
  validateConfiguration,
  validateIdea,
  wordCount,
} from "@/lib/bookmaker";
import {
  consumeBookDownload,
  deleteBookmakerBook,
  fetchBookmakerBook,
  getBookmakerEntitlement,
  invokeBookmaker,
  previewNarratorVoice,
  rememberBook,
  resolveBookCoverUrl,
  saveBookmakerBook,
  uploadBookCover,
} from "@/lib/bookmakerApi";
import { downloadBookPDF, openBookPrintPreview } from "@/lib/bookExport";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bookmaker:draft";

/** Uploaded covers must match the A5 page: 148 × 210 mm at 300 dpi. */
const COVER_ASPECT = 148 / 210;
const COVER_MIN_WIDTH = 1200;
const COVER_MIN_HEIGHT = 1700;

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

interface IdeaDraft {
  idea: string;
  ideaInputMode: "text" | "voice";
  audience: string;
  customAudience: string;
  purpose: string;
  customPurpose: string;
  language: string;
  customLanguage: string;
  length: BookLength;
}

/** Minimal Web Speech API surface used by the idea step. */
interface SpeechRecognitionResultLike {
  [index: number]: { transcript?: string } | undefined;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const readDraft = (): IdeaDraft => {
  const fallback: IdeaDraft = {
    idea: "",
    ideaInputMode: "text",
    audience: "general",
    customAudience: "",
    purpose: "teach",
    customPurpose: "",
    language: "English",
    customLanguage: "",
    length: "medium",
  };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<IdeaDraft>;
    return {
      ...fallback,
      ...parsed,
      length: parsed.length && LENGTHS[parsed.length] ? parsed.length : "medium",
      ideaInputMode: parsed.ideaInputMode === "voice" ? "voice" : "text",
    };
  } catch {
    return fallback;
  }
};

type GateState =
  | { kind: "start"; cost: number }
  | { kind: "full"; cost: number }
  | { kind: "chapter"; cost: number; index: number; instruction: string }
  | { kind: "visual"; cost: number; index: number; blockIndex: number; instruction: string }
  | { kind: "cover"; cost: number; style: string }
  | { kind: "audiobook"; cost: number; voice: string };

const STEPS = [
  { title: "Idea", caption: "What is the book about?" },
  { title: "Reader & length", caption: "Who is it for?" },
  { title: "Outline", caption: "Review the structure" },
  { title: "Manuscript", caption: "Write and edit" },
  { title: "Design & export", caption: "Cover and PDF" },
];

const COVER_STYLES = [
  { key: "auto", label: "Art director's choice" },
  { key: "bold-editorial", label: "Bold editorial" },
  { key: "warm-modern", label: "Warm modern" },
  { key: "premium-minimal", label: "Premium minimal" },
  { key: "playful", label: "Playful" },
  { key: "academic", label: "Academic" },
  { key: "cinematic", label: "Cinematic" },
];

const Bookmaker = () => {
  const { user, profile, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryBookId = searchParams.get("book");

  const [initialDraft] = useState<IdeaDraft>(readDraft);
  const [step, setStep] = useState(0);
  const [book, setBook] = useState<BookmakerBook | null>(null);
  const [loadingBook, setLoadingBook] = useState(Boolean(queryBookId));
  const [entitlement, setEntitlement] = useState<BookmakerEntitlement>(DEFAULT_ENTITLEMENT);
  const [refreshingCredits, setRefreshingCredits] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseView, setPurchaseView] = useState<"packs" | "subscribe" | null>(null);

  const openPurchase = (view: "packs" | "subscribe" | null = null) => {
    setPurchaseView(view);
    setPurchaseOpen(true);
  };

  const [idea, setIdea] = useState(initialDraft.idea);
  const [ideaInputMode, setIdeaInputMode] = useState<"text" | "voice">(initialDraft.ideaInputMode);
  const [audience, setAudience] = useState(initialDraft.audience);
  const [customAudience, setCustomAudience] = useState(initialDraft.customAudience);
  const [purpose, setPurpose] = useState(initialDraft.purpose);
  const [customPurpose, setCustomPurpose] = useState(initialDraft.customPurpose);
  const [language, setLanguage] = useState(initialDraft.language);
  const [customLanguage, setCustomLanguage] = useState(initialDraft.customLanguage);
  const [length, setLength] = useState<BookLength>(initialDraft.length);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [outline, setOutline] = useState<BookOutline>(emptyOutline());
  const [abstract, setAbstract] = useState("");
  const [author, setAuthor] = useState("");

  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [savingOutline, setSavingOutline] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writingChapter, setWritingChapter] = useState<number | null>(null);
  const [writingDone, setWritingDone] = useState(0);
  const [writingTotal, setWritingTotal] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState(false);
  const [resumeChecking, setResumeChecking] = useState(false);

  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [gate, setGate] = useState<GateState | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverStyle, setCoverStyle] = useState("auto");

  const [exportPreset, setExportPreset] = useState<"stage1" | "stage2" | "full" | "custom">("full");
  const [exportCover, setExportCover] = useState(true);
  const [exportAbstract, setExportAbstract] = useState(true);
  const [exportOutline, setExportOutline] = useState(false);
  const [exportChapters, setExportChapters] = useState<number[] | "all">("all");

  const [audioVoice, setAudioVoice] = useState<string>(() => defaultAudiobookVoice(initialDraft.language));
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioChapter, setAudioChapter] = useState<number | null>(null);
  const [audioProgress, setAudioProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioStopping, setAudioStopping] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef("");
  const cancelRef = useRef(false);
  const audioCancelRef = useRef(false);
  const autoResumeAudioRef = useRef(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const loadedBookIdRef = useRef<string | null>(null);

  const selectedLength = LENGTHS[length];
  const startCost = creditCostForLength(length);
  // The outline/manuscript always belongs to the length saved on the book.
  // `length` can differ while the member is choosing a new package before
  // regenerating the outline, so paid actions must use the saved value.
  const activeLength: BookLength = book?.length ?? length;
  const activeLengthOption = LENGTHS[activeLength];
  const activeCost = creditCostForLength(activeLength);
  const chapters = useMemo(() => book?.chapters ?? [], [book]);
  const hasChapters = chapters.length > 0;
  const approvedChapters = useMemo(
    () => chapters.filter((chapter) => chapter.status === "approved").map((chapter) => chapter.number - 1),
    [chapters],
  );
  const outlineChapterCount = outline.chapters.length;
  const missingChapterCount = Math.max(outlineChapterCount - chapters.length, 0);
  const highestWrittenNumber = useMemo(
    () => chapters.reduce((highest, chapter) => Math.max(highest, Number(chapter.number) || 0), 0),
    [chapters],
  );
  // Only block a full rewrite when every outline chapter exists and is approved.
  // If approved chapters are missing from a longer outline, the remaining
  // chapters must still be writable.
  const allOutlineChaptersApproved =
    outlineChapterCount > 0 && missingChapterCount === 0 && approvedChapters.length === chapters.length;
  const furthestStep = book
    ? hasChapters
      ? 4
      : book.status === "generating"
        ? 3
        : outline.chapters.length > 0
          ? 2
          : 1
    : 0;
  const canVisit = (index: number) => index <= Math.max(furthestStep, step);
  // The author printed on the book is chosen by the member, never inferred
  // from the platform account.
  const authorName = author.trim() || undefined;

  const exportableChapters = useMemo(
    () =>
      chapters
        .filter((chapter) => chapter.content)
        .map((chapter, index) => ({ number: Number(chapter.number) || index + 1, title: chapter.title })),
    [chapters],
  );
  const exportChapterNumbers =
    exportChapters === "all" ? exportableChapters.map((chapter) => chapter.number) : exportChapters;
  const exportChapterCount = exportChapterNumbers.length;
  const canExport = Boolean(book) && (exportCover || exportOutline || exportAbstract || exportChapterCount > 0);
  const downloadLimit = Math.max(0, Number(entitlement.download_limit ?? 0));
  const freeDownloadsLeft = Math.max(downloadLimit - (book?.download_count ?? 0), 0);
  const downloadCost = Math.max(1, Number(entitlement.download_cost ?? 1));

  const applyExportPreset = (preset: "stage1" | "stage2" | "full") => {
    setExportPreset(preset);
    if (preset === "stage1") {
      setExportCover(true);
      setExportAbstract(true);
      setExportOutline(true);
      setExportChapters([]);
      return;
    }
    if (preset === "stage2") {
      setExportCover(true);
      setExportAbstract(true);
      setExportOutline(true);
      setExportChapters(exportableChapters.some((chapter) => chapter.number === 1) ? [1] : []);
      return;
    }
    setExportCover(true);
    setExportAbstract(true);
    setExportOutline(false);
    setExportChapters("all");
  };

  const toggleExportChapter = (number: number) => {
    setExportPreset("custom");
    setExportChapters((current) => {
      const active = current === "all" ? exportableChapters.map((chapter) => chapter.number) : current;
      return active.includes(number)
        ? active.filter((item) => item !== number)
        : [...active, number].sort((a, b) => a - b);
    });
  };

  const audioLanguage = audiobookLanguageFor(book?.language ?? language);
  const audioVoices = audiobookVoicesFor(book?.language ?? language);
  const activeAudioVoice = audioVoices.some((voice) => voice.key === audioVoice)
    ? audioVoice
    : defaultAudiobookVoice(book?.language ?? language);
  const audioCost = audiobookCostForLength(activeLength);
  const audioChapters = book?.audiobook?.chapters ?? [];
  const hasAudio = audioChapters.length > 0;

  const refreshEntitlement = useCallback(async () => {
    if (!user) {
      setEntitlement(DEFAULT_ENTITLEMENT);
      return;
    }
    setRefreshingCredits(true);
    try {
      setEntitlement(await getBookmakerEntitlement());
    } finally {
      setRefreshingCredits(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshEntitlement();
  }, [refreshEntitlement]);

  const applyLoadedBook = useCallback((next: BookmakerBook) => {
    setBook(next);
    setTitle(next.title || "");
    setSubtitle(next.subtitle || "");
    setOutline(next.outline?.chapters?.length ? next.outline : emptyOutline());
    setAbstract(next.outline?.abstract ?? "");
    setAuthor(next.outline?.author ?? "");
    setIdea(next.idea || "");
    setIdeaInputMode(next.idea_input_mode === "voice" ? "voice" : "text");
    setAudience(next.audience || "general");
    setCustomAudience(next.custom_audience || "");
    setPurpose(next.purpose || "teach");
    setCustomPurpose(next.custom_purpose || "");
    setLanguage(next.language || "English");
    setCustomLanguage(next.custom_language || "");
    setLength(next.length || "medium");
    setCoverStyle(next.cover?.design?.style || "auto");
    setAudioVoice(next.audiobook?.voice || defaultAudiobookVoice(next.language));
    if (next.audiobook?.status === "generating" && next.audiobook?.operationId) {
      autoResumeAudioRef.current = true;
    }
    const nextHasChapters = (next.chapters?.length ?? 0) > 0;
    const nextHasOutline = (next.outline?.chapters?.length ?? 0) > 0;
    setStep(
      next.audiobook?.status === "generating"
        ? 4
        : nextHasChapters
          ? 3
          : nextHasOutline
            ? 2
            : next.status === "generating"
              ? 3
              : 1,
    );
    setPendingResume(next.status === "generating");
    rememberBook(next.id);
  }, []);

  // Load a book from the URL. A book is only opened explicitly (from My Books,
  // or after buying credits), so "Create" always starts a clean draft.
  useEffect(() => {
    if (authLoading) return;
    if (!user || !queryBookId) {
      setLoadingBook(false);
      return;
    }
    if (loadedBookIdRef.current === queryBookId) {
      setLoadingBook(false);
      return;
    }
    let cancelled = false;
    setLoadingBook(true);
    (async () => {
      try {
        const loaded = await fetchBookmakerBook(queryBookId);
        if (cancelled) return;
        if (!loaded) {
          toast({
            title: "Book not found",
            description: "That book may have been removed, or it belongs to another account.",
            variant: "destructive",
          });
          setSearchParams({}, { replace: true });
          return;
        }
        applyLoadedBook(loaded);
        loadedBookIdRef.current = loaded.id;
        if (loaded.status === "generating") setPendingResume(true);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: "Could not open the book",
            description: err instanceof Error ? err.message : "Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoadingBook(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, queryBookId, applyLoadedBook, setSearchParams, toast]);

  // Keep a local draft until a real book exists. This is what survives the
  // detour to login or to buy credits.
  useEffect(() => {
    if (book || authLoading) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            idea,
            ideaInputMode,
            audience,
            customAudience,
            purpose,
            customPurpose,
            language,
            customLanguage,
            length,
          } satisfies IdeaDraft),
        );
      } catch {
        // localStorage can be unavailable in private/sandboxed contexts
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    book,
    authLoading,
    idea,
    ideaInputMode,
    audience,
    customAudience,
    purpose,
    customPurpose,
    language,
    customLanguage,
    length,
  ]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore browsers that throw when recognition already ended
      }
    };
  }, []);

  const scrollToEditor = () => {
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const redirectToLogin = () => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          idea,
          ideaInputMode,
          audience,
          customAudience,
          purpose,
          customPurpose,
          language,
          customLanguage,
          length,
        } satisfies IdeaDraft),
      );
    } catch {
      // ignore
    }
    const target = book ? `/bookmaker/create?book=${book.id}` : "/bookmaker/create";
    navigate(`/auth?mode=login&redirect=${encodeURIComponent(target)}`);
  };

  const handleStartVoice = () => {
    if (listening) {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      toast({
        title: "Voice notes are not supported here",
        description: "Try Chrome or Edge on Android or desktop, or type your idea instead.",
        variant: "destructive",
      });
      return;
    }
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-NG";
      recognition.continuous = true;
      recognition.interimResults = true;
      voiceBaseRef.current = idea.trim();
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i += 1) {
          transcript += `${event.results[i]?.[0]?.transcript ?? ""} `;
        }
        const next = [voiceBaseRef.current, transcript.trim()].filter(Boolean).join(" ");
        setIdea(next.slice(0, 4000));
        setIdeaInputMode("voice");
      };
      recognition.onerror = (event) => {
        const message =
          event?.error === "not-allowed"
            ? "Microphone access was blocked. Allow it in your browser, then try again."
            : "Voice capture stopped. You can type your idea instead.";
        toast({ title: "Voice input", description: message, variant: "destructive" });
        setListening(false);
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      toast({
        title: "Could not start voice input",
        description: "Please type your idea instead.",
        variant: "destructive",
      });
    }
  };

  const handleGenerateOutline = async () => {
    const ideaError = validateIdea(idea);
    if (ideaError) {
      toast({ title: "One more detail", description: ideaError, variant: "destructive" });
      return;
    }
    const configError = validateConfiguration({
      audience,
      purpose,
      language,
      customAudience,
      customPurpose,
      customLanguage,
    });
    if (configError) {
      toast({ title: "Finish the setup", description: configError, variant: "destructive" });
      return;
    }
    if (!user) {
      redirectToLogin();
      return;
    }

    setGeneratingOutline(true);
    try {
      const response = await invokeBookmaker({
        action: "outline",
        bookId: book?.id,
        idempotencyKey: makeIdempotencyKey("outline", book?.id),
        idea,
        ideaInputMode,
        audience,
        customAudience,
        purpose,
        customPurpose,
        language,
        customLanguage,
        length,
      });

      if (!response.success) {
        if (response.reason === "unauthenticated") {
          redirectToLogin();
          return;
        }
        if (response.reason === "insufficient_credits") {
          await refreshEntitlement();
        }
        toast({
          title: "Outline not generated",
          description: String(response.message || "Please try again."),
          variant: "destructive",
        });
        return;
      }

      const nextBook = response.book as BookmakerBook;
      if (!nextBook) {
        toast({ title: "Outline not saved", description: "Please try again.", variant: "destructive" });
        return;
      }
      setBook(nextBook);
      loadedBookIdRef.current = nextBook.id;
      setTitle(nextBook.title || "");
      setSubtitle(nextBook.subtitle || "");
      setOutline(nextBook.outline ?? emptyOutline());
      setAbstract(nextBook.outline?.abstract ?? "");
      setAuthor((current) => current || nextBook.outline?.author || "");
      setLength(nextBook.length || length);
      setStep(2);
      setPendingResume(false);
      rememberBook(nextBook.id);
      setSearchParams({ book: nextBook.id }, { replace: true });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
      toast({
        title: "Your outline is ready",
        description: "Edit the title and chapters, then write the manuscript when you are happy with the structure.",
      });
    } catch (err) {
      toast({
        title: "Outline not generated",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingOutline(false);
    }
  };

  const persistOutline = async (): Promise<BookmakerBook | null> => {
    if (!book) return null;
    setSavingOutline(true);
    try {
      const nextChapters = outline.chapters.map((chapter, index) => ({ ...chapter, number: index + 1 }));
      if (highestWrittenNumber > nextChapters.length) {
        throw new Error(
          "This outline is shorter than your written manuscript. Restore the missing outline chapters before saving.",
        );
      }
      const saved = await saveBookmakerBook(book.id, {
        title: title.trim() || book.title || "Untitled book",
        subtitle: subtitle.trim() || null,
        outline: { chapters: nextChapters, abstract: abstract.trim(), author: author.trim() },
      });
      setBook(saved);
      setOutline(
        saved.outline?.chapters?.length
          ? saved.outline
          : { chapters: nextChapters, abstract: abstract.trim(), author: author.trim() },
      );
      return saved;
    } finally {
      setSavingOutline(false);
    }
  };

  const handleSaveOutline = async () => {
    if (!book) return;
    try {
      await persistOutline();
      toast({ title: "Outline saved", description: "Your title and chapter structure are up to date." });
    } catch (err) {
      toast({
        title: "Could not save the outline",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const updateOutlineChapter = (index: number, patch: Partial<BookOutline["chapters"][number]>) => {
    setOutline((previous) => ({
      ...previous,
      chapters: previous.chapters.map((chapter, chapterIndex) =>
        chapterIndex === index ? { ...chapter, ...patch } : chapter,
      ),
    }));
  };

  const addOutlineChapter = () => {
    setOutline((previous) => {
      if (previous.chapters.length >= activeLengthOption.chapters[1]) return previous;
      return {
        ...previous,
        chapters: [
          ...previous.chapters,
          {
            number: previous.chapters.length + 1,
            title: `Chapter ${previous.chapters.length + 1}`,
            summary: "",
            sections: [],
            visuals: [],
          },
        ],
      };
    });
  };

  const removeOutlineChapter = (index: number) => {
    setOutline((previous) => {
      if (previous.chapters.length <= activeLengthOption.chapters[0]) return previous;
      return {
        ...previous,
        chapters: previous.chapters
          .filter((_, chapterIndex) => chapterIndex !== index)
          .map((chapter, chapterIndex) => ({ ...chapter, number: chapterIndex + 1 })),
      };
    });
  };

  const updateChapterList = (nextChapters: BookmakerBook["chapters"]) =>
    nextChapters.map((chapter, index) => ({ ...chapter, number: index + 1 }));

  const handleSaveChapter = async () => {
    if (!book || editingChapter === null) return;
    setSavingEdit(true);
    try {
      const updated = book.chapters.map((chapter) =>
        chapter.number === editingChapter + 1
          ? { ...chapter, content: editContent, updatedAt: new Date().toISOString() }
          : chapter,
      );
      const saved = await saveBookmakerBook(book.id, { chapters: updateChapterList(updated) });
      setBook(saved);
      setEditingChapter(null);
      toast({ title: "Chapter saved", description: "Manual edits never use credits." });
    } catch (err) {
      toast({
        title: "Could not save the chapter",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleApproved = async (index: number) => {
    if (!book || writing) return;
    try {
      const updated = book.chapters.map((chapter, chapterIndex) =>
        chapterIndex === index
          ? {
              ...chapter,
              status: (chapter.status === "approved" ? "generated" : "approved") as ChapterStatus,
            }
          : chapter,
      );
      const saved = await saveBookmakerBook(book.id, { chapters: updateChapterList(updated) });
      setBook(saved);
    } catch (err) {
      toast({
        title: "Could not update the chapter",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const abandonReservation = async (bookId: string, operationId: string, reason: string) => {
    try {
      const response = await invokeBookmaker({
        action: "abandon",
        bookId,
        operationId,
        reason,
      });
      if (response.book) setBook(response.book as BookmakerBook);
      if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
      setPendingResume(false);
      toast({
        title: "Generation stopped",
        description: String(
          response.message ||
            (response.refunded
              ? `${response.refunded} unused credit${Number(response.refunded) === 1 ? "" : "s"} refunded.`
              : "Your written chapters are saved."),
        ),
      });
    } catch (err) {
      toast({
        title: "Could not stop the generation",
        description: err instanceof Error ? err.message : "Your book is still saved.",
        variant: "destructive",
      });
    } finally {
      setWriting(false);
      setWritingChapter(null);
      setStopping(false);
      cancelRef.current = false;
    }
  };

  const runChapters = async (bookId: string, operationId: string, pending: number[]) => {
    let failed = false;
    for (const index of pending) {
      if (cancelRef.current) break;
      setWritingChapter(index);
      try {
        const response = await invokeBookmaker({
          action: "chapter",
          bookId,
          operationId,
          chapterIndex: index,
        });
        if (!response.success) {
          setWriteError(String(response.message || "That chapter could not be written. You can retry it."));
          failed = true;
          break;
        }
        if (response.book) setBook(response.book as BookmakerBook);
        setWritingDone((done) => done + 1);
      } catch (err) {
        setWriteError(
          err instanceof Error
            ? `${err.message} Your credits are still reserved, so you can retry this chapter.`
            : "That chapter could not be written. You can retry it.",
        );
        failed = true;
        break;
      }
    }

    setWritingChapter(null);

    if (cancelRef.current) {
      await abandonReservation(bookId, operationId, "Stopped by member");
      return;
    }

    if (failed) {
      setWriting(false);
      setPendingResume(true);
      await refreshEntitlement();
      return;
    }

    try {
      const response = await invokeBookmaker({ action: "complete", bookId, operationId });
      if (!response.success) {
        setWriteError(String(response.message || "The manuscript is written but could not be finalised."));
        setWriting(false);
        setPendingResume(true);
        return;
      }
      if (response.book) setBook(response.book as BookmakerBook);
      if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
      setWriting(false);
      setPendingResume(false);
      setWriteError(null);
      await refreshEntitlement();
      toast({
        title: "Manuscript complete",
        description: "Read through the chapters, approve the ones you want to keep, then design the cover and export your PDF.",
      });
    } catch (err) {
      setWriting(false);
      setPendingResume(true);
      setWriteError(
        err instanceof Error
          ? `${err.message} Your chapters are saved and the reservation is still open, so you can resume.`
          : "The manuscript could not be finalised. You can resume.",
      );
    }
  };

  const beginReservation = async (
    target: BookmakerBook,
    mode: "initial_book" | "full_regeneration",
    locked: number[],
  ) => {
    setWriting(true);
    setWriteError(null);
    setStopping(false);
    setPendingResume(false);
    cancelRef.current = false;
    setWritingDone(0);
    setWritingTotal(0);
    setStep(3);

    try {
      const response = await invokeBookmaker({
        action: "start_manuscript",
        bookId: target.id,
        idempotencyKey: makeIdempotencyKey(mode, target.id),
        operation: mode,
        lockedChapters: locked,
      });

      if (!response.success) {
        setWriting(false);
        if (response.reason === "unauthenticated") {
          redirectToLogin();
          return;
        }
        if (response.reason === "insufficient_credits") {
          await refreshEntitlement();
          toast({
            title: "Not enough credits",
            description: `This ${target.length} book needs ${creditCostForLength(target.length)} credits. Buy credits or subscribe, then return to this book — nothing has been lost.`,
            variant: "destructive",
          });
          return;
        }
        if (response.reason === "plan_limit") {
          await refreshEntitlement();
          toast({
            title: "Plan limit reached",
            description: String(response.message || planLimitMessage),
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Could not start writing",
          description: String(response.message || "Please try again."),
          variant: "destructive",
        });
        return;
      }

      if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
      const operationId = String(response.operationId || "");
      const pending = Array.isArray(response.pendingChapters)
        ? (response.pendingChapters as number[])
        : [];
      setWritingTotal(pending.length);
      if (!operationId) {
        setWriting(false);
        toast({
          title: "Could not start writing",
          description: "The generation did not return an operation. Please try again.",
          variant: "destructive",
        });
        return;
      }
      await runChapters(target.id, operationId, pending);
    } catch (err) {
      setWriting(false);
      setWriteError(
        err instanceof Error
          ? `${err.message} If a reservation was created, use "Resume writing" — nothing is charged twice.`
          : "Could not start writing. Please try again.",
      );
      setPendingResume(true);
    }
  };

  const runAudiobookChapters = useCallback(
    async (bookId: string, operationId: string, pending: number[]) => {
      audioCancelRef.current = false;
      setAudioBusy(true);
      setAudioError(null);
      setAudioChapter(null);
      setAudioProgress((current) => ({ done: current.done, total: pending.length || current.total }));

      try {
        for (const number of pending) {
          if (audioCancelRef.current) return;
          setAudioChapter(number);
          const response = await invokeBookmaker({
            action: "audiobook_chapter",
            bookId,
            operationId,
            chapterNumber: number,
          });
          if (audioCancelRef.current) return;
          if (!response.success) {
            setAudioError(String(response.message || "That chapter could not be narrated. Finished chapters are saved."));
            return;
          }
          if (response.book) setBook(response.book as BookmakerBook);
          const generated = Array.isArray(response.generatedChapters)
            ? (response.generatedChapters as number[])
            : [];
          setAudioProgress({
            done: generated.length,
            total: Number(response.totalChapters) || pending.length,
          });
        }

        const complete = await invokeBookmaker({ action: "complete_audiobook", bookId, operationId });
        if (!complete.success) {
          setAudioError(String(complete.message || "The audiobook could not be finalised. You can resume."));
          return;
        }
        if (complete.book) setBook(complete.book as BookmakerBook);
        if (complete.entitlement) setEntitlement(complete.entitlement as BookmakerEntitlement);
        setAudioError(null);
        toast({
          title: "Audiobook ready",
          description: "Play each chapter, download them separately, or combine the whole book into one file.",
        });
      } catch (err) {
        setAudioError(
          err instanceof Error
            ? `${err.message} Finished chapters are saved, so you can resume.`
            : "Narration stopped unexpectedly. Finished chapters are saved.",
        );
      } finally {
        setAudioBusy(false);
        setAudioChapter(null);
        await refreshEntitlement();
      }
    },
    [refreshEntitlement, toast],
  );

  const startAudiobookPass = async (voice: string) => {
    if (!book) return;
    const response = await invokeBookmaker({
      action: "start_audiobook",
      bookId: book.id,
      voice,
      idempotencyKey: makeIdempotencyKey("audiobook", book.id),
    });
    if (!response.success) {
      if (response.reason === "insufficient_credits" || response.reason === "plan_limit") {
        await refreshEntitlement();
      }
      toast({
        title: "Narration did not start",
        description: String(response.message || "Please try again."),
        variant: "destructive",
      });
      return;
    }
    if (response.book) setBook(response.book as BookmakerBook);
    if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
    setAudioVoice(String(response.voice || voice));
    const pending = Array.isArray(response.pendingChapters) ? (response.pendingChapters as number[]) : [];
    setAudioProgress({ done: 0, total: Number(response.totalChapters) || pending.length });
    setGate(null);
    await runAudiobookChapters(book.id, String(response.operationId), pending);
  };

  const handleStartAudiobook = () => {
    if (!book || audioBusy) return;
    if (!user) {
      redirectToLogin();
      return;
    }
    if (!audioLanguage) {
      toast({
        title: "Narration is not available for this language",
        description: "AI narration currently supports English and Arabic books. You can still export the PDF or read the book aloud in your browser.",
        variant: "destructive",
      });
      return;
    }
    if (!hasChapters) {
      toast({
        title: "Write at least one chapter first",
        description: "Your audiobook is narrated from the manuscript, so finish a chapter before creating audio.",
        variant: "destructive",
      });
      return;
    }
    // Narration is platform-credit only, so the plan's ebook allowance does
    // not apply here.
    setGate({ kind: "audiobook", cost: audioCost, voice: activeAudioVoice });
  };
  const handleResumeAudiobook = useCallback(async () => {
    if (!book || audioBusy) return;
    const operationId = book.audiobook?.operationId;
    if (!operationId) return;
    try {
      const response = await invokeBookmaker({ action: "resume", bookId: book.id });
      if (!response.success) {
        if (response.reason === "no_pending_operation") {
          const refreshed = await fetchBookmakerBook(book.id).catch(() => null);
          if (refreshed) setBook(refreshed);
          return;
        }
        setAudioError(String(response.message || "Narration could not resume."));
        return;
      }
      if (response.operation !== "audiobook") return;
      if (response.voice) setAudioVoice(String(response.voice));
      const pending = Array.isArray(response.pendingChapters) ? (response.pendingChapters as number[]) : [];
      const generated = Array.isArray(response.generatedChapters) ? (response.generatedChapters as number[]) : [];
      setAudioProgress({ done: generated.length, total: Number(response.totalChapters) || pending.length });
      await runAudiobookChapters(book.id, operationId, pending);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : "Narration could not resume.");
    }
  }, [audioBusy, book, runAudiobookChapters]);

  const handlePreviewVoice = async (voiceKey: string) => {
    const element = previewAudioRef.current;
    if (!element) return;
    if (previewingVoice === voiceKey) {
      element.pause();
      setPreviewingVoice(null);
      return;
    }

    element.pause();
    setPreviewingVoice(null);
    setPreviewLoading(voiceKey);
    try {
      const url = previewUrls[voiceKey] ?? (await previewNarratorVoice(voiceKey));
      if (!previewUrls[voiceKey]) {
        setPreviewUrls((current) => ({ ...current, [voiceKey]: url }));
      }
      element.src = url;
      await element.play();
      setPreviewingVoice(voiceKey);
    } catch (err) {
      toast({
        title: "Preview unavailable",
        description: err instanceof Error ? err.message : "The narrator sample could not be prepared.",
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleStopAudiobook = async () => {
    if (!book || audioStopping) return;
    const operationId = book.audiobook?.operationId;
    if (!operationId) return;
    audioCancelRef.current = true;
    setAudioStopping(true);
    try {
      const response = await invokeBookmaker({
        action: "abandon",
        bookId: book.id,
        operationId,
        reason: "Narration stopped by member",
      });
      if (response.book) setBook(response.book as BookmakerBook);
      if (response.success) {
        setAudioError(null);
        toast({
          title: "Narration stopped",
          description: String(response.message || "Narrated chapters are saved and unused credits were refunded."),
        });
      } else {
        setAudioError(String(response.message || "The narration could not be stopped."));
      }
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : "The narration could not be stopped.");
    } finally {
      setAudioStopping(false);
      await refreshEntitlement();
    }
  };

  const handleAssembleAudiobook = async (): Promise<BookmakerBook | null> => {
    if (!book || assembling) return null;
    setAssembling(true);
    try {
      const response = await invokeBookmaker({ action: "assemble_audiobook", bookId: book.id });
      if (!response.success) {
        toast({
          title: "Could not combine the audio",
          description: String(response.message || "Please try again or download the chapters separately."),
          variant: "destructive",
        });
        return null;
      }
      const updated = response.book ? (response.book as BookmakerBook) : null;
      if (updated) setBook(updated);
      toast({
        title: "One file ready",
        description: "Your full audiobook is ready to play or download.",
      });
      return updated;
    } catch (err) {
      toast({
        title: "Could not combine the audio",
        description: err instanceof Error ? err.message : "Please download the chapters separately.",
        variant: "destructive",
      });
      return null;
    } finally {
      setAssembling(false);
    }
  };

  // A narration reservation can survive a refresh or a closed tab. Pick it up
  // once when the book is opened so members never pay twice.
  useEffect(() => {
    if (!book || !autoResumeAudioRef.current) return;
    autoResumeAudioRef.current = false;
    void handleResumeAudiobook();
  }, [book, handleResumeAudiobook]);

  const handleResume = async () => {
    if (!book || resumeChecking) return;
    setResumeChecking(true);
    try {
      const response = await invokeBookmaker({ action: "resume", bookId: book.id });
      if (!response.success) {
        if (response.reason === "no_pending_operation") {
          setPendingResume(false);
          toast({
            title: "No active generation",
            description: "The previous reservation has already been settled. Start writing again — the chapters you have are kept.",
          });
          return;
        }
        toast({
          title: "Could not resume",
          description: String(response.message || "Please try again."),
          variant: "destructive",
        });
        return;
      }

      if (response.operation === "audiobook") {
        const pendingAudio = Array.isArray(response.pendingChapters)
          ? (response.pendingChapters as number[])
          : [];
        const generatedAudio = Array.isArray(response.generatedChapters)
          ? (response.generatedChapters as number[])
          : [];
        setPendingResume(false);
        setStep(4);
        if (response.voice) setAudioVoice(String(response.voice));
        setAudioProgress({
          done: generatedAudio.length,
          total: Number(response.totalChapters) || pendingAudio.length,
        });
        await runAudiobookChapters(book.id, String(response.operationId), pendingAudio);
        return;
      }

      const pending = Array.isArray(response.pendingChapters) ? (response.pendingChapters as number[]) : [];
      setWriting(true);
      setWriteError(null);
      setStopping(false);
      setPendingResume(false);
      cancelRef.current = false;
      setWritingDone(0);
      setWritingTotal(pending.length);
      setStep(3);
      await runChapters(book.id, String(response.operationId), pending);
    } catch (err) {
      toast({
        title: "Could not resume",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setResumeChecking(false);
    }
  };

  const handleStopResume = async () => {
    if (!book) return;
    setResumeChecking(true);
    try {
      const response = await invokeBookmaker({ action: "resume", bookId: book.id });
      if (response.success && response.operationId) {
        await abandonReservation(book.id, String(response.operationId), "Stopped by member");
      } else {
        setPendingResume(false);
        toast({ title: "Nothing to stop", description: "There is no active reservation for this book." });
      }
    } catch (err) {
      toast({
        title: "Could not stop the reservation",
        description: err instanceof Error ? err.message : "Your book is still saved. Please try again.",
        variant: "destructive",
      });
    } finally {
      setResumeChecking(false);
    }
  };

  const handleCoverUpload = async (file: File | null) => {
    if (!file || !book || !user) return;
    setCoverBusy(true);
    try {
      const { width, height } = await readImageSize(file);
      if (height <= width) {
        throw new Error("Covers must be portrait. Upload an A5-shaped page, 1748 × 2480 px.");
      }
      if (width < COVER_MIN_WIDTH || height < COVER_MIN_HEIGHT) {
        throw new Error(
          `This cover is ${width} × ${height} px. Upload at least ${COVER_MIN_WIDTH} × ${COVER_MIN_HEIGHT} px, ideally 1748 × 2480 px (A5).`,
        );
      }
      const ratio = width / height;
      if (Math.abs(ratio - COVER_ASPECT) > COVER_ASPECT * 0.03) {
        throw new Error(
          `This cover is ${width} × ${height} px. A5 pages need the 1748 × 2480 px shape, so resize it to that ratio to avoid trimming.`,
        );
      }
      const uploaded = await uploadBookCover(user.id, book.id, file);
      const saved = await saveBookmakerBook(book.id, {
        cover: {
          ...(book.cover ?? { kind: "none" }),
          kind: "uploaded",
          url: uploaded.url,
          path: uploaded.path,
          updatedAt: new Date().toISOString(),
        },
      });
      setBook(saved);
      toast({
        title: "Cover uploaded",
        description: "It is fitted to the page without cropping or stretching.",
      });
    } catch (err) {
      toast({
        title: "Cover not uploaded",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCoverBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveCover = async () => {
    if (!book || coverBusy) return;
    setCoverBusy(true);
    try {
      const saved = await saveBookmakerBook(book.id, { cover: { kind: "none" } });
      setBook(saved);
    } catch (err) {
      toast({
        title: "Could not remove the cover",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCoverBusy(false);
    }
  };

  const handleTheme = async (key: ThemePresetKey) => {
    if (!book) return;
    try {
      const saved = await saveBookmakerBook(book.id, { theme: THEME_PRESETS[key] });
      setBook(saved);
    } catch (err) {
      toast({
        title: "Could not change the design",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleExport = async (autoPrint: boolean) => {
    if (!book || exportBusy) return;
    // Open the destination window before any await so the browser treats it as
    // part of the click and the credit check cannot trip the popup blocker.
    const targetWindow = window.open("", "_blank");
    if (!targetWindow) {
      toast({
        title: "Popup blocked",
        description: "Allow popups for Investours so the print-ready book can open.",
        variant: "destructive",
      });
      return;
    }
    if (!canExport) {
      targetWindow.close();
      toast({
        title: "Choose what to export",
        description: "Select the cover, abstract, outline or at least one chapter.",
      });
      return;
    }
    const sections = {
      cover: exportCover,
      // The full book keeps its title page; challenge bundles start the
      // submission with the cover so nothing extra pads the page count.
      titlePage: exportPreset === "full",
      abstract: exportAbstract,
      outline: exportOutline,
      chapters: exportChapters,
    };

    setExportBusy(true);
    try {
      const download = await consumeBookDownload(book.id);
      if (download.entitlement) setEntitlement(download.entitlement);
      if (!download.success) {
        targetWindow.close();
        toast({
          title: "Download unavailable",
          description:
            download.reason === "insufficient_credits"
              ? `Your free downloads for this book are used up. Buy credits or upgrade your plan to download again with ${downloadCost} credit.`
              : download.message || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      if (typeof download.download_count === "number") {
        const nextCount = download.download_count;
        setBook((current) => (current ? { ...current, download_count: nextCount } : current));
      }

      const coverUrl = exportCover ? await resolveBookCoverUrl(book.cover) : null;
      const success = autoPrint
        ? downloadBookPDF(book, { authorName, sections, targetWindow, coverUrl: coverUrl ?? undefined })
        : openBookPrintPreview(book, { authorName, sections, targetWindow, coverUrl: coverUrl ?? undefined });
      if (!success) {
        targetWindow.close();
        toast({
          title: "Popup blocked",
          description: "Allow popups for Investours so the print-ready book can open.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: download.free ? "Download started" : "1 credit used",
        description: download.free
          ? "This download was included in your plan."
          : "Your free downloads for this book are used up, so 1 credit was applied.",
      });
    } catch (err) {
      targetWindow.close();
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handleNewBook = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setBook(null);
    loadedBookIdRef.current = null;
    setIdea("");
    setIdeaInputMode("text");
    setAudience("general");
    setCustomAudience("");
    setPurpose("teach");
    setCustomPurpose("");
    setLanguage("English");
    setCustomLanguage("");
    setLength("medium");
    setTitle("");
    setSubtitle("");
    setOutline(emptyOutline());
    setAbstract("");
    setAuthor("");
    setEditingChapter(null);
    setWriteError(null);
    setPendingResume(false);
    setWriting(false);
    setWritingChapter(null);
    setStep(0);
    setSearchParams({}, { replace: true });
  };

  const handleDeleteCurrentBook = async () => {
    if (!book) return;
    if (!window.confirm("Delete this ebook? This cannot be undone.")) return;
    try {
      await deleteBookmakerBook(book.id);
      toast({ title: "Book deleted" });
      handleNewBook();
    } catch (err) {
      toast({
        title: "Could not delete the book",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const openStartGate = () => {
    if (!book) return;
    if (!user) {
      redirectToLogin();
      return;
    }
    if (planLimitReached) {
      toast({ title: "Plan limit reached", description: planLimitMessage, variant: "destructive" });
      return;
    }
    setGate({ kind: "start", cost: activeCost });
  };

  const openFullRegenerationGate = () => {
    if (!book) return;
    setGate({ kind: "full", cost: activeCost });
  };

  const confirmGate = async () => {
    const current = gate;
    if (!current || !book) return;
    setGateBusy(true);
    try {
      if (current.kind === "start" || current.kind === "full") {
        const saved = await persistOutline();
        if (!saved) return;
        const mode = current.kind === "full" ? "full_regeneration" : "initial_book";
        const locked = current.kind === "full" ? approvedChapters : [];
        setGate(null);
        await beginReservation(saved, mode, locked);
        return;
      }

      if (current.kind === "chapter" || current.kind === "visual") {
        const response = await invokeBookmaker({
          action: current.kind === "chapter" ? "regenerate_chapter" : "regenerate_visual",
          bookId: book.id,
          chapterIndex: current.index,
          blockIndex: current.kind === "visual" ? current.blockIndex : undefined,
          instruction: current.instruction,
          idempotencyKey: makeIdempotencyKey(current.kind, book.id),
        });
        if (!response.success) {
          if (response.reason === "insufficient_credits") await refreshEntitlement();
          toast({
            title: "Nothing was changed",
            description: String(response.message || "The AI could not complete that rewrite."),
            variant: "destructive",
          });
          return;
        }
        if (response.book) setBook(response.book as BookmakerBook);
        if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
        setGate(null);
        toast({
          title: current.kind === "chapter" ? "Chapter rewritten" : "Visual refreshed",
          description: "Your other chapters and edits are unchanged.",
        });
        await refreshEntitlement();
        return;
      }

      if (current.kind === "audiobook") {
        setGate(null);
        await startAudiobookPass(current.voice);
        return;
      }

      const response = await invokeBookmaker({
        action: "generate_cover",
        bookId: book.id,
        style: current.style,
        idempotencyKey: makeIdempotencyKey("cover", book.id),
      });
      if (!response.success) {
        if (response.reason === "insufficient_credits") await refreshEntitlement();
        toast({
          title: "Cover not generated",
          description: String(response.message || "Please try again."),
          variant: "destructive",
        });
        return;
      }
      if (response.book) setBook(response.book as BookmakerBook);
      if (response.entitlement) setEntitlement(response.entitlement as BookmakerEntitlement);
      setGate(null);
      toast({ title: "Cover ready", description: "You can generate another direction or upload your own." });
      await refreshEntitlement();
    } catch (err) {
      toast({
        title: "That action did not complete",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGateBusy(false);
    }
  };

  const gateTitle = !gate
    ? ""
    : gate.kind === "start"
      ? "Write your manuscript"
      : gate.kind === "full"
        ? missingChapterCount > 0
          ? "Write the remaining chapters"
          : "Regenerate the unapproved chapters"
        : gate.kind === "chapter"
          ? "Rewrite this chapter"
          : gate.kind === "visual"
            ? "Refresh this visual"
            : gate.kind === "audiobook"
              ? "Narrate this book"
              : "Design a cover";

  const gateDescription = !gate
    ? ""
    : gate.kind === "start"
      ? `${lengthLabel(activeLength)} book · ${activeLengthOption.range} · ${activeLengthOption.chapterTarget} chapters. The credits are reserved once and unused chapters are refunded if you stop early.`
      : gate.kind === "full"
        ? missingChapterCount > 0
          ? `${approvedChapters.length} approved chapter${approvedChapters.length === 1 ? "" : "s"} will stay exactly as they are. Only the ${missingChapterCount} missing chapter${missingChapterCount === 1 ? "" : "s"} will be written.`
          : `${approvedChapters.length} approved chapter${approvedChapters.length === 1 ? "" : "s"} will stay exactly as they are. Only the remaining chapters are rewritten.`
        : gate.kind === "chapter"
          ? "Only this chapter changes. Your other chapters, approved content and manual edits stay untouched."
          : gate.kind === "visual"
            ? "Only this visual block is rewritten. The surrounding chapter stays the same."
            : gate.kind === "audiobook"
              ? "Paid once for the whole book with platform credits from a credit pack. Each finished chapter is saved as it is voiced, and unused chapters are refunded if you stop early."
              : "One typographic cover design matched to the book's audience, purpose and title. You can upload your own cover instead at any time.";

  const activeWritingTitle =
    writingChapter !== null
      ? outline.chapters[writingChapter]?.title ||
        chapters.find((chapter) => chapter.number === writingChapter + 1)?.title ||
        `Chapter ${writingChapter + 1}`
      : "";

  const shortfall = Math.max(activeCost - entitlement.total_available, 0);
  const startShortfall = Math.max(startCost - entitlement.total_available, 0);
  const planLimitReached = entitlement.plan_items_remaining === 0;
  const planLimitMessage =
    entitlement.plan_items_limit != null
      ? `Your plan includes ${entitlement.plan_items_limit} ebook creations this period. Upgrade your plan to keep creating.`
      : "Your plan's ebook allowance is used up for this period.";

  if (loadingBook) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_38%),radial-gradient(circle_at_bottom_left,hsl(var(--accent)/0.08),transparent_35%)]">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4">
          <Link to="/bookmaker" className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">Bookmaker</span>
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">by Investours</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => void refreshEntitlement()}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:border-primary/40 sm:px-3"
              title="Refresh credit balance"
            >
              {refreshingCredits ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Coins className="h-3.5 w-3.5 text-primary" />
              )}
              <span className="whitespace-nowrap">{entitlement.total_available} credits</span>
            </button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/dashboard/bookmaker">My Books</Link>
            </Button>
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => openPurchase("packs")}>
              Buy credits
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-9 w-9 sm:hidden" aria-label="My books">
              <Link to="/dashboard/bookmaker">
                <BookOpen className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-5 sm:px-4 sm:py-8">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Bookmaker studio</p>
            <h1 className="mt-1 break-words text-xl font-bold leading-tight sm:text-2xl md:text-3xl">
              {book ? book.title || "Untitled book" : "Create your ebook"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {book
                ? `${lengthLabel(book.length)} · ${audienceLabel(book)} · ${purposeLabel(book)}`
                : "Start with an idea. Your title and outline come first."}
            </p>
          </div>
          {book ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {STATUS_LABELS[book.status] ?? "Draft"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {bookWordCount(book).toLocaleString("en-NG")} words
              </span>
            </div>
          ) : null}
        </div>

        <nav
          aria-label="Bookmaker steps"
          className="mb-5 -mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mb-6"
        >
          <ol className="flex min-w-max items-stretch gap-1.5 px-1">
            {STEPS.map((item, index) => {
              const active = index === step;
              const complete = index < step;
              const visitable = canVisit(index);
              return (
                <li key={item.title} className="flex-1">
                  <button
                    type="button"
                    disabled={!visitable}
                    onClick={() => setStep(index)}
                    className={cn(
                      "flex h-full w-full min-w-[112px] items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors sm:min-w-[132px] sm:px-3",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : complete
                          ? "border-primary/30 bg-primary/5 text-foreground"
                          : "border-border bg-card text-muted-foreground",
                      !visitable && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        active ? "bg-primary-foreground text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{item.title}</span>
                      <span className={cn("block truncate text-[10px]", active ? "text-primary-foreground/75" : "text-muted-foreground")}>
                        {item.caption}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {step === 0 ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-3xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-start gap-2 text-lg sm:text-2xl">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> What do you want to teach or share?
                </CardTitle>
                <CardDescription>
                  Describe the idea in your own words. One clear, specific idea works better than a list of topics.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="book-idea">Your ebook idea</Label>
                  <Textarea
                    id="book-idea"
                    value={idea}
                    onChange={(event) => {
                      setIdea(event.target.value);
                      if (ideaInputMode === "voice") setIdeaInputMode("text");
                    }}
                    rows={7}
                    maxLength={4000}
                    placeholder="Example: A practical guide for small business owners in Nigeria who want to start selling online, covering how to choose a product, set a price, take payments and get the first 20 customers."
                    className="resize-y"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={cn("text-xs", idea.trim().length > 0 && idea.trim().length < 20 ? "text-amber-600" : "text-muted-foreground")}>
                      {idea.length.toLocaleString("en-NG")} / 4,000 characters
                      {idea.trim().length > 0 && idea.trim().length < 20 ? " · add a little more detail" : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={listening ? "destructive" : "outline"}
                      onClick={handleStartVoice}
                      className="gap-2"
                    >
                      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {listening ? "Stop recording" : "Use a voice note"}
                    </Button>
                  </div>
                  {listening ? (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                      <span className="flex h-2 w-2 animate-pulse rounded-full bg-primary" />
                      Listening… speak naturally, then stop when you are done.
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <p className="mb-2 font-medium text-foreground">A strong idea usually includes:</p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> Who the reader is</li>
                    <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> The problem they have</li>
                    <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> What the book helps them do</li>
                    <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> Any experience or method you bring</li>
                  </ul>
                </div>

                <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {user ? "Signed in. Your draft is saved automatically." : "You can start here, then sign in to generate your outline."}
                  </p>
                  <Button
                    onClick={() => {
                      const ideaError = validateIdea(idea);
                      if (ideaError) {
                        toast({ title: "One more detail", description: ideaError, variant: "destructive" });
                        return;
                      }
                      setStep(1);
                    }}
                    disabled={!idea.trim()}
                    className="w-full gap-2 sm:w-auto"
                  >
                    Choose reader &amp; length <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {step === 1 ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Who is this book for?</CardTitle>
                  <CardDescription>Choose the closest reader. This shapes tone, examples and depth.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {AUDIENCES.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setAudience(option.key);
                          setCustomAudience("");
                        }}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          audience === option.key
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2 text-sm font-medium">
                          {option.label}
                          {audience === option.key ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAudience("custom")}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        audience === "custom"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-medium">
                        A different audience
                        {audience === "custom" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Describe exactly who you have in mind.</span>
                    </button>
                  </div>
                  {audience === "custom" ? (
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="custom-audience">Describe the reader</Label>
                      <Input
                        id="custom-audience"
                        value={customAudience}
                        onChange={(event) => setCustomAudience(event.target.value)}
                        placeholder="e.g. Female fashion entrepreneurs aged 25–40 in Lagos"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">What should the book do?</CardTitle>
                  <CardDescription>Purpose decides the structure, exercises and design direction.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PURPOSES.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setPurpose(option.key);
                          setCustomPurpose("");
                        }}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          purpose === option.key
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2 text-sm font-medium">
                          {option.label}
                          {purpose === option.key ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPurpose("custom")}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors",
                        purpose === "custom"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-medium">
                        A different purpose
                        {purpose === "custom" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Tell us what success looks like.</span>
                    </button>
                  </div>
                  {purpose === "custom" ? (
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="custom-purpose">Describe the purpose</Label>
                      <Input
                        id="custom-purpose"
                        value={customPurpose}
                        onChange={(event) => setCustomPurpose(event.target.value)}
                        placeholder="e.g. Help church leaders run a 4-week giving campaign"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Language and length</CardTitle>
                  <CardDescription>Write in the language your reader thinks in.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="book-language">Book language</Label>
                      <Select
                        value={LANGUAGES.includes(language) ? language : "custom"}
                        onValueChange={(value) => {
                          if (value === "custom") {
                            setLanguage("custom");
                          } else {
                            setLanguage(value);
                            setCustomLanguage("");
                          }
                        }}
                      >
                        <SelectTrigger id="book-language">
                          <SelectValue placeholder="Choose a language" />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGES.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Another language</SelectItem>
                        </SelectContent>
                      </Select>
                      {!LANGUAGES.includes(language) ? (
                        <Input
                          value={customLanguage}
                          onChange={(event) => setCustomLanguage(event.target.value)}
                          placeholder="Type the language"
                          aria-label="Custom language"
                        />
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        <Globe2 className="h-3.5 w-3.5 text-primary" /> 13 languages supported
                      </p>
                      <p className="mt-1 leading-relaxed">
                        Titles, chapters, visuals and the cover copy are all written in the language you choose.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {LENGTH_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setLength(option.key)}
                        className={cn(
                          "relative rounded-xl border p-4 text-left transition-colors",
                          length === option.key
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        {option.key === "medium" ? (
                          <Badge className="absolute -top-2 right-2 text-[10px]">Popular</Badge>
                        ) : null}
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{option.label}</span>
                          <span className="text-xs font-medium text-primary">{option.credits} credits</span>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{option.range}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {option.chapters[0]}–{option.chapters[1]} chapters
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <Button variant="outline" onClick={() => setStep(0)} className="w-full gap-2 sm:w-auto">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={handleGenerateOutline} disabled={generatingOutline} size="lg" className="w-full gap-2 sm:w-auto">
                  {generatingOutline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generatingOutline ? "Building your outline…" : "Generate my outline"}
                </Button>
              </div>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Your selection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Book</span>
                    <span className="text-right font-medium">{lengthLabel(length)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Reader</span>
                    <span className="max-w-[60%] break-words text-right font-medium">
                      {customAudience.trim() || AUDIENCES.find((item) => item.key === audience)?.label || "General readers"}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Purpose</span>
                    <span className="max-w-[60%] break-words text-right font-medium">
                      {customPurpose.trim() || PURPOSES.find((item) => item.key === purpose)?.label || "Teach a practical skill"}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-primary/15 pt-3">
                    <span className="text-muted-foreground">Outline</span>
                    <span className="font-medium text-green-700">Included</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Manuscript</span>
                    <span className="font-bold">{startCost} credits</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Nothing is charged until you choose to write the manuscript.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Wallet className="h-4 w-4" /> Available credits
                    </span>
                    <span className="font-semibold">{entitlement.total_available}</span>
                  </div>
                  {entitlement.subscription_active && entitlement.plan_items_limit != null ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Ebook allowance</span>
                      <span className={cn("font-semibold", planLimitReached && "text-destructive")}>
                        {entitlement.plan_items_used ?? 0} of {entitlement.plan_items_limit} used
                      </span>
                    </div>
                  ) : null}
                  {planLimitReached ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="font-medium">Plan limit reached</p>
                      <p className="mt-1">{planLimitMessage}</p>
                      <Button size="sm" className="mt-2 w-full" onClick={() => openPurchase("subscribe")}>
                        Upgrade plan
                      </Button>
                    </div>
                  ) : startShortfall > 0 ? (
                    <>
                      <p className="text-xs text-amber-700">
                        You are {startShortfall} credit{startShortfall === 1 ? "" : "s"} short for the manuscript. You can still generate the outline.
                      </p>
                      <Button size="sm" className="w-full" onClick={() => openPurchase("packs")}>
                        Buy credits
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      You have enough credits to write this {lengthLabel(length).toLowerCase()} book.
                    </p>
                  )}
                </CardContent>
              </Card>
            </aside>
          </motion.div>
        ) : null}

        {step === 2 ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="space-y-4">
              {outline.chapters.length === 0 ? (
                <Card>
                  <CardContent className="space-y-4 p-8 text-center">
                    <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
                    <div>
                      <h2 className="text-lg font-semibold">No outline yet</h2>
                      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                        Go back to the setup step and generate an outline. You can edit everything before writing.
                      </p>
                    </div>
                    <Button onClick={() => setStep(1)}>Back to setup</Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Title &amp; promise</CardTitle>
                      <CardDescription>You can edit your outline as many times as you like.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="book-title">Book title</Label>
                        <Input
                          id="book-title"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          maxLength={160}
                          placeholder="Book title"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="book-subtitle">Subtitle or promise</Label>
                        <Input
                          id="book-subtitle"
                          value={subtitle}
                          onChange={(event) => setSubtitle(event.target.value)}
                          maxLength={220}
                          placeholder="One line that tells the reader what they get"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Author &amp; abstract</CardTitle>
                      <CardDescription>
                        Decide the name that appears on the book and review the summary written with your outline.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="book-author">Author or creator name</Label>
                        <Input
                          id="book-author"
                          value={author}
                          onChange={(event) => setAuthor(event.target.value)}
                          maxLength={80}
                          placeholder="The name printed on the cover and title page"
                        />
                        <p className="text-xs text-muted-foreground">
                          Blank leaves the author line off the book. This can be a pen name.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="book-abstract">Abstract</Label>
                        <Textarea
                          id="book-abstract"
                          value={abstract}
                          onChange={(event) => setAbstract(event.target.value)}
                          rows={6}
                          maxLength={1200}
                          placeholder="A short summary of the book for submissions, catalogues and your cover letter"
                          className="text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          Used for challenge submissions and the abstract export. {abstract.trim().split(/\s+/).filter(Boolean).length} words.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-col gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-lg">Chapters</CardTitle>
                        <CardDescription>
                          {outline.chapters.length} chapters · target {activeLengthOption.chapters[0]}–{activeLengthOption.chapters[1]}
                        </CardDescription>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={addOutlineChapter}
                        disabled={outline.chapters.length >= activeLengthOption.chapters[1]}
                        className="w-full gap-1.5 sm:w-auto"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add chapter
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {outline.chapters.map((chapter, index) => (
                        <div key={`${chapter.number}-${index}`} className="rounded-xl border border-border p-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                              {index + 1}
                            </span>
                            <Input
                              value={chapter.title}
                              onChange={(event) => updateOutlineChapter(index, { title: event.target.value })}
                              maxLength={140}
                              aria-label={`Chapter ${index + 1} title`}
                              className="h-9 border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removeOutlineChapter(index)}
                              disabled={outline.chapters.length <= activeLengthOption.chapters[0] || index < highestWrittenNumber}
                              title={
                                index < highestWrittenNumber
                                  ? "This chapter is already written. Keep it, or start a new book to change the structure."
                                  : "Remove chapter"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Textarea
                            value={chapter.summary}
                            onChange={(event) => updateOutlineChapter(index, { summary: event.target.value })}
                            rows={2}
                            maxLength={600}
                            placeholder="What this chapter covers and what the reader can do afterwards"
                            className="mt-2 text-sm"
                            aria-label={`Chapter ${index + 1} summary`}
                          />
                          <Input
                            value={chapter.sections.join(" | ")}
                            onChange={(event) =>
                              updateOutlineChapter(index, {
                                sections: event.target.value
                                  .split("|")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })
                            }
                            maxLength={700}
                            placeholder="Section headings, separated by |"
                            className="mt-2 h-8 text-xs"
                            aria-label={`Chapter ${index + 1} sections`}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <Button variant="outline" onClick={() => setStep(1)} className="w-full gap-2 sm:w-auto">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button variant="outline" onClick={handleSaveOutline} disabled={savingOutline} className="w-full gap-2 sm:w-auto">
                        {savingOutline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Save outline
                      </Button>
                      <Button onClick={openStartGate} size="lg" className="w-full gap-2 sm:w-auto">
                        <Wand2 className="h-4 w-4" /> Write manuscript · {activeCost} credits
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">What happens next</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p className="flex items-start gap-2">
                    <Coins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {activeCost} credits are reserved once for the whole {lengthLabel(activeLength).toLowerCase()} book.
                  </p>
                  <p className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    You can edit every chapter after it is written.
                  </p>
                  <p className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    Rewriting one chapter costs 1 credit. Approved chapters can be kept during a full rewrite.
                  </p>
                  <p className="flex items-start gap-2">
                    <ShieldRow />
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Wallet className="h-4 w-4" /> Available
                    </span>
                    <span className="font-semibold">{entitlement.total_available} credits</span>
                  </div>
                  {entitlement.subscription_active && entitlement.plan_items_limit != null ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Ebook allowance</span>
                      <span className={cn("font-semibold", planLimitReached && "text-destructive")}>
                        {entitlement.plan_items_used ?? 0} of {entitlement.plan_items_limit} used
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Manuscript cost</span>
                    <span className="font-semibold">{activeCost} credits</span>
                  </div>
                  {planLimitReached ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="font-medium">Plan limit reached</p>
                      <p className="mt-1">{planLimitMessage}</p>
                      <Button size="sm" className="mt-2 w-full" onClick={() => openPurchase("subscribe")}>
                        Upgrade plan
                      </Button>
                    </div>
                  ) : shortfall > 0 ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="font-medium">Short by {shortfall}</p>
                      <p className="mt-1">Your outline and edits are saved. Buy credits, then come back to this book.</p>
                      <Button size="sm" className="mt-2 w-full" onClick={() => openPurchase("packs")}>
                        Buy credits
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">You have enough credits to write this book.</p>
                  )}
                </CardContent>
              </Card>
            </aside>
          </motion.div>
        ) : null}

        {step === 3 && book ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {writing ? (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div>
                        <p className="font-semibold">
                          {writingChapter !== null ? `Writing chapter ${writingChapter + 1}…` : "Finishing your manuscript…"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {activeWritingTitle || "Please keep this tab open while the AI writes."}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        cancelRef.current = true;
                        setStopping(true);
                      }}
                      disabled={stopping}
                      className="w-full justify-center gap-2 sm:w-auto"
                    >
                      {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                      {stopping ? "Stopping after this chapter…" : "Stop & refund unused"}
                    </Button>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-primary/10">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${writingTotal > 0 ? Math.min(100, Math.round((writingDone / writingTotal) * 100)) : 8}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {writingDone} of {writingTotal} chapter{writingTotal === 1 ? "" : "s"} written. You can keep editing in the meantime but avoid closing the tab.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {!writing && (pendingResume || book.status === "generating") ? (
              <Card className="border-amber-300 bg-amber-50/70">
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold text-amber-900">You have an unfinished manuscript</p>
                      <p className="text-sm text-amber-800">
                        The reservation is still open. Resume to finish the remaining chapters — you will not be charged twice. Stopping refunds the chapters that were never written.
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" onClick={handleResume} disabled={resumeChecking} className="gap-2">
                      {resumeChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Resume writing
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleStopResume} disabled={resumeChecking}>
                      Stop &amp; refund
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {writeError ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">The AI stopped early</p>
                  <p className="mt-0.5 text-muted-foreground">{writeError}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nothing extra was charged. Retry the chapter or stop the reservation to refund what was not written.
                  </p>
                </div>
                {pendingResume ? (
                  <Button size="sm" variant="outline" onClick={handleResume} disabled={resumeChecking}>
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}

            {!hasChapters && !writing ? (
              <Card>
                <CardContent className="space-y-4 p-8 text-center">
                  <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/60" />
                  <div>
                    <h2 className="text-lg font-semibold">Ready to write</h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Bookmaker writes one chapter at a time, so you can follow the progress. Your outline and approved content stay exactly as they are.
                    </p>
                  </div>
                  <Button onClick={openStartGate} size="lg" className="gap-2" disabled={planLimitReached}>
                    <Wand2 className="h-4 w-4" /> Write manuscript · {activeCost} credits
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Available balance: {entitlement.total_available} credits
                    {entitlement.plan_items_limit != null
                      ? ` · Ebook allowance: ${entitlement.plan_items_used ?? 0} of ${entitlement.plan_items_limit} used`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {hasChapters ? (
              <>
                {book.status === "manuscript_ready" || book.status === "completed" || book.status === "designed" ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-green-300 bg-green-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                      <div>
                        <p className="font-medium text-green-900">Manuscript ready</p>
                        <p className="text-sm text-green-800">
                          Review the chapters, approve the ones you want to keep, then add a cover and export your PDF.
                        </p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setStep(4)} className="gap-2">
                      Design &amp; export <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}

                {editingChapter !== null ? (
                  <Card ref={editorRef} className="scroll-mt-20">
                    <CardHeader className="flex-col items-start gap-2 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="text-lg">Edit chapter {editingChapter + 1}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {chapters.find((chapter) => chapter.number === editingChapter + 1)?.title} · manual edits use no credits
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {wordCount(editContent).toLocaleString("en-NG")} words
                      </Badge>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        rows={22}
                        className="font-mono text-[13px] leading-relaxed"
                        aria-label="Chapter content"
                      />
                      <p className="text-xs text-muted-foreground">
                        Markdown and the visual blocks ({":::callout"}, {":::keypoints"}, {":::checklist"}, {":::diagram"}, {":::chart"}, {":::figure"}) are supported.
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" onClick={() => setEditingChapter(null)} disabled={savingEdit}>
                          Cancel
                        </Button>
                        <Button onClick={handleSaveChapter} disabled={savingEdit} className="gap-2">
                          {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Save edits
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <BookPreview
                  book={{ ...book, theme: book.theme ?? resolveTheme(book) }}
                  authorName={authorName}
                  approvedChapters={approvedChapters}
                  busy={writing || gateBusy}
                  busyChapter={writingChapter}
                  onEditChapter={(index) => {
                    const chapter = chapters.find((item) => item.number === index + 1);
                    if (!chapter) return;
                    setEditingChapter(index);
                    setEditContent(chapter.content ?? "");
                    scrollToEditor();
                  }}
                  onRegenerateChapter={writing ? undefined : (index) => setGate({ kind: "chapter", index, cost: 1, instruction: "" })}
                  onRegenerateVisual={writing ? undefined : (index, blockIndex) => setGate({ kind: "visual", index, blockIndex, cost: 1, instruction: "" })}
                  onToggleApproved={writing ? undefined : handleToggleApproved}
                />

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Book-wide tools</CardTitle>
                    <CardDescription>
                      Approved chapters are protected. Regenerate only the chapters you have not approved.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-muted-foreground">
                        <p>
                          <span className="font-medium text-foreground">{approvedChapters.length}</span> of{" "}
                          {Math.max(outlineChapterCount, chapters.length)} chapters approved
                        </p>
                        <p className="text-xs">
                          {allOutlineChaptersApproved
                            ? "Every chapter is approved. Unlock one to regenerate it."
                            : missingChapterCount > 0
                              ? `${missingChapterCount} outline chapter${missingChapterCount === 1 ? "" : "s"} still to write. Approved chapters stay protected.`
                              : `${chapters.length - approvedChapters.length} chapter${chapters.length - approvedChapters.length === 1 ? "" : "s"} can be regenerated.`}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={openFullRegenerationGate}
                        disabled={allOutlineChaptersApproved || writing}
                        className="w-full gap-2 sm:w-auto"
                      >
                        <RefreshCw className="h-4 w-4" />{" "}
                        {missingChapterCount > 0 ? "Write remaining chapters" : "Regenerate unapproved"} · {activeCost} credits
                      </Button>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
                      <Button variant="ghost" size="sm" onClick={() => setStep(4)} className="gap-2">
                        <Palette className="h-4 w-4" /> Design &amp; export
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleDeleteCurrentBook} className="gap-2 text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" /> Delete book
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </motion.div>
        ) : null}

        {step === 4 && book ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Cover</CardTitle>
                  <CardDescription>Upload your own or let Bookmaker design one.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CoverPreview book={book} authorName={authorName} className="mx-auto max-w-[240px]" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      onClick={() => setGate({ kind: "cover", cost: 1, style: coverStyle })}
                      disabled={coverBusy || gateBusy}
                      className="gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Generate · 1
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={coverBusy}
                      className="gap-1.5"
                    >
                      {coverBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Upload
                    </Button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    JPG, PNG or WebP up to 8 MB. Use the A5 page size, 1748 × 2480 px (minimum 1200 × 1700 px), so the
                    cover fills the page without trimming.
                  </p>
                  {book?.cover?.kind !== "none" ? (
                    <Button variant="ghost" size="sm" onClick={handleRemoveCover} disabled={coverBusy} className="w-full text-muted-foreground">
                      Remove cover
                    </Button>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Saved book</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <p>Last updated {formatBookDate(book?.updated_at)}</p>
                  <p>{bookWordCount(book).toLocaleString("en-NG")} words across {chapters.length} chapters</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dashboard/bookmaker">My Books</Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleNewBook}>
                      New book
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Book design</CardTitle>
                  <CardDescription>
                    Colours, typography, spacing and visual captions adapt to your purpose and reader.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {THEME_KEYS.map((key) => {
                      const theme = THEME_PRESETS[key];
                      const selected = resolveTheme(book).preset === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleTheme(key)}
                          className={cn(
                            "rounded-xl border p-3 text-left transition-colors",
                            selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="flex gap-1">
                            {(["primary", "accent", "surface", "text"] as const).map((slot) => (
                              <span
                                key={slot}
                                className="h-4 w-4 rounded-full border border-black/10"
                                style={{ background: theme.palette[slot] }}
                              />
                            ))}
                          </span>
                          <span className="mt-2 block text-xs font-medium">{theme.name}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">{theme.headingFont.split(",")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  {hasChapters ? (
                    <div className="mt-4 rounded-xl border border-border p-4" style={{ background: resolveTheme(book).palette.background, color: resolveTheme(book).palette.text }}>
                      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: resolveTheme(book).palette.muted }}>
                        Chapter preview
                      </p>
                      <p className="mt-2 text-lg font-semibold" style={{ fontFamily: resolveTheme(book).headingFont }}>
                        {chapters[0]?.title || "Chapter one"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed" style={{ fontFamily: resolveTheme(book).bodyFont, color: resolveTheme(book).palette.muted }}>
                        This is how your body text, headings and spacing will feel in the finished ebook.
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Download className="h-5 w-5 text-primary" /> Preview &amp; export
                  </CardTitle>
                  <CardDescription>
                    Choose what goes into the file. Every bundle exports as one A5 PDF.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Challenge bundles</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {[
                        { key: "stage1" as const, label: "Stage 1", hint: "Cover, outline & abstract" },
                        { key: "stage2" as const, label: "Stage 2", hint: "Stage 1 + chapter 1" },
                        { key: "full" as const, label: "Full book", hint: "Cover, abstract & all chapters" },
                      ].map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => applyExportPreset(preset.key)}
                          className={cn(
                            "rounded-xl border px-3 py-2 text-left transition-colors",
                            exportPreset === preset.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="block text-xs font-semibold">{preset.label}</span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{preset.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      {
                        label: "Cover",
                        active: exportCover,
                        toggle: () => {
                          setExportPreset("custom");
                          setExportCover((value) => !value);
                        },
                      },
                      {
                        label: "Abstract",
                        active: exportAbstract,
                        toggle: () => {
                          setExportPreset("custom");
                          setExportAbstract((value) => !value);
                        },
                      },
                      {
                        label: "Outline",
                        active: exportOutline,
                        toggle: () => {
                          setExportPreset("custom");
                          setExportOutline((value) => !value);
                        },
                      },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={option.toggle}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors",
                          option.active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                        )}
                      >
                        <span className="font-medium">{option.label}</span>
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            option.active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                          )}
                        >
                          {option.active ? <Check className="h-3 w-3" /> : null}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">
                        Chapters{" "}
                        <span className="text-muted-foreground">
                          ({exportChapterCount} of {exportableChapters.length})
                        </span>
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-primary hover:underline"
                          onClick={() => {
                            setExportPreset("custom");
                            setExportChapters("all");
                          }}
                        >
                          All
                        </button>
                        <span className="text-[11px] text-muted-foreground">·</span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-primary hover:underline"
                          onClick={() => {
                            setExportPreset("custom");
                            setExportChapters([]);
                          }}
                        >
                          None
                        </button>
                      </div>
                    </div>
                    {exportableChapters.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {exportableChapters.map((chapter) => {
                          const active = exportChapterNumbers.includes(chapter.number);
                          return (
                            <button
                              key={chapter.number}
                              type="button"
                              title={chapter.title}
                              onClick={() => toggleExportChapter(chapter.number)}
                              className={cn(
                                "h-7 min-w-7 rounded-md border px-2 text-[11px] font-medium transition-colors",
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-muted-foreground hover:border-primary/40",
                              )}
                            >
                              {chapter.number}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        No written chapters yet. The cover, outline and abstract can still be exported.
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">PDF tips</p>
                    <p className="mt-1">
                      In the print dialog choose <strong>Save as PDF</strong>, A5 paper and enable <strong>Background graphics</strong> so the cover and visuals print correctly.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      onClick={() => void handleExport(false)}
                      variant="outline"
                      className="flex-1 gap-2"
                      disabled={!canExport || exportBusy}
                    >
                      {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Open print preview
                    </Button>
                    <Button
                      onClick={() => void handleExport(true)}
                      className="flex-1 gap-2"
                      disabled={!canExport || exportBusy}
                    >
                      {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Save as PDF
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <Button variant="ghost" size="sm" onClick={() => setStep(3)} className="gap-2">
                      <Edit3 className="h-4 w-4" /> Back to manuscript
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {downloadLimit === 0
                        ? "Free downloads are included with a credit pack or subscription."
                        : freeDownloadsLeft > 0
                          ? `${freeDownloadsLeft} of ${downloadLimit} free downloads left for this book.`
                          : `Free downloads used · ${downloadCost} credit for each new download.`}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Headphones className="h-5 w-5 text-primary" /> Audiobook
                  </CardTitle>
                  <CardDescription>
                    Turn your manuscript into a listenable book with a natural AI narrator.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!audioLanguage ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                      <p className="font-medium">Narration supports English and Arabic</p>
                      <p className="mt-1">
                        This book is written in {book.custom_language || book.language}. You can still export the PDF, or use your browser&rsquo;s
                        read-aloud feature from the print preview.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label className="text-xs">Narrator</Label>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          {audioVoices.map((voice) => {
                            const selected = activeAudioVoice === voice.key;
                            const previewing = previewingVoice === voice.key;
                            const loadingPreview = previewLoading === voice.key;
                            return (
                              <div
                                key={voice.key}
                                className={cn(
                                  "flex items-center gap-1 rounded-lg border py-1.5 pl-2.5 pr-1 transition-colors",
                                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => setAudioVoice(voice.key)}
                                  disabled={audioBusy || gateBusy}
                                  className="min-w-0 flex-1 text-left disabled:opacity-60"
                                >
                                  <span className="block text-xs font-medium">{voice.label}</span>
                                  <span className="block truncate text-[10px] text-muted-foreground">{voice.description}</span>
                                </button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => void handlePreviewVoice(voice.key)}
                                  disabled={previewLoading !== null}
                                  className="h-7 w-7 shrink-0 rounded-full"
                                  aria-label={previewing ? `Stop sample of ${voice.label}` : `Hear ${voice.label}`}
                                >
                                  {loadingPreview ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : previewing ? (
                                    <Square className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        <audio
                          ref={previewAudioRef}
                          preload="none"
                          className="hidden"
                          onEnded={() => setPreviewingVoice(null)}
                        />
                      </div>

                      <Button
                        onClick={handleStartAudiobook}
                        disabled={!hasChapters || audioBusy || gateBusy || book.audiobook?.status === "generating"}
                        className="w-full gap-2 sm:w-auto"
                      >
                        {audioBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {book.audiobook?.status === "generating"
                          ? "Narration in progress"
                          : hasAudio
                            ? `Narrate again · ${audioCost} credit${audioCost === 1 ? "" : "s"}`
                            : `Create audiobook · ${audioCost} credits`}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Platform credits only: the whole book costs short 4 credits · medium 8 credits · long 12 credits. Subscription
                        credits and plan allowances cannot be used for narration.
                      </p>
                      {book.audiobook?.status !== "generating" && entitlement.pack_credits_remaining < audioCost ? (
                        <p className="text-xs text-amber-700">
                          You have {entitlement.pack_credits_remaining} platform credit
                          {entitlement.pack_credits_remaining === 1 ? "" : "s"}.{" "}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => openPurchase("packs")}
                          >
                            Buy a credit pack
                          </button>
                        </p>
                      ) : null}

                      <AudiobookPlayer
                        book={book}
                        busy={audioBusy}
                        busyChapter={audioChapter}
                        progress={audioProgress}
                        assembling={assembling}
                        error={audioError}
                        onAssemble={handleAssembleAudiobook}
                        onRegenerate={handleStartAudiobook}
                        onResume={() => void handleResumeAudiobook()}
                        onStop={handleStopAudiobook}
                        stopping={audioStopping}
                      />

                      <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                        WAV narration is high quality but large (roughly 3&nbsp;MB per minute). On slow connections, download chapters one at a time.
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Ready to publish?</p>
                      <p className="text-xs text-muted-foreground">
                        Use the publishing tutorials to list your book on Amazon KDP, Selar or Gumroad — and launch it to your audience.
                      </p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/bookmaker">Publishing guide</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        ) : null}
      </main>

      <CreditGateDialog
        open={Boolean(gate)}
        onOpenChange={(open) => {
          if (!open && !gateBusy) setGate(null);
        }}
        title={gateTitle}
        description={gateDescription}
        cost={gate?.cost ?? 0}
        entitlement={entitlement}
        busy={gateBusy}
        onConfirm={confirmGate}
        onPurchase={(kind) => {
          setGate(null);
          openPurchase(kind);
        }}
        packOnly={gate?.kind === "audiobook"}
        confirmLabel={
          gate?.kind === "start" || gate?.kind === "full"
            ? `Write for ${gate.cost} credits`
            : gate?.kind === "audiobook"
              ? `Narrate for ${gate.cost} credits`
              : undefined
        }
      >
        {gate?.kind === "audiobook" ? (
          <div className="space-y-2">
            <Label>Narrator</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {audiobookVoicesFor(book?.language ?? language).map((voice) => (
                <button
                  key={voice.key}
                  type="button"
                  onClick={() =>
                    setGate((current) => (current && current.kind === "audiobook" ? { ...current, voice: voice.key } : current))
                  }
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors",
                    gate.voice === voice.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="block font-medium">{voice.label}</span>
                  <span className="block truncate text-muted-foreground">{voice.description}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Changing the narrator re-narrates the whole book. Finished chapters are saved as they are voiced.
            </p>
          </div>
        ) : null}
        {gate?.kind === "chapter" || gate?.kind === "visual" ? (
          <div className="space-y-1.5">
            <Label htmlFor="rewrite-instruction">What should change?</Label>
            <Textarea
              id="rewrite-instruction"
              value={gate.instruction}
              onChange={(event) =>
                setGate((current) =>
                  current && (current.kind === "chapter" || current.kind === "visual")
                    ? { ...current, instruction: event.target.value }
                    : current,
                )
              }
              rows={3}
              maxLength={600}
              placeholder={
                gate.kind === "chapter"
                  ? "e.g. Simpler language, more Nigerian examples, add an exercise at the end"
                  : "e.g. Turn this into a three-step diagram with clearer labels"
              }
            />
            <p className="text-[11px] text-muted-foreground">Leave blank to let Bookmaker improve clarity and usefulness.</p>
          </div>
        ) : null}

        {gate?.kind === "cover" ? (
          <div className="space-y-2">
            <Label>Cover direction</Label>
            <div className="flex flex-wrap gap-1.5">
              {COVER_STYLES.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  onClick={() =>
                    setGate((current) => (current && current.kind === "cover" ? { ...current, style: style.key } : current))
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px]",
                    gate.style === style.key ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CreditGateDialog>

      <BookmakerPurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        initialView={purchaseView ?? undefined}
        onPurchased={() => void refreshEntitlement()}
      />
    </div>
  );
};

/** Small shield row keeps the safety copy in the outline sidebar consistent. */
function ShieldRow() {
  return (
    <>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Check className="h-3 w-3 text-primary" />
      </span>
      Failed AI operations are refunded automatically. Duplicate clicks cannot charge you twice.
    </>
  );
}

export default Bookmaker;
