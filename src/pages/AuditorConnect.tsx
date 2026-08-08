import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare, Mail, FileUp, Landmark, Sparkles, ArrowRight, ArrowLeft,
  Loader2, CheckCircle2, ScanLine, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { DEFAULT_ACCESS, sampleSmsAlerts, type AuditAccess } from "@/lib/auditor";
import { cn } from "@/lib/utils";

type SourceType = "sms" | "email" | "pdf" | "open_banking";

const SOURCES: { type: SourceType; label: string; icon: typeof MessageSquare; hint: string }[] = [
  { type: "sms", label: "SMS Alerts", icon: MessageSquare, hint: "Paste your bank SMS alerts" },
  { type: "email", label: "Email Statements", icon: Mail, hint: "Paste or upload email statement" },
  { type: "pdf", label: "PDF Statement", icon: FileUp, hint: "Upload a PDF bank statement" },
  { type: "open_banking", label: "Open Banking", icon: Landmark, hint: "Connect your bank securely" },
];

const AUDIT_STEPS = [
  "Parsing transactions",
  "Detecting leakages & overcharges",
  "Scoring your financial health",
  "Calculating recoverable amount",
  "Generating recommendations",
];

// supabase.functions.invoke() throws a generic FunctionsHttpError on non-2xx.
// The real reason is in the edge function's response body, which lives on error.context.
async function functionErrorMessage(err: unknown): Promise<string> {
  const e = err as { message?: string; context?: Response };
  if (e?.context) {
    try {
      const body = await e.context.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* body wasn't JSON */ }
  }
  return e?.message || "Request failed";
}

const AuditorConnect = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [sourceType, setSourceType] = useState<SourceType>("sms");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [emailProvider, setEmailProvider] = useState("gmail");
  const [customHost, setCustomHost] = useState("");
  const [emailAddr, setEmailAddr] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [emailMonths, setEmailMonths] = useState(6);
  const [fetchingEmails, setFetchingEmails] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ ok: boolean; message: string } | null>(null);

  const activeText = sourceType === "pdf" ? fileContent : text;
  const canRun = activeText.trim().length >= 10 || sourceType === "open_banking";

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const content = await file.text();
    setFileContent(content.length > 20 ? content : "");
    if (content.length <= 20) {
      toast({
        title: "Could not read text from PDF",
        description: "This PDF appears to be scanned. Paste the statement text below or use SMS/Email instead.",
        variant: "destructive",
      });
    }
  };

  const fetchBankEmails = async () => {
    if (!emailAddr || !appPassword) {
      toast({
        title: "Missing details",
        description: "Enter your email address and app password to fetch bank messages.",
        variant: "destructive",
      });
      return;
    }
    setFetchingEmails(true);
    setFetchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("financial-email", {
        body: {
          provider: emailProvider,
          host: emailProvider === "other" ? customHost : undefined,
          email: emailAddr,
          appPassword,
          months: emailMonths,
        },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error(data?.error || "Failed to fetch emails");
      if (!data.text) {
        setFetchResult({
          ok: false,
          message: `Found ${data.matched ?? 0} matching message(s), but no usable transaction text. Try another provider or paste manually.`,
        });
        return;
      }
      setText(data.text);
      setFetchResult({
        ok: true,
        message: `Fetched ${data.fetched} bank message(s). Review and click "Run FREE 6-Month Audit" below.`,
      });
    } catch (err) {
      console.error(err);
      setFetchResult({
        ok: false,
        message: err instanceof Error ? err.message : "Failed to fetch emails.",
      });
    } finally {
      setFetchingEmails(false);
    }
  };

  const runAudit = async () => {
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }
    setRunning(true);
    setStepIndex(0);

    const stepTimer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, AUDIT_STEPS.length - 1));
    }, 1600);

    try {
      // 1. Determine audit access (free / subscription / credits)
      const accessRes = await supabase.rpc("get_audit_access");
      if (accessRes.error) throw accessRes.error;
      const access = (Array.isArray(accessRes.data) ? accessRes.data[0] : accessRes.data) as AuditAccess;

      let isFree = false;
      let consumeCredit = false;

      if (access?.access_type === "free") {
        isFree = true;
      } else if (access?.access_type === "credits") {
        consumeCredit = true;
      } else if (access?.access_type !== "subscription") {
        setRunning(false);
        clearInterval(stepTimer);
        toast({
          title: "Free audit used",
          description: "Upgrade or grab an Audit Credit Pack to run another audit.",
          variant: "destructive",
        });
        navigate("/auditor/packs");
        return;
      }

      if (consumeCredit) {
        const { error: creditError } = await supabase.rpc("consume_audit_credit");
        if (creditError) throw creditError;
      }

      // 2. Run the AI audit analysis
      const { data: aiData, error: aiError } = await supabase.functions.invoke("financial-audit", {
        body: {
          text: activeText,
          sourceType,
          accountType: "individual",
          auditMonths: 6,
        },
      });

      if (aiError) throw new Error(await functionErrorMessage(aiError));
      if (!aiData?.success) throw new Error(aiData?.error || "AI audit failed");

      const report = aiData.report;

      // 3. Save the data source
      const { data: sourceRow, error: sourceError } = await supabase
        .from("financial_data_sources")
        .insert({
          user_id: user.id,
          source_type: sourceType,
          display_name: sourceType === "pdf" ? fileName : `${sourceType} records`,
          content_text: activeText.slice(0, 50000),
          status: "connected",
        })
        .select("id")
        .single();

      if (sourceError) throw sourceError;

      const isLocked = access?.access_type === "free";

      // 4. Save the audit
      const { data: auditRow, error: auditError } = await supabase
        .from("financial_audits")
        .insert({
          user_id: user.id,
          source_id: sourceRow.id,
          status: "completed",
          health_score: report.score,
          health_status: report.healthStatus,
          total_income: report.totalIncome,
          total_expenses: report.totalExpenses,
          cash_flow: report.cashFlow,
          savings_rate: report.savingsRate,
          recoverable_amount: report.recoverableAmount,
          is_free: isFree,
          is_locked: isLocked,
          audit_period_start: report.periodStart,
          audit_period_end: report.periodEnd,
          report_json: report,
        })
        .select("id")
        .single();

      if (auditError) throw auditError;

      // 5. Save recoverable transactions
      if (Array.isArray(report.recoverable) && report.recoverable.length > 0) {
        await supabase.from("recoverable_transactions").insert(
          report.recoverable.map((r: { description: string; amount: number; category: string; transactionDate?: string }) => ({
            user_id: user.id,
            audit_id: auditRow.id,
            description: r.description,
            category: r.category,
            amount: r.amount,
            transaction_date: r.transactionDate,
            status: "identified",
          })),
        );
      }

      // 6. Save recommendations (locked for free audits)
      if (Array.isArray(report.recommendations) && report.recommendations.length > 0) {
        await supabase.from("recovery_recommendations").insert(
          report.recommendations.map((r: { title: string; description: string; category: string }) => ({
            user_id: user.id,
            audit_id: auditRow.id,
            title: r.title,
            description: r.description,
            category: r.category,
            is_locked: isLocked,
          })),
        );
      }

      // 7. Save timeline snapshots
      if (Array.isArray(report.monthlyScores) && report.monthlyScores.length > 0) {
        await supabase.from("financial_health_snapshots").upsert(
          report.monthlyScores.map((m: { month: string; score: number }) => ({
            user_id: user.id,
            snapshot_date: `${m.month}-01`,
            score: Math.max(0, Math.min(100, m.score)),
            source: "audit",
          })),
          { onConflict: "user_id,snapshot_date" },
        );
      }

      // 8. Notify
      await supabase.from("notifications").insert({
        user_id: user.id,
        title: "Financial Audit Completed!",
        message: `Your Financial Health Score is ${report.score}. Estimated recoverable: ₦${Math.round(report.recoverableAmount).toLocaleString()}.`,
        type: "audit_completed",
      });

      clearInterval(stepTimer);
      toast({
        title: "Audit Complete!",
        description: `Financial Health Score: ${report.score}. View your dashboard.`,
      });
      navigate("/auditor/audit");
    } catch (err) {
      clearInterval(stepTimer);
      console.error(err);
      toast({
        title: "Audit failed",
        description: err instanceof Error ? err.message : "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/auditor")} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to AI Financial Auditor
          </Button>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Connect Financial Data</h1>
          <p className="text-muted-foreground max-w-2xl">
            Connect your records to run your FREE 6-month Financial Audit. We analyze your
            transactions, detect hidden leakages and estimate how much you can recover.
          </p>
        </motion.div>

        <Card className="mb-6">
          <CardContent className="p-6">
            <p className="text-sm font-medium mb-3">Choose how you want to connect</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SOURCES.map((s) => (
                <button
                  key={s.type}
                  onClick={() => setSourceType(s.type)}
                  className={cn(
                    "rounded-xl border p-3 sm:p-4 text-center transition-all hover:border-primary/50",
                    sourceType === s.type ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
                  )}
                >
                  <s.icon className={cn("w-6 h-6 mx-auto mb-2", sourceType === s.type ? "text-primary" : "text-muted-foreground")} />
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 hidden sm:block">{s.hint}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="p-6">
            {sourceType === "open_banking" ? (
              <div className="text-center py-6 space-y-4">
                <Landmark className="w-10 h-10 text-primary mx-auto" />
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Open Banking integration is coming soon. For now, paste your SMS alerts or email
                  statements to run your audit instantly.
                </p>
                <Button variant="outline" size="sm" onClick={() => setSourceType("sms")}>
                  Use SMS Alerts Instead
                </Button>
              </div>
            ) : sourceType === "pdf" ? (
              <div className="space-y-4">
                <Label htmlFor="pdf">Upload PDF statement</Label>
                <Input id="pdf" type="file" accept=".pdf" onChange={handleFileUpload} />
                {fileName && <Badge variant="outline">{fileName}</Badge>}
                {fileContent && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Text extracted — ready to audit.
                  </p>
                )}
                <div>
                  <Label htmlFor="pdf-text">Or paste statement text</Label>
                  <Textarea
                    id="pdf-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={8}
                    placeholder="Paste the statement content here..."
                    className="mt-1 font-mono text-xs"
                  />
                </div>
              </div>
            ) : (
              <div>
                {sourceType === "email" && (
                  <div className="mb-6 rounded-xl border border-primary/20 bg-secondary/30 p-4 space-y-4">
                    <div>
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <Mail className="w-4 h-4 text-primary" />
                        Connect your email to auto-fetch bank messages
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        We connect to your inbox via IMAP and pull recent credit/debit alerts. Your
                        password is used once to fetch and is never stored. Gmail/Yahoo require an
                        app password (Google Account → Security → App passwords).
                      </p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="email-provider">Provider</Label>
                        <select
                          id="email-provider"
                          value={emailProvider}
                          onChange={(e) => setEmailProvider(e.target.value)}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="gmail">Gmail</option>
                          <option value="outlook">Outlook / Microsoft 365</option>
                          <option value="yahoo">Yahoo Mail</option>
                          <option value="icloud">iCloud Mail</option>
                          <option value="other">Other (custom IMAP)</option>
                        </select>
                      </div>
                      {emailProvider === "other" && (
                        <div>
                          <Label htmlFor="email-host">IMAP host</Label>
                          <Input
                            id="email-host"
                            value={customHost}
                            onChange={(e) => setCustomHost(e.target.value)}
                            placeholder="imap.example.com"
                            className="mt-1"
                          />
                        </div>
                      )}
                      <div>
                        <Label htmlFor="email-addr">Email address</Label>
                        <Input
                          id="email-addr"
                          type="email"
                          value={emailAddr}
                          onChange={(e) => setEmailAddr(e.target.value)}
                          placeholder="you@gmail.com"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="email-pass">App password</Label>
                        <Input
                          id="email-pass"
                          type="password"
                          value={appPassword}
                          onChange={(e) => setAppPassword(e.target.value)}
                          placeholder="16-character app password"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="email-months">Search period</Label>
                        <select
                          id="email-months"
                          value={emailMonths}
                          onChange={(e) => setEmailMonths(Number(e.target.value))}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value={6}>Last 6 months</option>
                          <option value={12}>Last 12 months</option>
                          <option value={24}>Last 24 months</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={fetchBankEmails}
                        disabled={fetchingEmails}
                      >
                        {fetchingEmails ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Mail className="w-4 h-4 mr-2" />
                        )}
                        {fetchingEmails ? "Fetching emails..." : "Fetch Bank Emails"}
                      </Button>
                      {fetchResult && (
                        <p
                          className={cn(
                            "text-xs flex items-center gap-1",
                            fetchResult.ok ? "text-green-600" : "text-red-600",
                          )}
                        >
                          {fetchResult.ok ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <ScanLine className="w-3 h-3" />
                          )}
                          {fetchResult.message}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <Label htmlFor="records">
                  {sourceType === "sms"
                    ? "Paste your bank SMS alerts below"
                    : "Paste your email statement text below"}
                </Label>
                <Textarea
                  id="records"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  placeholder={
                    sourceType === "sms"
                      ? 'Alert: Withdrawal NGN10,000.00 on 05/08/26 by POS. Avail Bal: NGN450,000.00.\nAlert: Credit of NGN250,000.00 on 05/08/26. Desc: Salary. Avail Bal: NGN700,000.00.\n...'
                      : "Paste your email statement here..."
                  }
                  className="mt-1 font-mono text-xs"
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={() => setText(sampleSmsAlerts)} disabled={running}>
                <Sparkles className="w-4 h-4 mr-2" /> Try sample data
              </Button>
            </div>
          </CardContent>
        </Card>

        {running ? (
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardContent className="p-8 text-center">
              <div className="flex items-center justify-center mb-4">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <ScanLine className="w-9 h-9 text-primary animate-pulse" />
                  </div>
                  <div className="absolute inset-0 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-4">Auditing your finances...</h3>
              <div className="max-w-xs mx-auto space-y-2">
                {AUDIT_STEPS.map((step, i) => (
                  <div key={step} className="flex items-center gap-2 text-sm">
                    {i < stepIndex ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : i === stepIndex ? (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-muted-foreground/30" />
                    )}
                    <span className={cn(i <= stepIndex ? "text-foreground" : "text-muted-foreground")}>{step}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" className="flex-1" onClick={runAudit} disabled={!canRun}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Run FREE 6-Month Audit
            </Button>
          </div>
        )}

        <Alert className="mt-6 border-primary/20 bg-primary/5">
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Your data is private</AlertTitle>
          <AlertDescription>
            Financial records are stored securely and only used to power your audit. Your
            one-time FREE audit is included with every new account.
          </AlertDescription>
        </Alert>
      </main>
      <Footer />
    </div>
  );
};

export default AuditorConnect;
