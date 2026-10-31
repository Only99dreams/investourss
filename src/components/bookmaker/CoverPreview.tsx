import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BookmakerBook, CoverLayout } from "@/lib/bookmaker";
import { COVER_LAYOUTS, coverLayoutForStyle, coverPalette, purposeLabel, resolveTheme } from "@/lib/bookmaker";
import { resolveBookCoverUrl } from "@/lib/bookmakerApi";
import { coverBackdropSvg, coverMotifSvg } from "@/lib/bookExport";

interface CoverPreviewProps {
  book: BookmakerBook;
  authorName?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Cover preview used in the wizard and dashboard history.
 * Uploaded covers are rendered with `object-contain` so they are never cropped
 * or stretched, whatever aspect ratio the member uploaded.
 */
export function CoverPreview({ book, authorName, className, compact = false }: CoverPreviewProps) {
  const theme = resolveTheme(book);
  const cover = book.cover;
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  // Uploaded covers live in a private bucket, so every viewer resolves a fresh
  // signed link for their own book instead of using a permanent public URL.
  useEffect(() => {
    let alive = true;
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
  }, [cover]);

  const isUploaded = cover?.kind === "uploaded" && Boolean(cover.path || cover.url);

  if (isUploaded) {
    return (
      <div
        className={cn("relative aspect-[2/3] overflow-hidden rounded-xl border border-border/60 bg-muted", className)}
        aria-label={`Cover of ${book.title || "your book"}`}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title || "your book"}`}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />
        )}
      </div>
    );
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
      className={cn("relative aspect-[2/3] overflow-hidden rounded-xl border border-black/5 shadow-md", className)}
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

export default CoverPreview;
