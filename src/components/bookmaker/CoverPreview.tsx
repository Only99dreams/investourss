import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BookmakerBook, CoverLayout } from "@/lib/bookmaker";
import { COVER_LAYOUTS, coverLayoutForStyle, coverPalette, purposeLabel, resolveTheme } from "@/lib/bookmaker";
import { resolveBookBackCoverUrl, resolveBookCoverUrl } from "@/lib/bookmakerApi";
import { coverBackdropSvg, coverMotifSvg } from "@/lib/bookExport";

interface CoverPreviewProps {
  book: BookmakerBook;
  authorName?: string;
  className?: string;
  compact?: boolean;
  /** Front cover (default) or the optional back cover. */
  side?: "front" | "back";
}

/**
 * Cover preview used in the wizard and dashboard history.
 * Uploads are stored already cropped to A5, so every cover is drawn at the A5
 * ratio (148 × 210 mm) and fills the page edge to edge.
 */
export function CoverPreview({ book, authorName, className, compact = false, side = "front" }: CoverPreviewProps) {
  const theme = resolveTheme(book);
  const cover = book.cover;
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  // Uploaded covers live in a private bucket, so every viewer resolves a fresh
  // signed link for their own book instead of using a permanent public URL.
  useEffect(() => {
    let alive = true;
    if (side === "back") {
      if (!cover?.back || (!cover.back.path && !cover.back.url)) {
        setCoverUrl(null);
        return;
      }
      setCoverUrl(null);
      void resolveBookBackCoverUrl(cover).then((url) => {
        if (alive) setCoverUrl(url);
      });
      return () => {
        alive = false;
      };
    }
    if (cover?.kind !== "uploaded" || (!cover.path && !cover.url)) {
      setCoverUrl(null);
      return;
    }
    setCoverUrl(null);
    void resolveBookCoverUrl(cover).then((url) => {
      if (alive) setCoverUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [cover, side]);

  const isUploaded =
    side === "back"
      ? Boolean(cover?.back?.path || cover?.back?.url)
      : cover?.kind === "uploaded" && Boolean(cover.path || cover.url);

  if (isUploaded) {
    const label = side === "back" ? "Back cover" : "Cover";
    return (
      <div
        className={cn("relative aspect-[148/210] overflow-hidden rounded-xl border border-border/60 bg-muted", className)}
        aria-label={`${label} of ${book.title || "your book"}`}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`${label} of ${book.title || "your book"}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (side === "back") {
    return <GeneratedBackCover book={book} authorName={authorName} className={className} compact={compact} />;
  }

  const design = cover?.design;
  const palette = coverPalette(book);
  const style = design?.style ?? "bold-editorial";
  const layout: CoverLayout = COVER_LAYOUTS.includes(design?.layout as CoverLayout)
    ? (design?.layout as CoverLayout)
    : coverLayoutForStyle(style);
  const align = layout === "centered" ? "center" : "left";
  const headline = design?.headline || book.title || "Your Book Title";
  const subheadline = design?.subheadline || book.subtitle || "";
  const tagline = design?.tagline || purposeLabel(book);
  const headlineScale = headline.length > 70 ? "7.2cqw" : headline.length > 52 ? "7.9cqw" : "8.6cqw";
  const padding = layout === "split" ? (compact ? "9% 7% 9% 12%" : "10% 8.5% 10% 14%") : compact ? "8%" : "9.5%";

  const containerStyle: CSSProperties = {
    containerType: "inline-size",
    background: palette.background,
    color: palette.text,
  };

  return (
    <div
      className={cn("relative aspect-[148/210] overflow-hidden rounded-xl border border-black/5 shadow-md", className)}
      style={containerStyle}
      aria-label={`Cover of ${book.title || "your book"}`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: coverBackdropSvg(palette) }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: coverMotifSvg(design?.motif ?? "orbit", palette) }}
      />
      {layout === "split" ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: "4%", background: palette.accent }}
          aria-hidden="true"
        />
      ) : null}
      {layout === "framed" ? (
        <div
          className="pointer-events-none absolute"
          style={{ inset: compact ? "5%" : "6%", border: `1px solid ${palette.text}`, opacity: 0.38 }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className="relative z-10 flex h-full flex-col"
        style={{
          padding,
          textAlign: align,
          justifyContent: layout === "centered" ? "center" : "space-between",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: theme.headingFont,
              fontSize: compact
                ? `clamp(10px, ${headlineScale}, 30px)`
                : `clamp(18px, ${headlineScale}, 56px)`,
              lineHeight: 1.04,
              fontWeight: 700,
              letterSpacing: style === "bold-editorial" ? "-0.02em" : "0",
              display: "-webkit-box",
              WebkitLineClamp: compact ? 4 : 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
              maxWidth: layout === "centered" ? "96%" : "100%",
              marginLeft: align === "center" ? "auto" : undefined,
              marginRight: align === "center" ? "auto" : undefined,
            }}
          >
            {headline}
          </h3>
          {subheadline ? (
            <p
              style={{
                margin: layout === "centered" ? "5% auto 0" : "6% 0 0",
                fontFamily: theme.bodyFont,
                fontSize: compact ? "clamp(6px, 3cqw, 11px)" : "clamp(9px, 3.2cqw, 17px)",
                lineHeight: 1.45,
                opacity: 0.9,
                maxWidth: layout === "centered" ? "92%" : "90%",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                overflowWrap: "anywhere",
              }}
            >
              {subheadline}
            </p>
          ) : null}
        </div>

        <div
          className="flex flex-col"
          style={{
            gap: compact ? "4%" : "6%",
            alignItems: align === "center" ? "center" : "flex-start",
            paddingBottom: "2%",
          }}
        >
          <div style={{ width: "22%", height: 2, background: palette.accent }} />
          <p
            style={{
              margin: 0,
              fontFamily: theme.bodyFont,
              fontSize: compact ? "clamp(4px, 2cqw, 8px)" : "clamp(7px, 2.5cqw, 13px)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: 0.82,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {tagline}
          </p>
          {authorName ? (
            <p
              style={{
                margin: 0,
                fontFamily: theme.headingFont,
                fontSize: compact ? "clamp(5px, 2.4cqw, 10px)" : "clamp(8px, 3cqw, 15px)",
                fontWeight: 600,
              }}
            >
              {authorName}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Back covers get a quiet, typographic layout built from the same palette as
 * the front. It prints as the final page even when the member has not uploaded
 * a custom back cover.
 */
function GeneratedBackCover({
  book,
  authorName,
  className,
  compact,
}: {
  book: BookmakerBook;
  authorName?: string;
  className?: string;
  compact: boolean;
}) {
  const theme = resolveTheme(book);
  const palette = coverPalette(book);
  const abstract = String(book.outline?.abstract ?? "")
    .replace(/[*_#>`]/g, "")
    .trim();
  const blurb = abstract || book.subtitle || purposeLabel(book);

  return (
    <div
      className={cn("relative aspect-[148/210] overflow-hidden rounded-xl border border-black/5 shadow-md", className)}
      style={{ containerType: "inline-size", background: palette.background, color: palette.text }}
      aria-label={`Back cover of ${book.title || "your book"}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: coverBackdropSvg(palette) }}
      />
      <div
        className="relative z-10 flex h-full flex-col justify-between"
        style={{ padding: compact ? "9%" : "11%" }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: theme.bodyFont,
              fontSize: compact ? "clamp(4px, 2cqw, 8px)" : "clamp(7px, 2.4cqw, 12px)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: 0.72,
            }}
          >
            About the book
          </p>
          <h3
            style={{
              margin: compact ? "5% 0 0" : "6% 0 0",
              fontFamily: theme.headingFont,
              fontSize: compact ? "clamp(8px, 4.6cqw, 18px)" : "clamp(15px, 5.6cqw, 32px)",
              lineHeight: 1.12,
              fontWeight: 700,
              overflowWrap: "anywhere",
            }}
          >
            {book.title || "Your book title"}
          </h3>
          <p
            style={{
              margin: compact ? "6% 0 0" : "7% 0 0",
              fontFamily: theme.bodyFont,
              fontSize: compact ? "clamp(5px, 2.5cqw, 9px)" : "clamp(8px, 3cqw, 14px)",
              lineHeight: 1.6,
              opacity: 0.9,
              display: "-webkit-box",
              WebkitLineClamp: compact ? 7 : 9,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {blurb}
          </p>
        </div>
        <div>
          <div style={{ width: "22%", height: 2, background: palette.accent }} />
          {authorName ? (
            <p
              style={{
                margin: compact ? "5% 0 0" : "6% 0 0",
                fontFamily: theme.headingFont,
                fontSize: compact ? "clamp(5px, 2.6cqw, 10px)" : "clamp(8px, 3.1cqw, 15px)",
                fontWeight: 600,
              }}
            >
              {authorName}
            </p>
          ) : null}
          <p
            style={{
              margin: compact ? "3% 0 0" : "4% 0 0",
              fontFamily: theme.bodyFont,
              fontSize: compact ? "clamp(4px, 1.8cqw, 7px)" : "clamp(6px, 2.1cqw, 10px)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: 0.55,
            }}
          >
            Bookmaker by Investours
          </p>
        </div>
      </div>
    </div>
  );
}

export default CoverPreview;
