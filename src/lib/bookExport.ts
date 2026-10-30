import {
  type BookChapter,
  type BookmakerBook,
  type BookTheme,
  bookWordCount,
  coverLayoutForStyle,
  coverPalette,
  formatBookDate,
  purposeLabel,
  resolveTheme,
} from "./bookmaker";
import { escapeHtml, parseBookMarkup, renderBlocksToHtml, renderInline } from "./bookmakerMarkup";

export interface BookExportOptions {
  authorName?: string;
  autoPrint?: boolean;
}

const A5 = {
  width: 148,
  height: 210,
  marginTop: 14,
  marginSide: 14,
  marginBottom: 16,
  footerBottom: 7,
};

let coverArtSequence = 0;

function alpha(hex: string, opacity: number): string {
  const value = String(hex ?? "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(255,255,255,${opacity})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/**
 * Soft gradient/pattern wash that sits under the motif. It gives generated
 * covers depth without using photographs, so they print cleanly and stay sharp
 * at every size.
 */
export function coverBackdropSvg(palette: { primary: string; accent: string; text: string; background: string }): string {
  const uid = `bmback${++coverArtSequence}`;
  return `<svg viewBox="0 0 420 630" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;">
    <defs>
      <radialGradient id="${uid}-glow" cx="84%" cy="8%" r="78%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.42"/>
        <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${uid}-shade" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.34"/>
      </linearGradient>
      <pattern id="${uid}-dots" width="23" height="23" patternUnits="userSpaceOnUse">
        <circle cx="1.2" cy="1.2" r="0.9" fill="rgba(255,255,255,0.13)"/>
      </pattern>
    </defs>
    <rect width="420" height="630" fill="${palette.background}"/>
    <rect width="420" height="630" fill="url(#${uid}-glow)"/>
    <rect width="420" height="630" fill="url(#${uid}-shade)"/>
    <rect width="420" height="630" fill="url(#${uid}-dots)" opacity="0.55"/>
  </svg>`;
}

/**
 * Layered vector motifs used on generated covers. Each motif reads as a small
 * visual metaphor for the book, not a generic decoration, and all of them are
 * resolution-independent so previews look identical to the PDF.
 */
export function coverMotifSvg(motif: string, palette: { primary: string; accent: string; text: string; background: string }): string {
  const uid = `bmmotif${++coverArtSequence}`;
  const accent = palette.accent;
  const soft = "rgba(255,255,255,0.18)";
  const soft2 = "rgba(255,255,255,0.09)";
  const frame = `style="position:absolute;inset:0;width:100%;height:100%;opacity:0.95;"`;
  const corner = (position: "bottom" | "top") =>
    `style="position:absolute;right:-64px;${position === "top" ? "top:-54px" : "bottom:-58px"};width:82%;opacity:0.95;"`;
  const defs = `<defs>
    <radialGradient id="${uid}-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${uid}-line" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="${uid}-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0.08"/>
    </linearGradient>
  </defs>`;

  switch (motif) {
    case "summit":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="304" cy="106" r="96" fill="url(#${uid}-glow)"/><path d="M0 420 L128 188 L204 296 L286 142 L420 420 Z" fill="${soft}"/><path d="M128 188 L156 240 L100 240 Z" fill="${accent}" opacity="0.9"/><path d="M286 142 L320 224 L250 224 Z" fill="${accent}" opacity="0.5"/><path d="M0 420 L128 188 L204 296 L160 420 Z" fill="rgba(0,0,0,0.12)"/><circle cx="304" cy="106" r="34" fill="${accent}" opacity="0.85"/></svg>`;
    case "doorway":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<path d="M78 420 L78 214 A132 132 0 0 1 342 214 L342 420 Z" fill="${soft}"/><path d="M78 420 L78 214 A132 132 0 0 1 342 214 L342 420 Z" fill="url(#${uid}-fade)" opacity="0.28"/><path d="M148 420 L148 228 A62 62 0 0 1 272 228 L272 420 Z" fill="url(#${uid}-fade)" opacity="0.75"/><path d="M30 420 L390 420" stroke="${accent}" stroke-width="3" opacity="0.4"/><circle cx="210" cy="112" r="40" fill="${soft2}"/><circle cx="210" cy="112" r="18" fill="${accent}" opacity="0.9"/></svg>`;
    case "growth":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="308" cy="112" r="104" fill="url(#${uid}-glow)"/>${[64, 116, 170, 236, 316].map((h, i) => `<rect x="${46 + i * 66}" y="${420 - h}" width="38" height="${h}" rx="10" fill="${i >= 3 ? accent : soft}" opacity="${i >= 3 ? 0.92 : 1}"/>`).join("")}<path d="M62 336 L128 282 L194 306 L260 218 L342 132" fill="none" stroke="url(#${uid}-line)" stroke-width="5" stroke-linecap="round"/><circle cx="342" cy="132" r="11" fill="${accent}"/></svg>`;
    case "wave":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}${[0, 1, 2, 3].map((i) => `<path d="M-20 ${282 + i * 42} C 80 ${226 + i * 42}, 150 ${344 + i * 42}, 250 ${274 + i * 42} S 390 ${222 + i * 42}, 450 ${264 + i * 42}" fill="none" stroke="${i === 1 ? `url(#${uid}-line)` : soft}" stroke-width="${i === 1 ? 5 : 2.2}" opacity="${0.95 - i * 0.16}"/>`).join("")}<circle cx="112" cy="94" r="54" fill="${soft2}"/></svg>`;
    case "grid":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}${Array.from({ length: 8 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="420" stroke="${soft}" stroke-width="1"/>`).join("")}${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="420" y2="${i * 60}" stroke="${soft}" stroke-width="1"/>`).join("")}<circle cx="318" cy="106" r="84" fill="url(#${uid}-fade)" opacity="0.8"/><rect x="54" y="238" width="176" height="112" rx="18" fill="none" stroke="${accent}" stroke-width="2.5" opacity="0.75"/></svg>`;
    case "shield":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<path d="M210 26 L364 88 L364 218 C364 312 292 374 210 402 C128 374 56 312 56 218 L56 88 Z" fill="${soft}"/><path d="M210 80 L316 122 L316 218 C316 286 264 330 210 352 C156 330 104 286 104 218 L104 122 Z" fill="url(#${uid}-fade)" opacity="0.62"/><path d="M158 214 L196 252 L272 176" fill="none" stroke="${palette.background}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/></svg>`;
    case "spark":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("top")}>${defs}<circle cx="250" cy="180" r="128" fill="url(#${uid}-glow)"/><path d="M210 16 L246 156 L386 192 L246 228 L210 368 L174 228 L34 192 L174 156 Z" fill="url(#${uid}-fade)" opacity="0.85"/><path d="M210 92 L230 172 L310 192 L230 212 L210 292 L190 212 L110 192 L190 172 Z" fill="${palette.background}" opacity="0.28"/><circle cx="210" cy="192" r="26" fill="${accent}"/></svg>`;
    case "path":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}<path d="M-30 366 C 74 306, 112 386, 200 302 S 300 176, 452 112" fill="none" stroke="url(#${uid}-line)" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 18"/><circle cx="200" cy="302" r="14" fill="${accent}"/><circle cx="200" cy="302" r="30" fill="none" stroke="${alpha(accent, 0.35)}" stroke-width="6"/><circle cx="452" cy="112" r="20" fill="${soft}"/></svg>`;
    case "bloom":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="210" cy="210" r="150" fill="url(#${uid}-glow)" opacity="0.6"/>${Array.from({ length: 10 }, (_, i) => `<ellipse cx="210" cy="124" rx="${i % 2 ? 32 : 42}" ry="${i % 2 ? 86 : 106}" fill="${i % 2 ? soft : soft2}" transform="rotate(${i * 36} 210 210)"/>`).join("")}<circle cx="210" cy="210" r="52" fill="${accent}" opacity="0.8"/><circle cx="210" cy="210" r="20" fill="${palette.background}" opacity="0.35"/></svg>`;
    case "horizon":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}<circle cx="292" cy="150" r="118" fill="url(#${uid}-glow)"/><path d="M0 300 L420 300" stroke="${accent}" stroke-width="3" opacity="0.8"/><path d="M-10 300 L128 196 L228 286 L320 214 L430 300 Z" fill="${soft}"/><path d="M0 300 L128 196 L228 286 L160 420 Z" fill="rgba(0,0,0,0.12)"/><circle cx="292" cy="150" r="46" fill="${accent}" opacity="0.9"/></svg>`;
    case "compass":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="222" cy="222" r="160" fill="none" stroke="${soft}" stroke-width="2.5"/><circle cx="222" cy="222" r="112" fill="none" stroke="${soft2}" stroke-width="2"/><path d="M222 92 L258 222 L222 352 L186 222 Z" fill="${accent}" opacity="0.72"/><path d="M92 222 L222 186 L352 222 L222 258 Z" fill="${soft}"/><circle cx="222" cy="222" r="18" fill="${palette.background}" opacity="0.8"/></svg>`;
    case "stack":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<rect x="96" y="238" width="228" height="52" rx="14" fill="${soft}"/><rect x="76" y="180" width="268" height="48" rx="14" fill="${soft2}"/><rect x="112" y="126" width="196" height="44" rx="14" fill="url(#${uid}-fade)" opacity="0.7"/><rect x="148" y="74" width="124" height="40" rx="12" fill="${accent}" opacity="0.9"/><path d="M210 352 L210 286" stroke="${accent}" stroke-width="4" stroke-linecap="round"/><circle cx="210" cy="368" r="14" fill="${accent}"/></svg>`;
    case "mosaic":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}${Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => { const index = row * 5 + col; const fill = index === 7 || index === 13 || index === 18 ? accent : index % 3 === 0 ? soft : soft2; return `<rect x="${36 + col * 70}" y="${36 + row * 70}" width="58" height="58" rx="12" fill="${fill}" opacity="${index === 7 || index === 13 || index === 18 ? 0.9 : 0.75}"/>`; }).join("")).join("")}</svg>`;
    case "lens":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="218" cy="186" r="132" fill="${soft}"/><circle cx="218" cy="186" r="132" fill="url(#${uid}-glow)" opacity="0.45"/><circle cx="218" cy="186" r="88" fill="none" stroke="${accent}" stroke-width="4"/><circle cx="218" cy="186" r="32" fill="${accent}" opacity="0.9"/><path d="M312 280 L390 358" stroke="${accent}" stroke-width="18" stroke-linecap="round" opacity="0.85"/></svg>`;
    case "constellation":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${frame}>${defs}<circle cx="282" cy="126" r="120" fill="url(#${uid}-glow)" opacity="0.5"/>${[["70","296","196","222"],["196","222","292","128"],["292","128","354","244"],["354","244","184","338"]].map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${alpha(accent, 0.5)}" stroke-width="1.6"/>`).join("")}${[["70","296","9",soft],["196","222","13",accent],["292","128","11",accent],["354","244","8",soft],["184","338","7",soft]].map(([cx, cy, r, fill]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`).join("")}</svg>`;
    case "prism":
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<path d="M210 64 L360 340 L60 340 Z" fill="${soft}"/><path d="M210 64 L282 202 L138 202 Z" fill="url(#${uid}-fade)" opacity="0.75"/><path d="M60 340 L210 64 L360 340" fill="none" stroke="${accent}" stroke-width="2.5" opacity="0.55"/><path d="M96 340 L330 120" stroke="${alpha(accent, 0.45)}" stroke-width="2"/><path d="M120 340 L330 190" stroke="${alpha(accent, 0.3)}" stroke-width="2"/></svg>`;
    case "orbit":
    default:
      return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" ${corner("bottom")}>${defs}<circle cx="224" cy="196" r="158" fill="url(#${uid}-glow)" opacity="0.62"/><circle cx="224" cy="196" r="164" fill="none" stroke="${soft}" stroke-width="2"/><circle cx="224" cy="196" r="118" fill="none" stroke="${soft2}" stroke-width="2"/><circle cx="224" cy="196" r="58" fill="${accent}" opacity="0.8"/><circle cx="224" cy="32" r="17" fill="${accent}"/><circle cx="344" cy="286" r="11" fill="${soft}"/><circle cx="104" cy="300" r="7" fill="${alpha(accent, 0.6)}"/></svg>`;
  }
}

