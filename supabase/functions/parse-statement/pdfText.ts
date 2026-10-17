/**
 * Rebuild readable text AND a transaction table from pdf.js text items.
 *
 * pdf-parse's built-in page renderer joins every text item on the same visual
 * line with NO separator (`text += item.str`). Bank statements place each
 * column (date, description, amount, balance) as its own item, so the built-in
 * renderer produces jammed rows such as "12/07/26POS PURCHASE5,000.00612,000.00"
 * which the transaction parser cannot read.
 *
 * itemsToText groups items into rows by their y-position, orders each row by
 * x-position and inserts a single space wherever two items are separated by a
 * horizontal gap (a real column/word boundary), keeping items that merely
 * continue the same word glued together.
 *
 * itemsToTable goes further: it anchors columns on the statement's own header
 * row (using each item's x-position) and emits a real grid. This repairs
 * "column-grouped" exports — where the PDF lists every date, then every
 * description, then every amount — because rows are regrouped by y-position and
 * columns by x-position, independent of the order items arrive in. It is fully
 * deterministic; no AI is involved.
 *
 * NOTE: `parse-statement/index.ts` inlines the very same implementation (the
 * guarded `itemsToText` / `itemsToTable` blocks) so the edge function stays a
 * single-file deploy. `pdfText.test.mjs` asserts the copies stay identical, so
 * always edit both together.
 */

export interface PdfTextItem {
  str?: string;
  /** pdf.js transform matrix: [a, b, c, d, x, y] */
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

// >>> itemsToText
interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  eol: boolean;
}

function buildRuns(items: PdfTextItem[]): Run[] {
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
  return runs;
}

// Group runs into visual rows. Top-to-bottom, then left-to-right. PDF y
// increases upwards, so a larger y is higher on the page.
function groupIntoRows(runs: Run[]): Run[][] {
  if (runs.length === 0) return [];
  const ordered = runs.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Run[][] = [];
  let current: Run[] | null = null;
  let currentY = 0;
  let previousEndedLine = false;
  for (const run of ordered) {
    const tolerance = Math.max(1.5, run.height * 0.5);
    const sameRow = current !== null && !previousEndedLine && Math.abs(currentY - run.y) <= tolerance;
    if (!sameRow) {
      current = [];
      currentY = run.y;
      rows.push(current);
    }
    current!.push(run);
    previousEndedLine = run.eol;
  }
  return rows;
}

// Join a row's runs left-to-right, inserting a space at column/word boundaries
// (a small gap is intra-word kerning; a larger gap is a boundary).
function joinRuns(row: Run[]): string {
  const sorted = row.slice().sort((a, b) => a.x - b.x);
  let line = "";
  let previousEndX: number | undefined;
  let previousHeight = sorted[0]?.height ?? 10;
  for (const run of sorted) {
    if (previousEndX !== undefined) {
      const gap = run.x - previousEndX;
      const threshold = Math.max(0.75, Math.min(previousHeight, run.height) * 0.15);
      if (gap > threshold) line += " ";
    }
    line += run.str;
    previousEndX = run.x + run.width;
    previousHeight = run.height;
  }
  return line.replace(/[ \t]+/g, " ").trim();
}

export function itemsToText(items: PdfTextItem[]): string {
  const lines = groupIntoRows(buildRuns(items)).map((row) => joinRuns(row));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// <<< itemsToText

// >>> itemsToTable
interface ColumnAnchor {
  x: number;
  end: number;
}

// Vocabulary that names a statement column. Kept generic (no bank names).
const HEADER_TOKEN = /\b(date|time|description|narration|particulars|details|memo|remarks|balance|debit|debits|credit|credits|amount|withdrawal|withdrawals|deposit|deposits|reference|ref|type|direction|dr|cr)\b/i;
const MONEY_TOKEN = /\b(balance|debit|debits|credit|credits|amount|withdrawal|withdrawals|deposit|deposits|dr|cr)\b/i;

function headerScore(row: Run[]): number {
  let score = 0;
  for (const run of row) if (HEADER_TOKEN.test(run.str)) score += 1;
  return score;
}

// A header row names at least two columns and includes money vocabulary (or a
// date + description pair). This is what stops a title or a stray data row from
// being mistaken for the column definition.
function isHeaderRow(row: Run[]): boolean {
  if (headerScore(row) < 2) return false;
  const text = row.map((run) => run.str).join(" ");
  return MONEY_TOKEN.test(text) || (/\bdate\b/i.test(text) && /(description|narration|particulars|details)/i.test(text));
}

// Merge header runs that are separated by a word gap into single column labels
// (e.g. "Transaction" + "Date" must become one anchor, not two).
function headerAnchors(row: Run[]): ColumnAnchor[] {
  const sorted = row.slice().sort((a, b) => a.x - b.x);
  const anchors: ColumnAnchor[] = [];
  for (const run of sorted) {
    const previous = anchors[anchors.length - 1];
    const threshold = Math.max(0.75, run.height * 0.15);
    if (previous && run.x - previous.end <= threshold) {
      previous.end = Math.max(previous.end, run.x + run.width);
    } else {
      anchors.push({ x: run.x, end: run.x + run.width });
    }
  }
  return anchors;
}

function findAnchors(rows: Run[][]): ColumnAnchor[] | null {
  let best: Run[] | null = null;
  let bestScore = 0;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    if (!isHeaderRow(rows[i])) continue;
    const score = headerScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      best = rows[i];
    }
  }
  return best ? headerAnchors(best) : null;
}

// Assign every run in a row to its nearest column anchor (by left edge) and
// join the runs that land in the same column.
function buildTable(rows: Run[][], anchors: ColumnAnchor[]): string[][] {
  return rows.map((row) => {
    const buckets: Run[][] = anchors.map(() => []);
    for (const run of row) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const distance = Math.abs(run.x - anchors[i].x);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      buckets[best].push(run);
    }
    return buckets.map((bucket) => joinRuns(bucket));
  });
}

// Build one table across every page. Columns are anchored on the first page
// that carries a header, then applied to all pages so continuation pages without
// a repeated header still line up.
export function pagesToTable(pages: PdfTextItem[][]): string[][] {
  const pagesOfRows = pages.map((items) => groupIntoRows(buildRuns(items)));
  let anchors: ColumnAnchor[] | null = null;
  for (const rows of pagesOfRows) {
    anchors = findAnchors(rows);
    if (anchors) break;
  }
  if (!anchors) {
    // No header anywhere: fall back to one cell per row so the caller can use
    // the plain-text parser instead.
    return pagesOfRows.flat().map((row) => [joinRuns(row)]);
  }
  return pagesOfRows.flatMap((rows) => buildTable(rows, anchors));
}

export function itemsToTable(items: PdfTextItem[]): string[][] {
  return pagesToTable([items]);
}
// <<< itemsToTable
