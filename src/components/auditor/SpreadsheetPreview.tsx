import { Table2, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A read-only, spreadsheet-style preview of a converted statement. The rows are
 * exactly what the auditor will total (and what "Download Excel" writes out), so
 * the user can eyeball the conversion before proceeding with the audit.
 */
export interface SpreadsheetPreviewProps {
  table: (string | number)[][];
  /** Overrides the default "Converted spreadsheet" heading. */
  title?: string;
  /** Overrides the default row/column summary line. */
  description?: string;
  /** Original file name, used for the Excel download. */
  fileName?: string;
  onDownload?: () => void;
  downloading?: boolean;
  className?: string;
  /** Cap on rendered rows; the full table is still used for the audit/download. */
  maxRows?: number;
}

/** Excel-style column label: A, B, ... Z, AA, AB, ... */
function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function SpreadsheetPreview({
  table,
  title,
  description,
  fileName,
  onDownload,
  downloading = false,
  className,
  maxRows = 500,
}: SpreadsheetPreviewProps) {
  const columns = table.reduce((max, row) => Math.max(max, row.length), 0);
  const rows = table.slice(0, maxRows);
  const hiddenCount = table.length - rows.length;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Table2 className="w-4 h-4 text-primary" />
              {title ?? "Converted spreadsheet"}
            </CardTitle>
            <CardDescription>
              {description
                ?? `${table.length.toLocaleString()} row${table.length === 1 ? "" : "s"}${
                  columns > 0 ? ` × ${columns} column${columns === 1 ? "" : "s"}` : ""
                }. This is what the audit will total — check it before you proceed.`}
            </CardDescription>
          </div>
          {onDownload && (
            <Button variant="outline" size="sm" onClick={onDownload} disabled={downloading}>
              <Download className="w-4 h-4 mr-2" />
              {downloading ? "Preparing…" : "Download Excel"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-auto max-h-[420px]">
          <table className="border-collapse text-xs font-mono min-w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-muted text-muted-foreground border border-border w-10 min-w-10 px-2 py-1 text-center font-normal">
                  #
                </th>
                {Array.from({ length: columns }, (_, c) => (
                  <th
                    key={c}
                    className="bg-muted text-muted-foreground border border-border px-2 py-1 text-center font-normal min-w-[96px]"
                  >
                    {columnLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={cn(r % 2 === 1 && "bg-muted/20")}>
                  <td className="border border-border bg-muted/40 text-muted-foreground px-2 py-1 text-center">
                    {r + 1}
                  </td>
                  {Array.from({ length: columns }, (_, c) => {
                    const value = row[c];
                    return (
                      <td
                        key={c}
                        className="border border-border px-2 py-1 whitespace-pre-wrap align-top max-w-[280px]"
                      >
                        {value === undefined || value === "" ? "" : String(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns + 1}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No rows were read from {fileName || "this file"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first {rows.length.toLocaleString()} rows. The full converted table is still
            used for the audit and the Excel download.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default SpreadsheetPreview;
