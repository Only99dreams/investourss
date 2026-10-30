import type { BookTheme } from "./bookmaker";

/**
 * A small, safe parser for the book markup produced by Bookmaker.
 *
 * The manuscript is untrusted AI/user text, so every piece of content is
 * escaped before it becomes HTML. Only the structured visuals are generated
 * as SVG by this module.
 */

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "code"; text: string }
  | { type: "callout"; title: string; body: string; variant: "tip" | "note" | "warning" | "quote" }
  | { type: "keypoints"; title: string; items: string[] }
  | { type: "checklist"; title: string; items: { text: string; checked: boolean }[] }
  | { type: "diagram"; title: string; nodes: string[]; edges: { from: string; to: string; label?: string }[] }
  | { type: "chart"; title: string; unit?: string; data: { label: string; value: number }[] }
  | { type: "figure"; title: string; caption?: string; alt?: string; src?: string };

export interface VisualBlock {
  index: number;
  start: number;
  end: number;
  raw: string;
  kind: string;
  title: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function safeUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  if (/^https?:\/\//i.test(url) || url.startsWith("#")) return url.replace(/"/g, "%22");
  return null;
}

export function renderInline(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);padding:1px 5px;border-radius:4px;font-size:0.9em;">$1</code>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">${label}</a>` : label;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  return text;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isTableSeparator = (line: string): boolean => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());

function parseCalloutVariant(title: string, body: string): "tip" | "note" | "warning" | "quote" {
  const haystack = `${title} ${body}`.toLowerCase();
  if (/warning|caution|important|avoid|mistake/.test(haystack)) return "warning";
  if (/quote|remember|reflect/.test(haystack)) return "quote";
  if (/note|definition|context/.test(haystack)) return "note";
  return "tip";
}

function bodyParagraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 10px;">${renderInline(part).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function parseVisualBlock(kind: string, title: string, body: string): Block {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

  if (kind === "keypoints") {
    const items = lines.filter((l) => /^[-*+]\s+/.test(l)).map((l) => l.replace(/^[-*+]\s+/, "").trim());
    return { type: "keypoints", title: title || "Key takeaways", items: items.length ? items : lines };
  }

  if (kind === "checklist") {
    const items = lines
      .filter((l) => /^[-*+]\s+/.test(l))
      .map((l) => l.replace(/^[-*+]\s+/, "").trim())
      .map((l) => {
        const checked = /^\[[xX]\]\s*/.test(l);
        return { text: l.replace(/^\[[ xX]\]\s*/, ""), checked };
      });
    return { type: "checklist", title: title || "Action checklist", items };
  }

  if (kind === "diagram") {
    const edges: { from: string; to: string; label?: string }[] = [];
    let unitLabel = "";
    for (const line of lines) {
      if (/^caption\s*:/i.test(line)) continue;
      const parts = line.split(/\s*(?:->|→|=>)\s*/);
      if (parts.length >= 2) {
        const from = parts[0].trim();
        const right = parts.slice(1).join(" -> ").trim();
        const labelSplit = right.split(/\s*:\s*/);
        const to = (labelSplit.shift() ?? "").trim();
        const label = labelSplit.join(": ").trim() || undefined;
        if (from && to) edges.push({ from, to, label });
      } else if (line && !unitLabel) {
        unitLabel = line;
      }
    }
    let nodes = Array.from(new Set(edges.flatMap((edge) => [edge.from, edge.to])));
    if (nodes.length === 0) {
      nodes = lines.slice(0, 8);
      for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i], to: nodes[i + 1] });
    }
    return { type: "diagram", title: title || "How it fits together", nodes: nodes.slice(0, 8), edges };
  }

  if (kind === "chart") {
    let unit = "";
    const data: { label: string; value: number }[] = [];
    for (const line of lines) {
      const unitMatch = line.match(/^\(?\s*unit\s*:\s*(.+?)\)?$/i);
      if (unitMatch) {
        unit = unitMatch[1].trim();
        continue;
      }
      if (/^caption\s*:/i.test(line)) continue;
      const splitAt = line.lastIndexOf("|");
      if (splitAt < 0) continue;
      const label = line.slice(0, splitAt).trim();
      const raw = line.slice(splitAt + 1).replace(/[^0-9.,-]/g, "").replace(/,/g, "");
      const value = Number.parseFloat(raw);
      if (label && Number.isFinite(value)) data.push({ label, value });
    }
    return { type: "chart", title: title || "At a glance", unit, data: data.slice(0, 8) };
  }

  if (kind === "figure") {
    let caption = "";
    let alt = "";
    let src = "";
    for (const line of lines) {
      if (/^caption\s*:/i.test(line)) caption = line.replace(/^caption\s*:/i, "").trim();
      else if (/^alt\s*:/i.test(line)) alt = line.replace(/^alt\s*:/i, "").trim();
      else if (/^src\s*:/i.test(line)) src = line.replace(/^src\s*:/i, "").trim();
    }
    return {
      type: "figure",
      title: title || "Visual summary",
      caption: caption || lines.filter((l) => !/^(caption|alt|src)\s*:/i.test(l)).join(" ").trim() || undefined,
      alt: alt || undefined,
      src: safeUrl(src) ?? undefined,
    };
  }

  // Default (and unknown custom types) become a readable callout.
  return {
    type: "callout",
    title: title || (kind === "callout" ? "Good to know" : kind.replace(/[_-]/g, " ")),
    body: lines.join("\n"),
    variant: parseCalloutVariant(title, body),
  };
}

export function parseBookMarkup(markdown: string | null | undefined): Block[] {
  const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i++;
      continue;
    }

    // Fenced code
    if (/^```/.test(line)) {
      const language = line.replace(/^```/, "").trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", text: body.join("\n") || (language ? `${language} code block` : "") });
      continue;
    }

    // Custom visual block
    const open = line.match(/^:::([a-z][a-z0-9_-]*)\s*(.*)$/i);
    if (open && !/^:::\s*$/.test(line)) {
      const kind = open[1].toLowerCase();
      const title = open[2].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(parseVisualBlock(kind, title, body.join("\n")));
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(Math.max(heading[1].length, 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: heading[2].trim() });
      i++;
      continue;
    }

    // Divider
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line)) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Block quote
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    // Lists
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const candidate = lines[i];
        const match = candidate.trim().match(/^([-*+]|\d+[.)])\s+(.*)$/);
        if (match) {
          items.push(match[2].trim());
          i++;
        } else if (candidate.startsWith("  ") && candidate.trim() && items.length) {
          items[items.length - 1] += ` ${candidate.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: collect until a blank line or another block marker.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i];
      const trimmed = candidate.trim();
      if (!trimmed) break;
      if (
        /^:::[a-z]/i.test(trimmed) ||
        /^#{1,4}\s+/.test(trimmed) ||
        /^```/.test(trimmed) ||
        /^>\s?/.test(trimmed) ||
        /^([-*+]|\d+[.)])\s+/.test(trimmed) ||
        (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paragraph.push(trimmed);
      i++;
    }
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    else i++;
  }

  return blocks;
}

export function findVisualBlocks(content: string | null | undefined): VisualBlock[] {
  const text = String(content ?? "");
  const re = /^:::([a-z][a-z0-9_-]*)[^\n]*[\s\S]*?^:::\s*$/gim;
  const result: VisualBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const openLine = raw.split("\n")[0].trim();
    const title = openLine.replace(/^:::[a-z0-9_-]+\s*/i, "").trim();
    result.push({
      index: result.length,
      start: match.index,
      end: match.index + raw.length,
      raw,
      kind: match[1].toLowerCase(),
      title,
    });
  }
  return result;
}

export function replaceVisualBlock(content: string, index: number, replacement: string): string {
  const blocks = findVisualBlocks(content);
  const target = blocks[index];
  if (!target) return content;
  return content.slice(0, target.start) + replacement.trim() + content.slice(target.end);
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function svgWrap(width: number, height: number, body: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;height:auto;">${body}</svg>`;
}

function truncateLabel(value: string, limit: number): string {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function renderDiagramSvg(
  block: Extract<Block, { type: "diagram" }>,
  theme: BookTheme,
): string {
  const nodes = block.nodes.slice(0, 8);
  if (nodes.length === 0) return "";
  const width = 660;
  const rowHeight = 96;
  const height = Math.max(200, nodes.length * rowHeight + 30);
  const nodeWidth = 260;
  const nodeHeight = 52;
  const centerX = width / 2 - 40;
  const palette = theme.palette;

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    positions.set(node, { x: centerX, y: 42 + index * rowHeight });
  });

  const edges = block.edges
    .map((edge, index) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to || edge.from === edge.to) return "";
      const fromY = from.y + nodeHeight;
      const toY = to.y;
      const midY = (fromY + toY) / 2;
      const label = edge.label
        ? `<text x="${from.x + 14}" y="${midY + 4}" font-family="${escapeHtml(theme.bodyFont)}" font-size="11" fill="${palette.muted}">${escapeHtml(truncateLabel(edge.label, 46))}</text>`
        : "";
      return `<path d="M ${from.x} ${fromY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${toY - 8}" fill="none" stroke="${palette.accent}" stroke-width="2" marker-end="url(#arrow-${index})" opacity="0.85"/><defs><marker id="arrow-${index}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${palette.accent}"/></marker></defs>${label}`;
    })
    .join("");

  const boxes = nodes
    .map((node, index) => {
      const { x, y } = positions.get(node)!;
      const fill = index === 0 ? palette.primary : palette.background;
      const text = index === 0 ? palette.background : palette.text;
      return `<g><rect x="${x - nodeWidth / 2}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="12" fill="${fill}" stroke="${palette.primary}" stroke-width="1.5"/><text x="${x}" y="${y + nodeHeight / 2 + 5}" text-anchor="middle" font-family="${escapeHtml(theme.bodyFont)}" font-size="13" font-weight="600" fill="${text}">${escapeHtml(truncateLabel(node, 32))}</text></g>`;
    })
    .join("");

  return svgWrap(width, height, `<rect width="${width}" height="${height}" fill="${rgba(palette.surface, 0.55)}" rx="16"/>${edges}${boxes}`);
}