function generatedCoverArt(book: BookmakerBook, theme: BookTheme, authorName?: string): string {
  const design = book.cover?.design;
  const palette = coverPalette(book);
  const style = design?.style ?? "bold-editorial";
  const layout =
    design?.layout === "stacked" ||
    design?.layout === "centered" ||
    design?.layout === "split" ||
    design?.layout === "framed"
      ? design.layout
      : coverLayoutForStyle(style);
  const align = layout === "centered" ? "center" : "left";
  const headline = design?.headline || book.title || "Your Book Title";
  const subheadline = design?.subheadline || book.subtitle || "";
  const tagline = design?.tagline || purposeLabel(book);
  const kicker = "BOOKMAKER BY INVESTOURS";
  const headlineSize =
    headline.length > 72
      ? "21pt"
      : headline.length > 54
        ? "24pt"
        : style === "premium-minimal"
          ? "26pt"
          : style === "bold-editorial"
            ? "32pt"
            : "29pt";

  const frame =
    layout === "framed"
      ? `<div style="position:absolute;inset:6mm;border:1.5px solid ${alpha(palette.text, 0.4)};pointer-events:none;"></div>`
      : "";
  const splitBand =
    layout === "split"
      ? `<div style="position:absolute;left:0;top:0;bottom:0;width:5mm;background:${palette.accent};"></div>`
      : "";
  const paddingLeft = layout === "split" ? "19mm" : layout === "framed" ? "17mm" : "14mm";
  const paddingRight = layout === "framed" ? "17mm" : "13mm";
  const justify = layout === "centered" ? "center" : "space-between";
  const subheadlineMargin = layout === "centered" ? "0 auto" : "5mm 0 0";

  return `<div style="position:relative;width:100%;height:100%;overflow:hidden;background:${palette.background};color:${palette.text};padding:16mm ${paddingRight} 17mm ${paddingLeft};display:flex;flex-direction:column;justify-content:${justify};text-align:${align};">
    ${coverBackdropSvg(palette)}
    ${coverMotifSvg(design?.motif ?? "orbit", palette)}
    ${splitBand}
    ${frame}
    <div style="position:relative;z-index:2;">
      <div style="font-family:${theme.bodyFont};font-size:6pt;letter-spacing:0.24em;text-transform:uppercase;opacity:0.78;margin-bottom:${layout === "centered" ? "8.5mm" : "11mm"};">${escapeHtml(kicker)}</div>
      <h1 style="margin:0;font-family:${theme.headingFont};font-size:${headlineSize};line-height:1.05;letter-spacing:${style === "bold-editorial" ? "-0.02em" : "0"};text-wrap:balance;overflow-wrap:anywhere;max-width:${layout === "centered" ? "108mm" : "115mm"};">${escapeHtml(headline)}</h1>
      ${subheadline ? `<p style="margin:${subheadlineMargin};font-family:${theme.bodyFont};font-size:${headline.length > 60 ? "8.5pt" : "9.5pt"};line-height:1.45;opacity:0.88;overflow-wrap:anywhere;max-width:${layout === "centered" ? "99mm" : "100mm"};${layout === "centered" ? "margin-left:auto;margin-right:auto;" : ""}">${escapeHtml(subheadline)}</p>` : ""}
    </div>
    <div style="position:relative;z-index:2;display:flex;flex-direction:column;gap:4mm;align-items:${align === "center" ? "center" : "flex-start"};">
      <div style="width:20mm;height:2px;background:${palette.accent};"></div>
      <p style="margin:0;font-family:${theme.bodyFont};font-size:7.5pt;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85;overflow-wrap:anywhere;max-width:104mm;">${escapeHtml(tagline)}</p>
      ${authorName ? `<p style="margin:0;font-family:${theme.headingFont};font-size:10pt;">${escapeHtml(authorName)}</p>` : ""}
    </div>
  </div>`;
}

