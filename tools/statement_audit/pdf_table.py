"""PDF → table, using OpenCV to "see" the page.

Pipeline per page:

1. Rasterise the page with PDFium (pypdfium2) at a chosen DPI.
2. Let OpenCV look at the ink:

   * Otsu threshold, then long-kernel morphology separates HORIZONTAL and
     VERTICAL rule lines. Their positions give the ruling grid (row bands and
     column bands). That is the strongest possible reading of a ruled
     statement: cells are exact rectangles, so right-aligned amounts, centred
     headers and wrapped text land in the right column even when the visible
     header labels are offset from the data.
   * When there is no usable grid (borderless statements), rows come from a
     y-projection of the ink and columns are anchored on the statement's own
     header row (the approach proven in supabase/functions/parse-statement/pdfText.ts).

3. Text for each cell comes from the PDF text layer (per-character boxes from
   PDFium, grouped into words by OpenCV-computed gaps). When a page has no text
   layer at all (a scan), words are read from the rendered image with Tesseract
   if it is installed.

Nothing here is probabilistic: same file in, same table out.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import pypdfium2 as pdfium

DEFAULT_DPI = 200
# Rows/cols closer together than this are treated as one rule line.
EDGE_CLUSTER_PT = 2.5
# A rule line must be at least this long (points) to count.
MIN_RULE_LENGTH_PT = 20.0
# The smallest frame that can be a table: 3 lines and this much span.
MIN_GRID_SPAN_PT = 18.0
# And most of the page's words have to sit inside it.
MIN_GRID_COVERAGE = 0.5

HEADER_TOKEN = re.compile(
    r"\b(date|time|description|narration|particulars|details|memo|remarks|balance|debit|debits|"
    r"credit|credits|amount|withdrawal|withdrawals|deposit|deposits|reference|ref|type|direction|dr|cr)\b",
    re.I,
)
MONEY_TOKEN = re.compile(
    r"\b(balance|debit|debits|credit|credits|amount|withdrawal|withdrawals|deposit|deposits|dr|cr)\b", re.I
)


@dataclass
class Word:
    """A word box in image space, in PDF points (origin top-left, y grows down)."""

    text: str
    x: float
    y: float
    x2: float
    y2: float

    @property
    def width(self) -> float:
        return self.x2 - self.x

    @property
    def height(self) -> float:
        return max(self.y2 - self.y, 0.5)

    @property
    def center_x(self) -> float:
        return (self.x + self.x2) / 2

    @property
    def center_y(self) -> float:
        return (self.y + self.y2) / 2


@dataclass
class TableExtraction:
    rows: list[list[str]] = field(default_factory=list)
    pages: int = 0
    modes: list[str] = field(default_factory=list)
    ocr_pages: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    lines_text: str = ""
    header_found: bool = False

    @property
    def method(self) -> str:
        if not self.modes:
            return "none"
        unique = sorted(set(self.modes))
        return unique[0] if len(unique) == 1 else "+".join(unique)


# ---------------------------------------------------------------------------
# Rendering + word extraction.
# ---------------------------------------------------------------------------

def render_page(page, dpi: int = DEFAULT_DPI) -> tuple[np.ndarray, np.ndarray, float]:
    """Return (bgr image, grayscale image, scale) for a PDFium page."""
    scale = dpi / 72.0
    bitmap = page.render(scale=scale)
    array = np.asarray(bitmap.to_numpy())
    if array.ndim == 2:
        bgr = cv2.cvtColor(array, cv2.COLOR_GRAY2BGR)
        gray = array
    else:
        channels = array.shape[2]
        if channels == 4:
            bgr = cv2.cvtColor(array, cv2.COLOR_RGBA2BGR)
            gray = cv2.cvtColor(array, cv2.COLOR_RGBA2GRAY)
        else:
            bgr = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
            gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    return bgr, gray, scale


def page_words(page) -> list[Word]:
    """Words from the PDF text layer, with boxes in image space (points)."""
    textpage = page.get_textpage()
    try:
        page_height = page.get_height()
        char_count = textpage.count_chars()
        text = textpage.get_text_range()
        raw: list[tuple[str, float, float, float, float]] = []
        current: list = []  # [texts, x0, y_low_min, x1, y_high_max, baseline]
        previous_end: Optional[float] = None

        def flush() -> None:
            nonlocal current, previous_end
            if current and current[0]:
                raw.append(("".join(current[0]), current[1], current[2], current[3], current[4]))
            current = []
            previous_end = None

        for index in range(char_count):
            char = text[index] if index < len(text) else ""
            if char in ("\r", "\n", "\t") or not char.strip():
                flush()
                continue
            try:
                x0, y_low, x1, y_high = textpage.get_charbox(index)
            except Exception:
                flush()
                continue
            if x1 <= x0 and y_high <= y_low:
                flush()
                continue
            height = max(y_high - y_low, 1.0)
            if current:
                # Split on a real separation, never on a kerning-level gap: the
                # text stream usually carries explicit spaces, and glyph boxes
                # are separated by ~1pt inside a number ("1,000.00" has a 1.2pt
                # gap around its comma). The reference size is the word box
                # built so far, not the incoming glyph: a "," is only ~2pt tall
                # and a "1" is much narrower than its advance, so sizing the
                # test on the incoming glyph shreds numbers. Rows are compared
                # on the BASELINE: a "," or "." sits far below the digits
                # around it, and a lowercase word starts lower than a capital,
                # so comparing box tops or centres also shreds the text.
                word_height = max(current[4] - current[2], height, 1.0)
                gap = x0 - (previous_end if previous_end is not None else x0)
                baseline_shift = abs(y_low - current[5])
                if gap > max(2.0, 0.9 * word_height) or baseline_shift > max(1.5, 0.6 * word_height):
                    flush()
            if current:
                current[1] = min(current[1], x0)
                current[2] = min(current[2], y_low)
                current[3] = max(current[3], x1)
                current[4] = max(current[4], y_high)
            else:
                current = [[], x0, y_low, x1, y_high, y_low]
            current[0].append(char)
            previous_end = x1
        flush()

        return [
            Word(text=word, x=x0, y=page_height - y_high, x2=x1, y2=page_height - y_low)
            for word, x0, y_low, x1, y_high in raw
        ]
    finally:
        textpage.close()


def ocr_words(bgr: np.ndarray, scale: float, min_confidence: float = 30.0) -> list[Word]:
    """Read words from a rendered page with Tesseract (for scanned PDFs)."""
    import pytesseract  # imported lazily so the text-layer path needs no OCR

    data = pytesseract.image_to_data(
        bgr, output_type=pytesseract.Output.DICT, config="--psm 6"
    )
    words: list[Word] = []
    for index, raw in enumerate(data.get("text", [])):
        text = (raw or "").strip()
        if not text:
            continue
        try:
            confidence = float(data["conf"][index])
        except (TypeError, ValueError):
            confidence = -1.0
        if confidence < min_confidence:
            continue
        left = data["left"][index] / scale
        top = data["top"][index] / scale
        width = data["width"][index] / scale
        height = data["height"][index] / scale
        words.append(Word(text=text, x=left, y=top, x2=left + width, y2=top + height))
    return words


def tesseract_available() -> bool:
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Geometry: rows from y-position, columns anchored on the header row.
# ---------------------------------------------------------------------------

def group_into_rows(words: list[Word]) -> list[list[Word]]:
    if not words:
        return []
    # Rows are grouped on the BASELINE of each word box (its bottom edge, in
    # image space): box tops vary with ascenders/capitals and centres with box
    # height, the baseline does not.
    ordered = sorted(words, key=lambda w: (w.y2, w.x))
    rows: list[list[Word]] = []
    current: Optional[list[Word]] = None
    current_y = 0.0
    for word in ordered:
        tolerance = max(1.5, word.height * 0.55)
        same_row = current is not None and abs(current_y - word.y2) <= tolerance
        if not same_row:
            current = []
            current_y = word.y2
            rows.append(current)
        current.append(word)
    return rows


def join_runs(row: list[Word]) -> str:
    if not row:
        return ""
    ordered = sorted(row, key=lambda w: w.x)
    line = ""
    previous_end: Optional[float] = None
    previous_height = ordered[0].height
    for word in ordered:
        if previous_end is not None:
            gap = word.x - previous_end
            threshold = max(0.75, min(previous_height, word.height) * 0.15)
            if gap > threshold:
                line += " "
        line += word.text
        previous_end = word.x2
        previous_height = word.height
    return re.sub(r"[ \t]+", " ", line).strip()


def join_lines(words: list[Word]) -> str:
    """Join a cell's words line by line, so a wrapped description reads in order."""
    return " ".join(join_runs(row) for row in group_into_rows(words) if row)