export function renderChartSvg(
  block: Extract<Block, { type: "chart" }>,
  theme: BookTheme,
): string {
  const data = block.data.slice(0, 8);
  if (data.length === 0) return "";
  const width = 660;
  const rowHeight = 46;
  const height = Math.max(170, data.length * rowHeight + 54);
  const labelWidth = 190;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barMax = width - labelWidth - 96;
  const palette = theme.palette;

  const rows = data
    .map((item, index) => {
      const y = 26 + index * rowHeight;
      const barWidth = Math.max(4, (Math.abs(item.value) / max) * barMax);
      const negative = item.value < 0;
      return `<g>
        <text x="0" y="${y + 17}" font-family="${escapeHtml(theme.bodyFont)}" font-size="12" fill="${palette.text}">${escapeHtml(truncateLabel(item.label, 26))}</text>
        <rect x="${labelWidth}" y="${y + 3}" width="${barWidth}" height="22" rx="6" fill="${negative ? palette.accent : palette.primary}" opacity="${negative ? 0.7 : 0.9}"/>
        <text x="${labelWidth + barWidth + 10}" y="${y + 19}" font-family="${escapeHtml(theme.bodyFont)}" font-size="12" font-weight="600" fill="${palette.text}">${escapeHtml(item.value.toLocaleString("en-NG"))}${block.unit ? ` ${escapeHtml(block.unit)}` : ""}</text>
      </g>`;
    })
    .join("");

  return svgWrap(width, height, `<rect width="${width}" height="${height}" fill="${rgba(palette.surface, 0.6)}" rx="16"/><line x1="${labelWidth - 10}" y1="18" x2="${labelWidth - 10}" y2="${height - 16}" stroke="${rgba(palette.muted, 0.35)}" stroke-width="1"/>${rows}`);
}