export function coverPageHtml(book: BookmakerBook, theme: BookTheme, authorName?: string): string {
  const cover = book.cover;
  const uploaded = cover?.kind === "uploaded" && cover.url;
  return `<section class="page cover-page" aria-label="Book cover">
    ${
      uploaded
        ? `<div style="width:100%;height:100%;background:${theme.palette.surface};display:flex;align-items:center;justify-content:center;"><img src="${escapeHtml(cover.url)}" alt="${escapeHtml(book.title || "Book cover")}" style="width:100%;height:100%;object-fit:contain;display:block;" /></div>`
        : generatedCoverArt(book, theme, authorName)
    }
  </section>`;
}

function titlePageHtml(book: BookmakerBook, theme: BookTheme, authorName?: string): string {
  return `<section class="page front-page">
    <div class="page-content" style="display:flex;flex-direction:column;justify-content:center;text-align:center;font-family:${theme.bodyFont};">
      <p style="margin:0 0 6mm;font-size:6.5pt;letter-spacing:0.22em;text-transform:uppercase;color:${theme.palette.muted};">${escapeHtml(purposeLabel(book))}</p>
      <h1 style="margin:0;font-family:${theme.headingFont};font-size:21pt;line-height:1.16;color:${theme.palette.primary};">${escapeHtml(book.title || "Untitled Book")}</h1>
      ${book.subtitle ? `<p style="margin:3.5mm auto 0;max-width:88mm;font-size:9.5pt;line-height:1.5;color:${theme.palette.muted};">${escapeHtml(book.subtitle)}</p>` : ""}
      <div style="width:17mm;height:2px;background:${theme.palette.accent};margin:8mm auto;"></div>
      ${authorName ? `<p style="margin:0;font-family:${theme.headingFont};font-size:10.5pt;color:${theme.palette.text};">${escapeHtml(authorName)}</p>` : ""}
      <p style="margin:4mm 0 0;font-size:7pt;color:${theme.palette.muted};">Created ${escapeHtml(formatBookDate(book.created_at))}</p>
      <p style="margin:20mm 0 0;font-size:6pt;letter-spacing:0.12em;text-transform:uppercase;color:${theme.palette.muted};">Bookmaker by Investours</p>
    </div>
    ${footerHtml()}
  </section>`;
}