def header_score(row: list[Word]) -> int:
    return sum(1 for word in row if HEADER_TOKEN.search(word.text))


def is_header_row(row: list[Word]) -> bool:
    if header_score(row) < 2:
        return False
    text = " ".join(word.text for word in row)
    return bool(MONEY_TOKEN.search(text)) or (
        bool(re.search(r"\bdate\b", text, re.I))
        and bool(re.search(r"(description|narration|particulars|details)", text, re.I))
    )


def split_merged_header(row: list[Word]) -> Optional[list[Word]]:
    """Recover header words from a header the reader returned as one wide box.

    A scan's header is sometimes read as a single word-box covering the whole
    line (OCR merged it, or the page has an underline binding the words). Its
    text still names every column, but with one box there is one x-position, so
    `find_anchors` cannot build columns and the page drops to `text` mode — one
    cell per line, no Debit/Credit columns, and nothing for the audit to total.

    The words are recovered in reading order at the box's own left edge. They
    carry no true x-positions, so callers must place them against the columns
    the DATA shows (see `anchors_from_columns`) rather than trusting an even
    spread, which mis-assigns right-aligned amounts.

    Returns None unless the line is a header that splits into at least two
    recognised words, so nothing is invented for a line that is not a header.
    """
    if len(row) != 1:
        return None
    box = row[0]
    if header_score(row) >= 2:
        return None  # already separate words; nothing to recover
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z./&()#-]*", box.text) if HEADER_TOKEN.search(w)]
    if len(words) < 2:
        return None
    # All words are stacked at the box's left edge: an intentional "no position"
    # marker, so `anchors_from_columns` must supply the real columns.
    return [
        Word(text=word, x=box.x, y=box.y, x2=box.x, y2=box.y2)
        for word in words
    ]