export function renderFigureSvg(
  block: Extract<Block, { type: "figure" }>,
  theme: BookTheme,
): string {
  const palette = theme.palette;
  const title = truncateLabel(block.title, 48);
  return svgWrap(
    660,
    240,
    `<rect width="660" height="240" rx="18" fill="${palette.primary}"/>
     <circle cx="570" cy="58" r="120" fill="${rgba(palette.accent, 0.22)}"/>
     <circle cx="620" cy="196" r="90" fill="${rgba(palette.background, 0.08)}"/>
     <path d="M40 170 C 150 90, 260 230, 380 140 S 560 90, 630 150" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.85"/>
     <text x="40" y="76" font-family="${escapeHtml(theme.headingFont)}" font-size="12" letter-spacing="2.5" fill="${palette.accent}">VISUAL NOTE</text>
     <text x="40" y="118" font-family="${escapeHtml(theme.headingFont)}" font-size="26" font-weight="700" fill="${palette.background}">${escapeHtml(title)}</text>
     <text x="40" y="142" font-family="${escapeHtml(theme.bodyFont)}" font-size="12" fill="${rgba(palette.background, 0.75)}">A designed summary — use it to anchor the idea in the reader's mind.</text>`,
  );
}

function renderCallout(block: Extract<Block, { type: "callout" }>, theme: BookTheme): string {
  const palette = theme.palette;
  const color = block.variant === "warning" ? "#b45309" : block.variant === "quote" ? palette.primary : palette.accent;
  const background = block.variant === "warning" ? "rgba(245,158,11,0.12)" : rgba(palette.surface, 0.75);
  return `<aside style="margin:22px 0;padding:16px 18px;border-left:4px solid ${color};background:${background};border-radius:0 12px 12px 0;page-break-inside:avoid;">
    <p style="margin:0 0 8px;font-family:${theme.headingFont};font-size:14px;font-weight:700;color:${color};letter-spacing:0.02em;">${escapeHtml(block.title)}</p>
    <div style="margin:0;color:${palette.text};font-size:13.5px;line-height:1.65;">${bodyParagraphs(block.body)}</div>
  </aside>`;
}

