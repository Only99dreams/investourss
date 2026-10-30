import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Headphones,
  ListMusic,
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
  type BookmakerBook,
  audiobookVoiceLabel,
  formatDuration,
} from "@/lib/bookmaker";

interface AudiobookPlayerProps {
  book: BookmakerBook;
  busy?: boolean;
  busyChapter?: number | null;
  progress?: { done: number; total: number };
  assembling?: boolean;
  error?: string | null;
  onAssemble?: () => void;
  onRegenerate?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  stopping?: boolean;
  className?: string;
}

/**
 * Chapter-by-chapter narration player. Audio is served straight from the
 * public storage bucket, so playback, seeking and downloads never need another
 * edge-function round trip.
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
  className,
}: AudiobookPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

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

    if (activeNumber === Number(chapter.number)) {
      if (element.paused) {
        void element.play().catch(() => setPlaybackError("Your browser blocked playback. Tap play again."));
      } else {
        element.pause();
      }
      return;
    }

    setActiveNumber(Number(chapter.number));
    element.src = chapter.url;
    element.currentTime = 0;
    void element.play().catch(() => setPlaybackError("This audio could not start. Try downloading the chapter instead."));
  };

  const playFull = () => {
    const element = audioRef.current;
    if (!element || !full?.url) return;
    setPlaybackError(null);
    setActiveNumber(null);
    if (element.src === full.url && !element.paused) {
      element.pause();
      return;
    }
    element.src = full.url;
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

  // Public storage URLs are cross-origin, so the `download` attribute alone is
  // ignored by some browsers. Fetch a blob when the file is a manageable size
  // and fall back to opening the file when it is too large for memory.
  const saveAudio = async (url: string, name: string, bytes?: number) => {
    if ((bytes ?? 0) > 40 * 1024 * 1024) {
      window.open(url, "_blank", "noopener");
      return;
    }
    setDownloading(name);
    try {
      const response = await fetch(url);
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
      window.open(url, "_blank", "noopener");
    } finally {
      setDownloading(null);
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

      {chapters.length > 0 ? (
        <div className="space-y-2">
          {full?.url ? (
            <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Complete audiobook</p>
                <p className="text-[11px] text-muted-foreground">
                  {full.durationSeconds ? `${formatDuration(full.durationSeconds)} · ` : ""}one WAV file
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={playFull} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Play
                </Button>
                <Button
                  size="sm"
                  onClick={() => void saveAudio(full.url, downloadName("full"), full.bytes)}
                  disabled={downloading === downloadName("full")}
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
              return (
                <div
                  key={`${chapter.number}-${chapter.updatedAt ?? chapter.url}`}
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
                      {busyChapter === Number(chapter.number) ? " · narrating…" : ""}
                    </p>
                  </div>
                  {busyChapter === Number(chapter.number) ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void saveAudio(chapter.url, downloadName(`chapter-${chapter.number}`), chapter.bytes)}
                      disabled={downloading === downloadName(`chapter-${chapter.number}`)}
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
            {!full?.url && onAssemble ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onAssemble}
                disabled={assembling || busy}
                className="flex-1 gap-1.5"
              >
                {assembling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListMusic className="h-3.5 w-3.5" />}
                Combine into one WAV
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