function tocPageHtml(book: BookmakerBook, theme: BookTheme): string {
  const chapters = book.chapters?.length ? book.chapters : book.outline?.chapters ?? [];
  const rows = chapters
    .map(
      (chapter, index) =>
        `<li class="toc-entry" data-chapter="${index + 1}" style="display:flex;align-items:baseline;gap:6px;margin:0 0 8px;font-family:${theme.bodyFont};font-size:8.5pt;color:${theme.palette.text};">
          <span style="width:6mm;color:${theme.palette.accent};font-weight:700;">${String(index + 1).padStart(2, "0")}</span>
          <span style="flex:1;border-bottom:1px dotted rgba(120,120,120,0.45);padding-bottom:2px;">${escapeHtml(chapter.title)}</span>
          <span class="toc-page" style="min-width:6mm;text-align:right;color:${theme.palette.muted};font-size:7pt;"></span>
        </li>`,
    )
    .join("");

  return `<section class="page front-page">
    <div class="page-content" style="font-family:${theme.bodyFont};">
      <p style="margin:0 0 3mm;font-size:6.5pt;letter-spacing:0.22em;text-transform:uppercase;color:${theme.palette.accent};">Contents</p>
      <h1 style="margin:0 0 7mm;font-family:${theme.headingFont};font-size:18pt;color:${theme.palette.primary};">What's inside</h1>
      <ol style="margin:0;padding:0;list-style:none;">${rows || `<li style="color:${theme.palette.muted};">Your outline will appear here.</li>`}</ol>
    </div>
    ${footerHtml()}
  </section>`;
}