def merged_header_names(rows: list[list[Word]]) -> Optional[list[str]]:
    """The header words of the first row that is a (possibly merged) header."""
    for row in rows[:30]:
        if is_header_row(row):
            return [w.text for w in sorted(row, key=lambda w: w.x)]
        recovered = split_merged_header(row)
        if recovered is not None and is_header_row(recovered):
            return [w.text for w in recovered]
    return None


def column_centers(rows: list[list[Word]]) -> list[float]:
    """Distinct x-positions the page's CELLS use, left to right.

    Columns are where the ink is, but a cell may hold several words (a
    description, a grouped amount), so clustering single words splits one column
    into many. Instead each row's words are grouped into cells by the same
    gap rule the table itself uses, and the cells' positions are clustered
    down the page. That yields one centre per column, which is the real geometry
    a merged header lost.
    """
    body = [
        row for row in rows
        if row and not is_header_row(row) and split_merged_header(row) is None
    ]
    if not body:
        return []
    heights = [word.height for row in body for word in row]
    typical = sorted(heights)[len(heights) // 2] if heights else 10.0
    word_gap = max(2.0, typical * 0.9)

    centers: list[float] = []
    for row in body:
        cell_words: list[list[Word]] = []
        for word in sorted(row, key=lambda w: w.x):
            if cell_words:
                previous = cell_words[-1][-1]
                if word.x - previous.x2 <= word_gap:
                    cell_words[-1].append(word)
                    continue
            cell_words.append([word])
        centers.extend(sum(w.center_x for w in cell) / len(cell) for cell in cell_words)

    centers.sort()
    if not centers:
        return []
    gap = max(6.0, typical * 1.5)
    clusters: list[list[float]] = [[centers[0]]]
    for value in centers[1:]:
        if value - clusters[-1][-1] <= gap:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return [sum(cluster) / len(cluster) for cluster in clusters]


MONEY_HEADER_WORDS = (
    "debit", "debits", "credit", "credits", "amount", "withdrawal", "withdrawals",
    "deposit", "deposits", "balance", "dr", "cr",
)


def anchors_from_columns(rows: list[list[Word]], names: list[str]) -> Optional[list[dict]]:
    """Anchors for a merged header, taken from the columns the data uses.

    A merged header's words carry no positions, so the columns come from the
    ink. The header names are placed right-to-left: every money name
    (debit/credit/balance/amount…) takes the next unused cluster from the right,
    in the order the names appear, and the leading names (date, description)
    take the remaining clusters from the left. Right-to-left is what keeps a
    right-aligned Debit/Credit/Balance trio on its own columns.

    Returns None unless every name gets a distinct cluster, rather than putting
    an amount in a column it may not belong to.
    """
    centers = column_centers(rows)
    if not centers:
        return None
    money_names = [
        name for name in names
        if any(word in name.lower() for word in MONEY_HEADER_WORDS)
    ]
    other_names = [name for name in names if name not in money_names]
    if len(centers) < len(names):
        return None
    available = list(centers)
    money_centers = [available.pop() for _ in range(len(money_names))][::-1]
    other_centers = available[: len(other_names)]
    if len(other_centers) != len(other_names):
        return None
    chosen = other_centers + money_centers
    if len(chosen) != len(names) or len(set(chosen)) != len(chosen):
        return None
    return [{"x": center, "end": center} for center in chosen]


def header_anchors(row: list[Word]) -> list[dict]:
    ordered = sorted(row, key=lambda w: w.x)
    anchors: list[dict] = []
    for word in ordered:
        threshold = max(0.75, word.height * 0.15)
        if anchors and word.x - anchors[-1]["end"] <= threshold:
            anchors[-1]["end"] = max(anchors[-1]["end"], word.x2)
        else:
            anchors.append({"x": word.x, "end": word.x2})
    return anchors


def find_anchors(rows: list[list[Word]]) -> Optional[list[dict]]:
    best: Optional[list[Word]] = None
    best_score = 0
    for row in rows[:30]:
        if not is_header_row(row):
            continue
        score = header_score(row)
        if score > best_score:
            best_score = score
            best = row
    if best is not None:
        return header_anchors(best)
    # No header whose words kept their own positions. If the page nevertheless
    # carries a (merged) header, build anchors from the columns the data
    # actually uses, so amounts land in the right Debit/Credit column.
    names = merged_header_names(rows)
    if names:
        return anchors_from_columns(rows, names)
    return None


def place_merged_header(row: list[Word], anchors: list[dict]) -> Optional[list[str]]:
    """Header cells for a row the reader returned as one merged word-box.

    The words name the columns but carry no positions, and the anchors were
    built from the data (see `anchors_from_columns`), so each name is placed in
    the column its kind belongs to: money names (debit/credit/balance/…) fill
    the right-hand columns in reading order, the leading names fill the left.
    Emitting one cell per column is what lets the audit recognise the header —
    a single merged string classifies as just "date" and no columns are read.

    Returns None when the row is not a merged header, or when the names cannot
    be placed one per column, so a non-header row is never rewritten.
    """
    recovered = split_merged_header(row)
    if recovered is None or not is_header_row(recovered) or not anchors:
        return None
    names = [word.text for word in recovered]
    if len(anchors) < len(names):
        return None
    cells = [""] * len(anchors)
    money_names = [name for name in names if any(w in name.lower() for w in MONEY_HEADER_WORDS)]
    other_names = [name for name in names if name not in money_names]
    # Right-hand columns, right to left, for the money names in reading order.
    money_slots = range(len(anchors) - 1, len(anchors) - 1 - len(money_names), -1)
    for name, slot in zip(reversed(money_names), money_slots):
        cells[slot] = name
    for index, name in enumerate(other_names):
        if index < len(anchors):
            cells[index] = name
    return cells


def build_table(rows: list[list[Word]], anchors: list[dict]) -> list[list[str]]:
    table: list[list[str]] = []
    for row in rows:
        header_cells = place_merged_header(row, anchors)
        if header_cells is not None:
            table.append(header_cells)
            continue
        buckets: list[list[Word]] = [[] for _ in anchors]
        for word in row:
            best_index = 0
            best_distance = math.inf
            for index, anchor in enumerate(anchors):
                distance = abs(word.x - anchor["x"])
                if distance < best_distance:
                    best_distance = distance
                    best_index = index
            buckets[best_index].append(word)
        table.append([join_runs(bucket) for bucket in buckets])
    return table


# ---------------------------------------------------------------------------
# OpenCV: the ruling grid.
# ---------------------------------------------------------------------------

def _line_positions(profile: np.ndarray, min_pixels: float, cluster_px: float) -> list[float]:
    """Cluster 1-D ink profile peaks into rule-line positions (pixels)."""
    indices = np.nonzero(profile >= min_pixels)[0]
    if indices.size == 0:
        return []
    clusters: list[list[int]] = [[int(indices[0])]]
    for value in indices[1:]:
        if value - clusters[-1][-1] <= cluster_px:
            clusters[-1].append(int(value))
        else:
            clusters.append([int(value)])
    positions = []
    for cluster in clusters:
        weights = profile[cluster]
        positions.append(float(np.average(cluster, weights=weights)))
    return positions


def detect_grid(gray: np.ndarray, scale: float) -> Optional[dict]:
    """Find rule-line positions. Returns {'row_edges', 'col_edges'} in points."""
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    min_len = max(15, int(MIN_RULE_LENGTH_PT * scale))
    horizontal = cv2.morphologyEx(
        binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (min_len, 1))
    )
    vertical = cv2.morphologyEx(
        binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_len))
    )
    min_pixels = max(10.0, min_len * 0.5)
    cluster_px = max(2.0, EDGE_CLUSTER_PT * scale)
    row_edges = [p / scale for p in _line_positions(horizontal.sum(axis=1).astype(float), min_pixels, cluster_px)]
    col_edges = [p / scale for p in _line_positions(vertical.sum(axis=0).astype(float), min_pixels, cluster_px)]
    if not row_edges and not col_edges:
        return None
    return {"row_edges": row_edges, "col_edges": col_edges}


