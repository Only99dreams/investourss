import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Headphones,
  Loader2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AudiobookChapter,
  type AudiobookFullFile,
  type BookmakerBook,
  type BookmakerEntitlement,
  audiobookVoiceLabel,
  formatDuration,
} from "@/lib/bookmaker";
import { consumeAudioDownload, getAudioDownloadStatus, resolveAudiobookUrls } from "@/lib/bookmakerApi";
import { useToast } from "@/hooks/use-toast";

interface AudiobookPlayerProps {
  book: BookmakerBook;
  busy?: boolean;
  busyChapter?: number | null;
  progress?: { done: number; total: number };
  assembling?: boolean;
  error?: string | null;
  onAssemble?: () => Promise<BookmakerBook | null>;
  onRegenerate?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  stopping?: boolean;
  onNeedCredits?: () => void;
  onEntitlement?: (entitlement: BookmakerEntitlement) => void;
  className?: string;
}

/**
 * Chapter-by-chapter narration player. Narration lives in a private bucket, so
 * the player signs the stored object paths for the owner and plays/downloads
 * those short-lived links without another edge-function round trip.
 */
export function AudiobookPlayer({
  book,
  busy = false,
  busyChapter = null,
  progress,
  assembling = false,
  error = null,
  onAssemble,
  onRegenerate,
  onResume,
  onStop,
  stopping = false,
  onNeedCredits,
  onEntitlement,
  className,
}: AudiobookPlayerProps) {
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadAllPending, setDownloadAllPending] = useState(false);

  const audiobook = book.audiobook ?? null;
  const chapters = useMemo<AudiobookChapter[]>(
    () => [...(audiobook?.chapters ?? [])].sort((a, b) => Number(a.number) - Number(b.number)),
    [audiobook?.chapters],
  );
  const full = audiobook?.full ?? null;
  const status = audiobook?.status ?? null;
  const active = chapters.find((chapter) => Number(chapter.number) === activeNumber) ?? null;
  const totalSeconds = chapters.reduce((total, chapter) => total + (Number(chapter.durationSeconds) || 0), 0);
  const writtenChapters = (book.chapters ?? []).filter((chapter) => String(chapter.content ?? "").trim().length > 0);
  const totalToNarrate = progress?.total ?? writtenChapters.length;
  const done = progress?.done ?? chapters.length;
  const percent = totalToNarrate > 0 ? Math.min(100, Math.round((done / totalToNarrate) * 100)) : 0;

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [downloadLimits, setDownloadLimits] = useState<{
    freeLimit: number;
    cost: number;
    items: Record<string, number>;
  }>({ freeLimit: 3, cost: 4, items: {} });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);

  useEffect(() => {
    if (!audiobook) return;
    let alive = true;
    void getAudioDownloadStatus(book.id).then((status) => {
      if (!alive || !status.success) return;
      setDownloadLimits({
        freeLimit: Number(status.free_limit) || 3,
        cost: Number(status.cost) || 4,
        items: status.items ?? {},
      });
    });
    return () => {
      alive = false;
    };
  }, [audiobook, book.id]);

  useEffect(() => {
    let alive = true;
    if (!audiobook) {
      setSignedUrls({});
      return;
    }
    void resolveAudiobookUrls(audiobook).then((urls) => {
      if (alive) setSignedUrls(urls);
    });
    return () => {
      alive = false;
    };
  }, [audiobook]);

  const sourceFor = (entry: AudiobookChapter | AudiobookFullFile | null | undefined) => {
    if (!entry) return "";
    return (entry.path ? signedUrls[entry.path] : "") || entry.url || "";
  };

  // Stop playback when the selected source disappears (e.g. the user starts a
  // new narration pass and the old files are replaced).
  useEffect(() => {
    if (activeNumber !== null && !chapters.some((chapter) => Number(chapter.number) === activeNumber)) {
      audioRef.current?.pause();
      setActiveNumber(null);
      setPlaying(false);
    }
  }, [activeNumber, chapters]);

  useEffect(() => {
    const element = audioRef.current;
    return () => {
      element?.pause();
    };
  }, []);

  const playChapter = (chapter: AudiobookChapter) => {
    const element = audioRef.current;
    if (!element) return;
    setPlaybackError(null);

    const source = sourceFor(chapter);
    if (!source) {
      setPlaybackError("This chapter is still loading. Try again in a moment.");
      return;
    }

    if (activeNumber === Number(chapter.number)) {
      if (element.paused) {
        void element.play().catch(() => setPlaybackError("Your browser blocked playback. Tap play again."));
      } else {
        element.pause();
      }
      return;
    }

    setActiveNumber(Number(chapter.number));
    element.src = source;
    element.currentTime = 0;
    void element.play().catch(() => setPlaybackError("This audio could not start. Try downloading the chapter instead."));
  };

  const playFull = () => {
    const element = audioRef.current;
    const source = sourceFor(full);
    if (!element || !source) return;
    setPlaybackError(null);
    setActiveNumber(null);
    if (element.src === source && !element.paused) {
      element.pause();
      return;
    }
    element.src = source;
    element.currentTime = 0;
    void element.play().catch(() => setPlaybackError("This file is too large to stream. Download it instead."));
  };

  const downloadName = (suffix: string) => {
    const slug = (book.title || "audiobook")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "audiobook";
    return `${slug}-${suffix}.wav`;
  };

  // Signed storage links are cross-origin, so the `download` attribute alone is
  // ignored by some browsers. Fetch a blob when the file is a manageable size
  // and fall back to opening the file when it is too large for memory.
  const saveAudio = async (source: string, name: string, bytes?: number) => {
    if (!source) return;
    if ((bytes ?? 0) > 40 * 1024 * 1024) {
      window.open(source, "_blank", "noopener");
      return;
    }
    setDownloading(name);
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 4000);
    } catch {
      window.open(source, "_blank", "noopener");
    } finally {
      setDownloading(null);
    }
  };

  const downloadHint = (itemKey: string, compact: boolean) => {
    const used = downloadLimits.items[itemKey] ?? 0;
    const left = Math.max(downloadLimits.freeLimit - used, 0);
    if (left > 0) {
      return compact ? `${left}/${downloadLimits.freeLimit} free` : `${left} of ${downloadLimits.freeLimit} free downloads left`;
    }
    return compact ? `${downloadLimits.cost} credits` : `${downloadLimits.cost} credits per download`;
  };

  /** Asks the server to grant one download before anything is saved. */
  const requestDownload = async (itemKey: string) => {
    setDownloadError(null);
    setNeedsCredits(false);
    try {
      const result = await consumeAudioDownload(book.id, itemKey);
      if (result.entitlement) onEntitlement?.(result.entitlement);
      if (!result.success) {
        setDownloadError(result.message || "This download could not start.");
        setNeedsCredits(result.reason === "insufficient_credits");
        return false;
      }
      setDownloadLimits((current) => ({
        ...current,
        items: {
          ...current.items,
          [itemKey]: Number(result.used ?? (current.items[itemKey] ?? 0) + 1),
        },
      }));
      if (!result.free) {
        toast({
          title: "Download charged",
          description: `${result.cost ?? 0} credit${(result.cost ?? 0) === 1 ? "" : "s"} used from your credit pack.`,
        });
      }
      return true;
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "This download could not start.");
      return false;
    }
  };

  const downloadChapter = async (chapter: AudiobookChapter) => {
    const source = sourceFor(chapter);
    if (!source || downloading) return;
    if (!(await requestDownload(`chapter-${chapter.number}`))) return;
    await saveAudio(source, downloadName(`chapter-${chapter.number}`), chapter.bytes);
  };

  const downloadFull = async () => {
    if (downloadAllPending || downloading) return;
    const fullSource = sourceFor(full);
    if (fullSource) {
      if (!(await requestDownload("full"))) return;
      await saveAudio(fullSource, downloadName("full"), full?.bytes);
      return;
    }
    if (!onAssemble || assembling || busy) return;
    setDownloadAllPending(true);
    try {
      const updated = await onAssemble();
      const combined = updated?.audiobook?.full;
      if (!combined) return;
      if (!(await requestDownload("full"))) return;
      // The combined file was just written, so sign it directly instead of
      // waiting for the parent to hand back a refreshed book.
      const combinedSource = combined.path
        ? (await resolveAudiobookUrls({ full: combined }))[combined.path] ?? combined.url ?? ""
        : combined.url ?? "";
      await saveAudio(combinedSource, downloadName("full"), combined.bytes);
    } finally {
      setDownloadAllPending(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "ready" ? "secondary" : status === "failed" ? "destructive" : "outline"} className="gap-1">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Headphones className="h-3 w-3" />}
          {busy ? "Narrating" : status === "ready" ? "Audiobook ready" : status === "failed" ? "Narration stopped" : "No audio yet"}
        </Badge>
        {audiobook?.voice ? (
          <span className="text-xs text-muted-foreground">{audiobookVoiceLabel(audiobook.voice)}</span>
        ) : null}
        {totalSeconds > 0 ? (
          <span className="text-xs text-muted-foreground">· {formatDuration(totalSeconds)} total</span>
        ) : null}
      </div>

      {busy ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Radio className="h-3.5 w-3.5 text-primary" />
              {busyChapter ? `Narrating chapter ${busyChapter}` : "Preparing the narrator"}
            </span>
            <span className="text-muted-foreground">
              {done}/{totalToNarrate || "?"}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Each chapter is saved as soon as it is voiced. You can stop and keep what is already done.
          </p>
          {onStop ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={stopping}
              className="mt-2 w-full gap-1.5 sm:w-auto"
            >
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              Stop and keep finished chapters
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      {playbackError ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{playbackError}</span>
        </div>
      ) : null}

      {downloadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="min-w-0 flex-1 break-words">{downloadError}</span>
          {needsCredits && onNeedCredits ? (
            <Button size="sm" variant="outline" onClick={onNeedCredits} className="shrink-0">
              Buy credits
            </Button>
          ) : null}
        </div>
      ) : null}

      {chapters.length > 0 ? (
        <div className="space-y-2">
          {full ? (
            <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Complete audiobook</p>
                <p className="text-[11px] text-muted-foreground">
                  {full.durationSeconds ? `${formatDuration(full.durationSeconds)} · ` : ""}one WAV file ·{" "}
                  {downloadHint("full", false)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={playFull} disabled={!sourceFor(full)} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Play
                </Button>
                <Button
                  size="sm"
                  onClick={() => void downloadFull()}
                  disabled={!sourceFor(full) || downloadAllPending || downloading === downloadName("full")}
                  className="gap-1.5"
                >
                  {downloading === downloadName("full") ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            {chapters.map((chapter) => {
              const isActive = Number(chapter.number) === activeNumber;
              const source = sourceFor(chapter);
              return (
                <div
                  key={`${chapter.number}-${chapter.updatedAt ?? chapter.path ?? chapter.url}`}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-2.5 transition-colors",
                    isActive ? "border-primary/40 bg-primary/5" : "border-border",
                  )}
                >
                  <Button
                    size="icon"
                    variant={isActive && playing ? "default" : "outline"}
                    onClick={() => playChapter(chapter)}
                    className="h-9 w-9 shrink-0 rounded-full"
                    aria-label={isActive && playing ? `Pause chapter ${chapter.number}` : `Play chapter ${chapter.number}`}
                  >
                    {isActive && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{chapter.title || `Chapter ${chapter.number}`}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      Chapter {chapter.number}
                      {chapter.durationSeconds ? ` · ${formatDuration(chapter.durationSeconds)}` : ""}
                      {busyChapter === Number(chapter.number) ? " · narrating…" : ""} ·{" "}
                      {downloadHint(`chapter-${chapter.number}`, true)}
                    </p>
                  </div>
                  {busyChapter === Number(chapter.number) ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void downloadChapter(chapter)}
                      disabled={!source || downloading === downloadName(`chapter-${chapter.number}`)}
                      className="h-8 w-8 shrink-0"
                      aria-label={`Download chapter ${chapter.number}`}
                    >
                      {downloading === downloadName(`chapter-${chapter.number}`) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            {!full && onAssemble ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadFull()}
                disabled={assembling || busy || downloadAllPending}
                className="flex-1 gap-1.5"
              >
                {assembling || downloadAllPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download all chapters
              </Button>
            ) : null}
            {status === "generating" && onResume && !busy ? (
              <Button variant="outline" size="sm" onClick={onResume} className="flex-1 gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Resume narration
              </Button>
            ) : null}
            {status === "generating" && onStop && !busy ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onStop}
                disabled={stopping}
                className="flex-1 gap-1.5"
              >
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                Stop and refund unused chapters
              </Button>
            ) : null}
            {onRegenerate && !busy && status !== "generating" ? (
              <Button variant="ghost" size="sm" onClick={onRegenerate} className="flex-1 gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Narrate again
              </Button>
            ) : null}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Each chapter and the complete audiobook include {downloadLimits.freeLimit} free downloads. After that, a
            download costs {downloadLimits.cost} credits for this {book.length} book, paid from your credit pack.
          </p>
        </div>
      ) : busy ? null : status === "generating" && onResume ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Narration is paused before any chapter was saved. Resume to finish the book without being charged twice.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button size="sm" variant="outline" onClick={onResume} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Resume narration
            </Button>
            {onStop ? (
              <Button size="sm" variant="ghost" onClick={onStop} disabled={stopping} className="gap-1.5">
                {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                Stop and refund
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
          Generate narration to listen to your book in the car, at the gym, or anywhere you cannot read.
          Each chapter is downloadable on its own.
        </p>
      )}

      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setPlaybackError("This audio could not be played. Try downloading the chapter instead.");
        }}
      />
    </div>
  );
}

export default AudiobookPlayer;