function footerHtml(): string {
  return `<div class="page-footer"><span>Bookmaker by Investours</span><span class="footer-page"></span></div>`;
}

function chapterFlowHtml(chapter: BookChapter, index: number, theme: BookTheme): string {
  const blocks = parseBookMarkup(chapter.content);
  const blockHtml = blocks
    .map((block) => `<div class="flow-block">${renderBlocksToHtml([block], theme)}</div>`)
    .join("");
  return `<div class="flow-block chapter-open" data-chapter="${index + 1}" style="page-break-before:always;">
      <div style="margin-bottom:4mm;padding-bottom:3mm;border-bottom:2px solid ${theme.palette.accent};">
        <p style="margin:0 0 1.5mm;font-family:${theme.bodyFont};font-size:6.5pt;letter-spacing:0.2em;text-transform:uppercase;color:${theme.palette.muted};">Chapter ${index + 1}</p>
        <h2 style="margin:0;font-family:${theme.headingFont};font-size:19pt;line-height:1.15;color:${theme.palette.primary};">${escapeHtml(chapter.title)}</h2>
      </div>
    </div>
    ${blockHtml}`;
}

function pageTemplateHtml(): string {
  return `<template id="page-template"><section class="page"><div class="page-content"></div>${footerHtml()}</section></template>`;
}