def _coverage(edges: list[float], values: list[float]) -> float:
    """Share of `values` that fall inside the span of `edges`."""
    if not edges or not values:
        return 0.0
    low, high = edges[0], edges[-1]
    inside = sum(1 for value in values if low <= value <= high)
    return inside / len(values)


def _usable_edges(edges: list[float], values: list[float]) -> bool:
    """Is this set of rule lines the frame of the statement's table?

    Three lines minimum (two rows), a sensible span, and — the real test — most
    of the page's words must sit inside it. A box drawn around a header covers
    almost no text and is rejected here rather than being mistaken for the whole
    table. This deliberately does NOT use a fraction of the page: a short table
    on a tall page is still a table.
    """
    if len(edges) < 3:
        return False
    if (edges[-1] - edges[0]) < MIN_GRID_SPAN_PT:
        return False
    return _coverage(edges, values) >= MIN_GRID_COVERAGE


def _band_words(words: list[Word], edges: list[float], axis: str) -> list[list[Word]]:
    """Bucket words into the intervals delimited by `edges`.

    Returns len(edges) + 1 buckets: the zone before the first line, the zones
    between lines, and the zone after the last line.
    """
    buckets: list[list[Word]] = [[] for _ in range(len(edges) + 1)]
    for word in words:
        value = word.center_y if axis == "y" else word.center_x
        slot = 0
        while slot < len(edges) and value >= edges[slot]:
            slot += 1
        buckets[slot].append(word)
    return buckets