function renderTable(block: Extract<Block, { type: "table" }>, theme: BookTheme): string {
  const palette = theme.palette;
  const headers = block.headers
    .map(
      (cell) =>
        `<th style="background:${palette.surface};border:1px solid ${rgba(palette.muted, 0.25)};padding:9px 11px;text-align:left;font-size:12px;color:${palette.text};font-weight:700;">${renderInline(cell)}</th>`,
    )
    .join("");
  const rows = block.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="border:1px solid ${rgba(palette.muted, 0.22)};padding:8px 11px;font-size:12px;line-height:1.5;color:${palette.text};vertical-align:top;">${renderInline(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<div style="margin:22px 0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;page-break-inside:auto;"><thead>${headers ? `<tr>${headers}</tr>` : ""}</thead><tbody>${rows}</tbody></table></div>`;
}

export function renderBlocksToHtml(blocks: Block[], theme: BookTheme): string {
  const scrollableVisual = (html: string) =>
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><div style="min-width:520px;">${html}</div></div>`;

  return blocks
    .map((block) => {
      const p = theme.palette;
      switch (block.type) {
        case "heading":
          return `<h${block.level + 1} style="font-family:${theme.headingFont};font-size:${block.level === 2 ? "20px" : block.level === 3 ? "17px" : "15px"};line-height:1.3;color:${p.primary};margin:28px 0 10px;page-break-after:avoid;">${renderInline(block.text)}</h${block.level + 1}>`;
        case "paragraph":
          return `<p style="margin:0 0 14px;color:${p.text};font-size:14px;line-height:1.75;">${renderInline(block.text)}</p>`;
        case "list":
          return `<${block.ordered ? "ol" : "ul"} style="margin:0 0 16px;padding-left:24px;color:${p.text};font-size:14px;line-height:1.7;">${block.items
            .map((item) => `<li style="margin:4px 0;">${renderInline(item)}</li>`)
            .join("")}</${block.ordered ? "ol" : "ul"}>`;
        case "table":
          return renderTable(block, theme);
        case "quote":
          return `<blockquote style="margin:20px 0;padding:4px 0 4px 18px;border-left:3px solid ${p.accent};color:${p.muted};font-family:${theme.headingFont};font-size:15px;font-style:italic;line-height:1.7;">${bodyParagraphs(block.text)}</blockquote>`;
        case "divider":
          return `<hr style="border:0;border-top:1px solid ${rgba(p.muted, 0.25)};margin:26px 0;" />`;
        case "code":
          return `<pre style="margin:20px 0;padding:14px;border-radius:10px;background:${p.surface};color:${p.text};font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-x:auto;">${escapeHtml(block.text)}</pre>`;
        case "callout":
          return renderCallout(block, theme);
        case "keypoints":
          return `<section style="margin:22px 0;padding:16px 18px;border-radius:14px;background:${rgba(p.primary, 0.07)};border:1px solid ${rgba(p.primary, 0.16)};page-break-inside:avoid;">
            <p style="margin:0 0 10px;font-family:${theme.headingFont};font-size:14px;font-weight:700;color:${p.primary};">${escapeHtml(block.title)}</p>
            <ul style="margin:0;padding-left:20px;color:${p.text};font-size:13.5px;line-height:1.65;">${block.items
              .map((item) => `<li style="margin:5px 0;">${renderInline(item)}</li>`)
              .join("")}</ul>
          </section>`;
        case "checklist":
          return `<section style="margin:22px 0;padding:16px 18px;border-radius:14px;background:${rgba(p.accent, 0.08)};border:1px solid ${rgba(p.accent, 0.22)};page-break-inside:avoid;">
            <p style="margin:0 0 10px;font-family:${theme.headingFont};font-size:14px;font-weight:700;color:${p.text};">${escapeHtml(block.title)}</p>
            <ul style="margin:0;padding:0;list-style:none;color:${p.text};font-size:13.5px;line-height:1.6;">${block.items
              .map(
                (item) =>
                  `<li style="margin:6px 0;display:flex;gap:9px;align-items:flex-start;"><span style="width:17px;height:17px;border-radius:4px;border:1.5px solid ${p.accent};display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:${p.accent};flex:0 0 auto;margin-top:2px;">${item.checked ? "✓" : ""}</span><span>${renderInline(item.text)}</span></li>`,
              )
              .join("")}</ul>
          </section>`;
        case "diagram":
          return `<figure style="margin:24px 0;page-break-inside:avoid;">
            ${block.title ? `<figcaption style="margin-bottom:9px;font-family:${theme.headingFont};font-size:13px;font-weight:700;color:${p.text};">${escapeHtml(block.title)}</figcaption>` : ""}
            ${scrollableVisual(renderDiagramSvg(block, theme))}
          </figure>`;
        case "chart":
          return `<figure style="margin:24px 0;page-break-inside:avoid;">
            ${block.title ? `<figcaption style="margin-bottom:9px;font-family:${theme.headingFont};font-size:13px;font-weight:700;color:${p.text};">${escapeHtml(block.title)}</figcaption>` : ""}
            ${scrollableVisual(renderChartSvg(block, theme))}
          </figure>`;
        case "figure":
          if (block.src) {
            return `<figure style="margin:24px 0;page-break-inside:avoid;">
              <img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || block.title)}" style="display:block;max-width:100%;height:auto;border-radius:12px;" />
              ${block.caption ? `<figcaption style="margin-top:8px;font-size:11.5px;line-height:1.5;color:${p.muted};">${renderInline(block.caption)}</figcaption>` : ""}
            </figure>`;
          }
          return `<figure style="margin:24px 0;page-break-inside:avoid;">
            ${scrollableVisual(renderFigureSvg(block, theme))}
            ${block.caption ? `<figcaption style="margin-top:9px;font-size:11.5px;line-height:1.55;color:${p.muted};">${renderInline(block.caption)}</figcaption>` : ""}
          </figure>`;
        default:
          return "";
      }
    })
    .join("\n");
}

export function renderChapterHtml(
  chapter: { number: number; title: string; content: string },
  theme: BookTheme,
  options: { showNumber?: boolean } = {},
): string {
  const blocks = parseBookMarkup(chapter.content);
  return `<section class="book-chapter" style="font-family:${theme.bodyFont};">
    <div style="margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid ${theme.palette.accent};">
      <p style="margin:0 0 4px;font-family:${theme.bodyFont};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${theme.palette.muted};">${options.showNumber === false ? "" : `Chapter ${chapter.number}`}</p>
      <h2 style="margin:0;font-family:${theme.headingFont};font-size:26px;line-height:1.22;color:${theme.palette.primary};">${escapeHtml(chapter.title)}</h2>
    </div>
    ${renderBlocksToHtml(blocks, theme)}
  </section>`;
}

export { escapeHtml, rgba };