const PRINT_CSS = `
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { background: #e8e6ee; font-family: 'DM Sans', Arial, sans-serif; color: #1f1730; }
  .toolbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; background: #1f1730; color: #fff; }
  .toolbar p { margin: 0; font-size: 12px; opacity: 0.8; }
  .toolbar .actions { display: flex; gap: 8px; }
  .toolbar button { border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; background: #b58b2a; color: #16101f; }
  .toolbar button.secondary { background: rgba(255,255,255,0.14); color: #fff; }
  #book-pages { padding: 18px 0 40px; }
  .page { position: relative; width: ${A5.width}mm; height: ${A5.height}mm; margin: 0 auto 10mm; background: #fff; box-shadow: 0 4px 22px rgba(31,23,48,0.16); padding: ${A5.marginTop}mm ${A5.marginSide}mm ${A5.marginBottom}mm; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cover-page { padding: 0; }
  .page-content { height: ${A5.height - A5.marginTop - A5.marginBottom}mm; overflow: hidden; position: relative; }
  .page-footer { position: absolute; left: ${A5.marginSide}mm; right: ${A5.marginSide}mm; bottom: ${A5.footerBottom}mm; display: flex; justify-content: space-between; gap: 10px; border-top: 1px solid #e6e1ee; padding-top: 1.5mm; font-size: 6.5pt; letter-spacing: 0.04em; color: #8a8298; }
  #book-flow { position: absolute; left: -9999px; top: 0; width: ${A5.width - A5.marginSide * 2}mm; visibility: hidden; }
  .flow-block { break-inside: avoid; page-break-inside: avoid; }
  .flow-block > *:first-child { margin-top: 0; }
  .flow-block > *:last-child { margin-bottom: 0; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    #book-pages { padding: 0; }
    .page { margin: 0; box-shadow: none; }
  }
`;

