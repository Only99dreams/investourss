import { Sparkles, CheckCircle2, AlertTriangle, Lightbulb, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The explain-only prose the auditor stores inside `report_json.insights`. */
export interface AuditInsights {
  summary?: string;
  highlights?: string[];
  risks?: string[];
  actions?: string[];
  limitations?: string[];
}

const TONES = {
  green: {
    border: "border-green-500/20",
    bg: "bg-green-50/60 dark:bg-green-950/20",
    icon: "text-green-600",
    heading: "text-green-800 dark:text-green-300",
  },
  amber: {
    border: "border-amber-500/20",
    bg: "bg-amber-50/60 dark:bg-amber-950/20",
    icon: "text-amber-600",
    heading: "text-amber-800 dark:text-amber-300",
  },
  primary: {
    border: "border-primary/20",
    bg: "bg-primary/5",
    icon: "text-primary",
    heading: "text-foreground",
  },
} as const;

function InsightSection({
  title,
  icon: Icon,
  tone,
  items,
}: {
  title: string;
  icon: typeof CheckCircle2;
  tone: keyof typeof TONES;
  items: string[];
}) {
  if (items.length === 0) return null;
  const palette = TONES[tone];
  return (
    <div className={cn("rounded-xl border p-4", palette.border, palette.bg)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", palette.icon)} />
        <h3 className={cn("text-sm font-semibold", palette.heading)}>{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-foreground/80">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", palette.icon.replace("text-", "bg-"))} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiInterpretation({
  insights,
  className,
}: {
  insights: AuditInsights;
  className?: string;
}) {
  const summary = (insights.summary ?? "").trim();
  const highlights = insights.highlights ?? [];
  const risks = insights.risks ?? [];
  const actions = insights.actions ?? [];
  const limitations = insights.limitations ?? [];

  const isEmpty =
    !summary &&
    highlights.length === 0 &&
    risks.length === 0 &&
    actions.length === 0 &&
    limitations.length === 0;
  if (isEmpty) return null;

  const hasColumns = highlights.length > 0 || risks.length > 0 || actions.length > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI interpretation
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Explains your verified figures
          </Badge>
        </div>
        <CardDescription>
          Written from the figures above. It does not recalculate them and is not financial advice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && <p className="text-sm leading-relaxed">{summary}</p>}

        {hasColumns && (
          <div className="grid gap-4 md:grid-cols-3">
            <InsightSection title="What's working" icon={CheckCircle2} tone="green" items={highlights} />
            <InsightSection title="Watch out for" icon={AlertTriangle} tone="amber" items={risks} />
            <InsightSection title="Suggested next steps" icon={Lightbulb} tone="primary" items={actions} />
          </div>
        )}

        {limitations.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              How these figures were read
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AiInterpretation;
