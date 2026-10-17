import { ShieldCheck, AlertTriangle, Info, CheckCircle2, Table2, FileText, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNaira } from "@/lib/auditor";
import { cn } from "@/lib/utils";

/** The validation block the auditor stores inside `report_json`. */
export interface AuditValidation {
  method?: string;
  reconciled?: boolean | null;
  reconciliation?: {
    source?: string;
    credits?: number;
    debits?: number;
    opening?: number;
    closing?: number;
    expectedClosing?: number;
    difference?: number;
    printedCredit?: number;
    printedDebit?: number;
  } | null;
  dataQuality?: {
    excludedInvalidTransactions?: number;
    duplicateRowsIgnored?: number;
    undatedTransactions?: number;
    excludedUndatedTransactions?: number;
  };
  warnings?: string[];
  notes?: string[];
}

const METHOD_META: Record<string, { label: string; icon: typeof Table2 }> = {
  spreadsheet: { label: "Read from the spreadsheet columns", icon: Table2 },
  "deterministic-parser": { label: "Read from the statement text", icon: FileText },
  ai: { label: "Read by the AI reader (fallback)", icon: Sparkles },
};

function StatusBanner({ reconciled }: { reconciled: boolean | null | undefined }) {
  if (reconciled === true) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Every credit and debit tallies with the totals on your statement.</span>
      </div>
    );
  }
  if (reconciled === false) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          These figures could not be fully matched against the statement's own totals. Double-check
          that the entire statement was uploaded before relying on them.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        This statement does not print totals we can cross-check against, so the figures were summed
        directly from the transaction rows.
      </span>
    </div>
  );
}

export function AuditDataQuality({
  validation,
  className,
}: {
  validation: AuditValidation;
  className?: string;
}) {
  const method = METHOD_META[validation.method ?? ""] ?? METHOD_META["deterministic-parser"];
  const MethodIcon = method.icon;
  const reconciliation = validation.reconciliation ?? null;
  const dataQuality = validation.dataQuality ?? {};
  const notes = [...(validation.warnings ?? []), ...(validation.notes ?? [])].filter(Boolean);

  const excluded = dataQuality.excludedInvalidTransactions ?? 0;
  const duplicates = dataQuality.duplicateRowsIgnored ?? 0;
  const undated = dataQuality.undatedTransactions ?? 0;

  const statusLabel =
    validation.reconciled === true
      ? "Reconciled"
      : validation.reconciled === false
        ? "Review"
        : "Checked";
  const statusClass =
    validation.reconciled === true
      ? "border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
      : validation.reconciled === false
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-border bg-muted/50 text-muted-foreground";

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Statement check
          </CardTitle>
          <Badge variant="outline" className={cn("text-xs", statusClass)}>
            {statusLabel}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-1.5">
          <MethodIcon className="h-3.5 w-3.5" />
          {method.label}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusBanner reconciled={validation.reconciled} />

        {reconciliation && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Credits in" value={formatNaira(reconciliation.credits ?? 0)} />
            <Figure label="Debits out" value={formatNaira(reconciliation.debits ?? 0)} />
            {typeof reconciliation.opening === "number" && (
              <Figure label="Opening balance" value={formatNaira(reconciliation.opening)} />
            )}
            {typeof reconciliation.closing === "number" && (
              <Figure label="Closing balance" value={formatNaira(reconciliation.closing)} />
            )}
            {typeof reconciliation.printedCredit === "number" && (
              <Figure label="Statement credit total" value={formatNaira(reconciliation.printedCredit)} />
            )}
            {typeof reconciliation.printedDebit === "number" && (
              <Figure label="Statement debit total" value={formatNaira(reconciliation.printedDebit)} />
            )}
          </div>
        )}

        {(excluded > 0 || duplicates > 0 || undated > 0) && (
          <div className="flex flex-wrap gap-2">
            {excluded > 0 && (
              <Badge variant="secondary" className="text-xs">
                {excluded} row{excluded === 1 ? "" : "s"} skipped (invalid amounts or dates)
              </Badge>
            )}
            {duplicates > 0 && (
              <Badge variant="secondary" className="text-xs">
                {duplicates} exact duplicate{duplicates === 1 ? "" : "s"} ignored
              </Badge>
            )}
            {undated > 0 && (
              <Badge variant="secondary" className="text-xs">
                {undated} row{undated === 1 ? "" : "s"} without a date
              </Badge>
            )}
          </div>
        )}

        {notes.length > 0 && (
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {notes.map((note, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default AuditDataQuality;