def _rows_from_grid(
    words: list[Word],
    grid: dict,
    anchors: Optional[list[dict]],
    use_col_edges: bool,
) -> list[list[str]]:
    rows: list[list[str]] = []
    bands = _band_words(words, grid["row_edges"], "y")
    last_band = len(bands) - 1
    for index, band in enumerate(bands):
        if not band:
            continue
        # An interior band IS one ruled row: keep it whole so a wrapped
        # description stays with the date, amount and balance it belongs to.
        # The zone above the first rule and the zone below the last one hold
        # unrelated lines (titles, printed totals), so those are split per
        # visual line.
        groups = group_into_rows(band) if index in (0, last_band) else [band]
        for visual_row in groups:
            if use_col_edges:
                cells: list[str] = []
                for column in _band_words(visual_row, grid["col_edges"], "x"):
                    cells.append(join_lines(column))
                rows.append(cells)
            elif anchors:
                header_cells = place_merged_header(visual_row, anchors)
                if header_cells is not None:
                    rows.append(header_cells)
                    continue
                buckets: list[list[Word]] = [[] for _ in anchors]
                for word in visual_row:
                    best_index = 0
                    best_distance = math.inf
                    for anchor_index, anchor in enumerate(anchors):
                        distance = abs(word.x - anchor["x"])
                        if distance < best_distance:
                            best_distance = distance
                            best_index = anchor_index
                    buckets[best_index].append(word)
                rows.append([join_lines(bucket) for bucket in buckets])
            else:
                rows.append([join_runs(visual_row)])
    return rows


