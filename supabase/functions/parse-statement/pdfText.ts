/**
 * Rebuild readable text from pdf.js text items.
 *
 * pdf-parse's built-in page renderer joins every text item on the same visual
 * line with NO separator (`text += item.str`). Bank statements place each
 * column (date, description, amount, balance) as its own item, so the built-in
 * renderer produces jammed rows such as "12/07/26POS PURCHASE5,000.00612,000.00"
 * which the transaction parser cannot read.
 *
 * This renderer groups items into rows by their y-position, orders each row by
 * x-position and inserts a single space wherever two items are separated by a
 * horizontal gap (i.e. a real column/word boundary), while keeping items that
 * merely continue the same word glued together.
 */

export interface PdfTextItem {
  str?: string;
  /** pdf.js transform matrix: [a, b, c, d, x, y] */
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  eol: boolean;
}

export function itemsToText(items: PdfTextItem[]): string {
  const runs: Run[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item.str !== "string" || item.str === "") continue;
    const transform = item.transform ?? [];
    const x = Number.isFinite(transform[4]) ? transform[4] : 0;
    const y = Number.isFinite(transform[5]) ? transform[5] : 0;
    const height = item.height && item.height > 0 ? item.height : Math.abs(transform[3] || 10) || 10;
    runs.push({
      str: item.str,
      x,
      y,
      width: item.width && item.width > 0 ? item.width : 0,
      height,
      eol: Boolean(item.hasEOL),
    });
  }
  if (runs.length === 0) return "";

  // Top-to-bottom, then left-to-right. PDF y increases upwards, so a larger y
  // is higher on the page.
  const ordered = runs
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: { y: number; runs: Run[] }[] = [];
  let current: { y: number; runs: Run[] } | null = null;
  let previousEndedLine = false;
  for (const run of ordered) {
    const tolerance = Math.max(1.5, run.height * 0.5);
    const sameRow = current !== null && !previousEndedLine && Math.abs(current.y - run.y) <= tolerance;
    if (!sameRow) {
      current = { y: run.y, runs: [] };
      rows.push(current);
    }
    current!.runs.push(run);
    previousEndedLine = run.eol;
  }

  const lines = rows.map((row) => {
    const sorted = row.runs.slice().sort((a, b) => a.x - b.x);
    let line = "";
    let previousEndX: number | undefined;
    let previousHeight = sorted[0]?.height ?? 10;
    for (const run of sorted) {
      if (previousEndX !== undefined) {
        const gap = run.x - previousEndX;
        // A small gap is intra-word kerning; a larger gap is a word/column
        // boundary and must become a space so the parser can separate the
        // amount from the running balance.
        const threshold = Math.max(0.75, Math.min(previousHeight, run.height) * 0.15);
        if (gap > threshold) line += " ";
      }
      line += run.str;
      previousEndX = run.x + run.width;
      previousHeight = run.height;
    }
    return line.replace(/[ \t]+/g, " ").trim();
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
