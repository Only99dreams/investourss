import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Edit3,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type BookmakerBook, bookWordCount, resolveTheme, wordCount } from "@/lib/bookmaker";
import { findVisualBlocks, renderChapterHtml } from "@/lib/bookmakerMarkup";

interface BookPreviewProps {
  book: BookmakerBook;
  authorName?: string;
  activeChapter?: number;
  onActiveChapterChange?: (index: number) => void;
  onEditChapter?: (index: number) => void;
  onRegenerateChapter?: (index: number) => void;
  onRegenerateVisual?: (chapterIndex: number, blockIndex: number) => void;
  onToggleApproved?: (index: number) => void;
  approvedChapters?: number[];
  busy?: boolean;
  busyChapter?: number | null;
  className?: string;
}

export function BookPreview({
  book,
  authorName,
  activeChapter,
  onActiveChapterChange,
  onEditChapter,
  onRegenerateChapter,
  onRegenerateVisual,
  onToggleApproved,
  approvedChapters = [],
  busy = false,
  busyChapter = null,
  className,
}: BookPreviewProps) {
  const theme = resolveTheme(book);
  const chapters = book.chapters ?? [];
  const [internalActive, setInternalActive] = useState(0);
  const resolvedActive = typeof activeChapter === "number" ? activeChapter : internalActive;

  useEffect(() => {
    if (resolvedActive > chapters.length - 1) {
      const next = Math.max(0, chapters.length - 1);
      if (typeof activeChapter === "number") onActiveChapterChange?.(next);
      else setInternalActive(next);
    }
  }, [chapters.length, resolvedActive, activeChapter, onActiveChapterChange]);

  const chapter = chapters[Math.min(resolvedActive, Math.max(chapters.length - 1, 0))];
  const visuals = useMemo(() => (chapter ? findVisualBlocks(chapter.content) : []), [chapter]);
  const isApproved = chapter ? approvedChapters.includes(chapter.number - 1) : false;

  const selectChapter = (index: number) => {
    if (typeof activeChapter !== "number") setInternalActive(index);
    onActiveChapterChange?.(index);
  };

  if (chapters.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border bg-card p-10 text-center", className)}>
        <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
        <h3 className="text-lg font-semibold">Your manuscript will appear here</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Generate the outline, then write the manuscript. You can edit every chapter and approve the ones you want to keep.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-3 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 truncate font-medium">{book.title || "Untitled book"}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">{bookWordCount(book).toLocaleString("en-NG")} words</Badge>
          {authorName ? <span className="hidden text-xs text-muted-foreground sm:inline">by {authorName}</span> : null}
        </div>
        {chapter && onToggleApproved ? (
          <Button
            size="sm"
            variant={isApproved ? "default" : "outline"}
            onClick={() => onToggleApproved(chapter.number - 1)}
            className="shrink-0 gap-1.5"
          >
            {isApproved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {isApproved ? "Approved" : "Approve chapter"}
          </Button>
        ) : null}
      </div>

      <div className="grid lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-muted/20 lg:max-h-[78vh] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block">
            {chapters.map((item, index) => {
              const approved = approvedChapters.includes(index);
              const active = index === resolvedActive;
              return (
                <button
                  key={`${item.number}-${index}`}
                  onClick={() => selectChapter(index)}
                  className={cn(
                    "flex w-[168px] shrink-0 items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors lg:mb-1 lg:w-full",
                    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
                  )}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {item.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium lg:whitespace-normal">{item.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {wordCount(item.content).toLocaleString("en-NG")} words
                      {approved ? <span className="text-emerald-600">· approved</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <article
          className="lg:max-h-[78vh] lg:overflow-y-auto"
          style={{ background: theme.palette.background, color: theme.palette.text }}
        >
          {chapter ? (
            <>
              <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-black/5 bg-white/85 px-3 py-2 backdrop-blur sm:top-16 sm:px-4 lg:top-0">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                    Chapter {chapter.number}
                  </Badge>
                  {chapter.status ? (
                    <span className="text-[11px] capitalize text-muted-foreground">{chapter.status}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {onEditChapter ? (
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => onEditChapter(chapter.number - 1)}>
                      <Edit3 className="h-3.5 w-3.5" /> Edit
                    </Button>
                  ) : null}
                  {onRegenerateChapter ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={busy}
                      onClick={() => onRegenerateChapter(chapter.number - 1)}
                    >
                      {busyChapter === chapter.number - 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">Regenerate · 1 credit</span>
                      <span className="sm:hidden">Regenerate</span>
                    </Button>
                  ) : null}
                </div>
              </div>

              {visuals.length > 0 && onRegenerateVisual ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-black/5 bg-black/[0.02] px-3 py-2 sm:px-4">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Visuals
                  </span>
                  {visuals.map((visual, index) => (
                    <Button
                      key={`${visual.index}-${visual.start}`}
                      size="sm"
                      variant="ghost"
                      className="h-7 max-w-full gap-1 rounded-full border border-black/10 px-2 text-[10px]"
                      disabled={busy}
                      onClick={() => onRegenerateVisual(chapter.number - 1, index)}
                      title={`Refresh the ${visual.kind} visual (1 credit)`}
                    >
                      <Wand2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{visual.title || visual.kind}</span>
                    </Button>
                  ))}
                </div>
              ) : null}

              <div className="overflow-x-hidden px-4 py-5 sm:px-5 sm:py-7 md:px-9 md:py-10">
                <div dangerouslySetInnerHTML={{ __html: renderChapterHtml(chapter, theme, { showNumber: false }) }} />
              </div>
            </>
          ) : null}
        </article>
      </div>
    </div>
  );
}

export default BookPreview;