const PAGINATION_SCRIPT = `
(function () {
  function paginate() {
    var flow = document.getElementById('book-flow');
    var host = document.getElementById('book-pages');
    var template = document.getElementById('page-template');
    if (!flow || !host || !template) return;
    var items = Array.prototype.slice.call(flow.children);
    var content = null;
    var currentPage = null;

    function newPage() {
      var node = template.content.firstElementChild.cloneNode(true);
      host.appendChild(node);
      currentPage = node;
      content = node.querySelector('.page-content');
      return content;
    }

    items.forEach(function (item) {
      var startsChapter = item.classList.contains('chapter-open');
      if (!content || (startsChapter && content.childElementCount > 0)) newPage();
      content.appendChild(item);
      if (content.scrollHeight > content.clientHeight + 2 && content.childElementCount > 1) {
        var last = content.lastElementChild;
        content.removeChild(last);
        newPage();
        content.appendChild(last);
      }
    });

    flow.parentNode.removeChild(flow);
    if (template.parentNode) template.parentNode.removeChild(template);

    // Fill table-of-contents page numbers.
    var allPages = Array.prototype.slice.call(document.querySelectorAll('#book-pages .page'));
    var contentPages = allPages.filter(function (p) { return !p.classList.contains('cover-page'); });
    contentPages.forEach(function (page, index) {
      page.dataset.pageNumber = String(index + 1);
      var footer = page.querySelector('.footer-page');
      if (footer) footer.textContent = 'Page ' + (index + 1) + ' of ' + contentPages.length;
    });

    document.querySelectorAll('.toc-entry').forEach(function (entry) {
      var target = document.querySelector('#book-pages .chapter-open[data-chapter="' + entry.getAttribute('data-chapter') + '"]');
      var page = target ? target.closest('.page') : null;
      var label = entry.querySelector('.toc-page');
      if (label) label.textContent = page && page.dataset.pageNumber ? page.dataset.pageNumber : '';
    });

    document.body.classList.add('paginated');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(paginate, 60); });
  else setTimeout(paginate, 60);

  window.bookmakerPrint = function () { window.print(); };
})();
`;

export function buildBookDocument(book: BookmakerBook, options: BookExportOptions = {}): string {
  const theme = resolveTheme(book);
  const authorName = options.authorName?.trim() || "";
  const chapters = (book.chapters ?? []).filter((chapter) => chapter && chapter.content);
  const flow = chapters.length
    ? chapters.map((chapter, index) => chapterFlowHtml(chapter, index, theme)).join("")
    : `<div class="flow-block"><p style="font-size:12pt;color:${theme.palette.muted};">This book does not have a manuscript yet. Return to Bookmaker to write it.</p></div>`;
  const words = bookWordCount(book).toLocaleString("en-NG");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(book.title || "Bookmaker Book")}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="toolbar">
    <div>
      <strong>${escapeHtml(book.title || "Your book")}</strong>
      <p>${escapeHtml(book.length)} book · ${words} words · A5 print-ready</p>
    </div>
    <div class="actions">
      <button class="secondary" onclick="window.close()">Close</button>
      <button onclick="window.bookmakerPrint()">Save as PDF / Print</button>
    </div>
  </div>

  <main id="book-pages">
    ${coverPageHtml(book, theme, authorName)}
    ${titlePageHtml(book, theme, authorName)}
    ${tocPageHtml(book, theme)}
  </main>

  <div id="book-flow">${flow}</div>
  ${pageTemplateHtml()}
  <script>${PAGINATION_SCRIPT}</script>
  ${options.autoPrint === false ? "" : `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 700); });</script>`}
</body>
</html>`;
}

/**
 * Opens the print-ready A5 document in a new window. The browser's print
 * dialog is the PDF export path (no extra dependency, no server render).
 */
export function downloadBookPDF(book: BookmakerBook, options: BookExportOptions = {}): boolean {
  const html = buildBookDocument(book, { autoPrint: true, ...options });
  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups so Bookmaker can prepare your PDF.");
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}

export function openBookPrintPreview(book: BookmakerBook, options: BookExportOptions = {}): boolean {
  const html = buildBookDocument(book, { autoPrint: false, ...options });
  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups so Bookmaker can show the print preview.");
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}

export { renderInline };