def trim_empty_columns(rows: list[list[str]]) -> list[list[str]]:
    if not rows:
        return rows
    width = max(len(row) for row in rows)
    padded = [list(row) + [""] * (width - len(row)) for row in rows]
    keep = [
        column
        for column in range(width)
        if any(re.sub(r"\s+", "", row[column]) for row in padded)
    ]
    if len(keep) == width:
        return padded
    if not keep:
        return []
    return [[row[column] for column in keep] for row in padded]


def build_page_table(
    words: list[Word],
    gray: np.ndarray,
    scale: float,
    anchors: Optional[list[dict]],
    grid: Optional[dict] = None,
) -> tuple[list[list[str]], str]:
    if grid is None:
        grid = detect_grid(gray, scale) if gray is not None else None
    if grid:
        centers_y = [word.center_y for word in words]
        centers_x = [word.center_x for word in words]
        usable_rows = _usable_edges(grid["row_edges"], centers_y)
        usable_cols = _usable_edges(grid["col_edges"], centers_x)
    else:
        usable_rows = False
        usable_cols = False

    if usable_rows and usable_cols:
        return _rows_from_grid(words, grid, anchors, use_col_edges=True), "grid"
    if usable_rows and anchors:
        return _rows_from_grid(words, grid, anchors, use_col_edges=False), "grid-rows"
    if anchors:
        return build_table(group_into_rows(words), anchors), "columns"
    return [[join_runs(row)] for row in group_into_rows(words)], "text"


