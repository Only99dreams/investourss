// Reading an uploaded Excel workbook into the same table shape the auditor
// builds for CSV and PDF uploads. SheetJS is imported lazily inside
// `parseSpreadsheetFile` so it is only downloaded when someone actually uploads
// a workbook, and stays code-split out of the main bundle.

export type SheetTable = (string | number)[][];

// Turn one SheetJS cell into a value the auditor can read. Dates become ISO
// strings (the date parser understands those), numbers stay numeric (so the
// amount parser reads them directly without locale surprises), everything else
// becomes text.
export function toSpreadsheetCell(cell: unknown): string | number {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === "number") return cell;
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return String(cell);
}

// Convert raw SheetJS rows (with `header: 1`, so each row is an array of cells)
// into a clean table, dropping rows that are entirely blank.
export function rowsToTable(rows: unknown[][]): SheetTable {
  return rows
    .map((row) => (Array.isArray(row) ? row.map(toSpreadsheetCell) : []))
    .filter((row) => row.some((cell) => String(cell).trim() !== ""));
}

// A plain-text rendering of the table, used to populate the editable preview.
export function tableToPreview(table: SheetTable): string {
  return table.map((row) => row.map((cell) => String(cell)).join("  ")).join("\n");
}

export async function parseSpreadsheetFile(
  file: File,
): Promise<{ table: SheetTable; preview: string }> {
  const imported = await import("xlsx");
  // Vite serves SheetJS's ESM build (named exports); Node/other tooling may
  // hand back the CJS namespace under `default`. Normalise both.
  const XLSX = (imported as { default?: typeof imported }).default ?? imported;
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
    type: "array",
    cellDates: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("That workbook has no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  const table = rowsToTable(rows);
  return { table, preview: tableToPreview(table) };
}

// Turn CSV/TSV text into the same table shape so it can be shown in the
// spreadsheet preview. SheetJS is reused (already lazy-loaded for workbooks) so
// quoted fields, embedded commas/newlines and a leading BOM are handled the same
// way the auditor's own CSV reader handles them.
export async function parseDelimitedTable(content: string): Promise<SheetTable> {
  if (!content.trim()) return [];
  const imported = await import("xlsx");
  const XLSX = (imported as { default?: typeof imported }).default ?? imported;
  const workbook = XLSX.read(content, { type: "string", raw: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  return rowsToTable(rows);
}

// Save a converted table as a real .xlsx workbook so the user can open the
// statement in Excel. `baseName` (usually the uploaded file name) is reused for
// the download, with the spreadsheet extension swapped in.
export async function downloadTableAsExcel(table: SheetTable, baseName: string): Promise<void> {
  const imported = await import("xlsx");
  const XLSX = (imported as { default?: typeof imported }).default ?? imported;
  const sheet = XLSX.utils.aoa_to_sheet(table);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
  const stem = (baseName || "statement").replace(/\.(pdf|csv|tsv|xlsx|xls|txt)$/i, "");
  XLSX.writeFile(workbook, `${stem || "statement"}.xlsx`);
}
