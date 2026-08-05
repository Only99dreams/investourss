import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Check, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNaira } from "@/lib/auditor";

interface BlurredReportProps {
  recoverableAmount: number;
  isLocked: boolean;
  onUpgrade?: () => void;
}

const PremiumFeatures = () => (
  <ul className="space-y-2 text-sm">
    {[
      "Full 12-Month Historical Audit",
      "Detailed Transaction Breakdown",
      "AI Recommendations",
      "Recovery Actions",
      "Weekly/Monthly Monitoring",
      "Financial Health Timeline",
      "Audit History",
    ].map((f) => (
      <li key={f} className="flex items-start gap-2">
        <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
        <span>{f}</span>
      </li>
    ))}
  </ul>
);

export const BlurredReport = ({ recoverableAmount, isLocked, onUpgrade }: BlurredReportProps) => {
  const [visible, setVisible] = useState(false);

  if (!isLocked) {
    return (
      <Card className="border-green-500/30 bg-green-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700">
            <Sparkles className="w-5 h-5" />
            Full Report Unlocked
          </CardTitle>
          <CardDescription>
            Your detailed financial intelligence is fully unlocked.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          Locked Detailed Report
        </CardTitle>
        <CardDescription>
          This FREE audit hides transaction-level evidence, AI recommendations and recovery
          actions. Only the estimated recoverable amount is visible.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 p-5 text-center">
          <p className="text-sm text-muted-foreground mb-1">Estimated Recoverable Amount</p>
          <p className="text-3xl font-bold text-primary">{formatNaira(recoverableAmount)}</p>
          <p className="text-xs text-muted-foreground mt-1">You may have lost money to leakages & bank overcharges.</p>
        </div>

        <div className={cn("space-y-3 select-none", !visible && "blur-sm pointer-events-none")}>
          <div className="h-4 w-full rounded bg-secondary/70" />
          <div className="h-4 w-11/12 rounded bg-secondary/70" />
          <div className="h-4 w-3/4 rounded bg-secondary/70" />
          <div className="h-24 w-full rounded bg-secondary/50" />
          <div className="h-4 w-full rounded bg-secondary/70" />
          <div className="h-4 w-2/3 rounded bg-secondary/70" />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Peek at Report (blurred)"}
        </Button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-accent/10 p-5"
        >
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Unlock Your Complete Financial Intelligence
          </h4>
          <PremiumFeatures />
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Button asChild size="sm" className="flex-1" onClick={onUpgrade}>
              <Link to="/auditor/packs">Upgrade Now</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link to="/pricing">View Subscription</Link>
            </Button>
          </div>
        </motion.div>
      </CardContent>
    </Card>
  );
};