def draw_debug(bgr: np.ndarray, scale: float, grid: Optional[dict], words: list[Word]):
    canvas = bgr.copy()
    for word in words:
        cv2.rectangle(
            canvas,
            (int(word.x * scale), int(word.y * scale)),
            (int(word.x2 * scale), int(word.y2 * scale)),
            (0, 0, 255),
            1,
        )
    if grid:
        for edge in grid["row_edges"]:
            cv2.line(canvas, (0, int(edge * scale)), (canvas.shape[1], int(edge * scale)), (0, 200, 0), 2)
        for edge in grid["col_edges"]:
            cv2.line(canvas, (int(edge * scale), 0), (int(edge * scale), canvas.shape[0]), (255, 120, 0), 2)
    return canvas


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------

def pdf_to_table(
    path: str,
    dpi: int = DEFAULT_DPI,
    ocr: str = "auto",
    password: Optional[str] = None,
    debug_dir: Optional[str] = None,
    log=None,
) -> TableExtraction:
    """Rasterise every page, see the table with OpenCV, return a cell table."""
    log = log or (lambda message: None)
    extraction = TableExtraction()
    scale = dpi / 72.0

    try:
        document = pdfium.PdfDocument(path, password=password)
    except Exception as error:  # noqa: BLE001 - surfaced to the caller
        raise RuntimeError(f"Could not open PDF: {error}") from error

    try:
        page_count = len(document)
        extraction.pages = page_count
        page_words_cache: list[list[Word]] = []
        page_texts: list[str] = []
        anchors: Optional[list[dict]] = None

        # Pass 1: words per page (cheap) so columns can be anchored on the first
        # page that carries a header, and applied to continuation pages.
        ocr_allowed = ocr in ("auto", "force")
        ocr_checked = False
        ocr_ready = False
        for index in range(page_count):
            page = document[index]
            try:
                words = page_words(page)
                if ocr == "force" or (ocr_allowed and len(words) < 8):
                    if not ocr_checked:
                        ocr_ready = tesseract_available()
                        ocr_checked = True
                    if ocr_ready:
                        log(f"page {index + 1}: no usable text layer, reading it with OCR")
                        try:
                            bgr, _, _ = render_page(page, dpi)
                            words = ocr_words(bgr, scale)
                            extraction.ocr_pages.append(index + 1)
                        except Exception as error:  # noqa: BLE001
                            extraction.warnings.append(
                                f"Page {index + 1}: OCR failed ({error}); using the text layer."
                            )
                    elif ocr in ("auto", "force"):
                        extraction.warnings.append(
                            f"Page {index + 1} looks like a scan and Tesseract is not installed; "
                            "install Tesseract OCR to read it."
                        )
                page_words_cache.append(words)
                text_rows = group_into_rows(words)
                page_texts.append("\n".join(join_runs(row) for row in text_rows))
                if anchors is None:
                    anchors = find_anchors(text_rows)
            finally:
                page.close()

        extraction.header_found = anchors is not None
        extraction.lines_text = "\n".join(text for text in page_texts if text).strip()

        # Pass 2: render each page and build its rows.
        all_rows: list[list[str]] = []
        for index in range(page_count):
            page = document[index]
            try:
                bgr, gray, _ = render_page(page, dpi)
                grid = detect_grid(gray, scale)
                if debug_dir:
                    import os

                    os.makedirs(debug_dir, exist_ok=True)
                    cv2.imwrite(
                        os.path.join(debug_dir, f"page-{index + 1:02d}.png"),
                        draw_debug(bgr, scale, grid, page_words_cache[index]),
                    )
                rows, mode = build_page_table(page_words_cache[index], gray, scale, anchors, grid)
                extraction.modes.append(mode)
                if mode == "text":
                    extraction.warnings.append(
                        f"Page {index + 1}: no column header or ruling found; kept as plain text."
                    )
                all_rows.extend(rows)
            finally:
                page.close()

        extraction.rows = trim_empty_columns(all_rows)
        if not extraction.rows:
            extraction.warnings.append("No text could be read from this PDF.")
        return extraction
    finally:
        document.close()
