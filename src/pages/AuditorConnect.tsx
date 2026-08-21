import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare, Mail, FileUp, Landmark, Sparkles, ArrowRight, ArrowLeft,
  Loader2, CheckCircle2, ScanLine, RefreshCw, Unlink,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [emailMonths, setEmailMonths] = useState(6);
  const [fetchingEmails, setFetchingEmails] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [oauthConn, setOauthConn] = useState<{ provider: "gmail" | "outlook"; email: string; refreshToken: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);

  const activeText = sourceType === "pdf" ? fileContent : text;
  const canRun = activeText.trim().length >= 10 || sourceType === "open_banking";

  const loadOAuthConnections = async () => {
    if (!user) {
      setOauthConn(null);
      return;
    }
    const { data, error } = await supabase
      .from("email_connections")
      .select("provider, email, refresh_token")
      .eq("user_id", user.id);
    if (error || !data) {
      setOauthConn(null);
      return;
    }
    const gmail = data.find((c) => c.provider === "gmail");
    const outlook = data.find((c) => c.provider === "outlook");
    const conn = gmail?.refresh_token
      ? { provider: "gmail" as const, email: gmail.email ?? "", refreshToken: gmail.refresh_token }
      : outlook?.refresh_token
        ? { provider: "outlook" as const, email: outlook.email ?? "", refreshToken: outlook.refresh_token }
        : null;
    setOauthConn(conn);
  };

  const disconnectOAuth = async () => {
    if (!user || !oauthConn) return;
    await supabase.from("email_connections").delete().eq("user_id", user.id).eq("provider", oauthConn.provider);
    setOauthConn(null);
    toast({ title: "Disconnected", description: "Your email connection was removed." });
  };

  const connectWithOAuth = async (prov: "gmail" | "outlook") => {
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mail-oauth", {
        body: { action: "authorize", provider: prov, user_id: user.id, origin: window.location.origin },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.url) throw new Error("Could not start the connection flow.");

      window.open(data.url, "_blank", "width=520,height=680");
      const startedAt = Date.now();
      const poll = setInterval(async () => {
        const { data: row } = await supabase
          .from("email_connections")
          .select("email, refresh_token")
          .eq("user_id", user.id)
          .eq("provider", prov)
          .maybeSingle();
        if (row?.refresh_token) {
          clearInterval(poll);
          setConnecting(false);
          setOauthConn({ provider: prov, email: row.email ?? "", refreshToken: row.refresh_token });
          toast({
            title: "Email connected!",
            description: `Connected ${row.email || prov}. You can now fetch your bank messages.`,
          });
        } else if (Date.now() - startedAt > 120000) {
          clearInterval(poll);
          setConnecting(false);
        }
      }, 2000);
    } catch (err) {
      console.error(err);
      setConnecting(false);
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not start the connection flow.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("email");
    if (status === "connected") {
      toast({ title: "Email connected!", description: "You can now fetch your bank messages." });
    } else if (status === "error") {
      toast({ title: "Connection cancelled", description: "No changes were made." });
    }
    if (status) window.history.replaceState({}, "", window.location.pathname);
    if (user) loadOAuthConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) {
      navigate("/auth?mode=login");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a PDF under 10MB.",
        variant: "destructive",
      });
      return;
    }
    setFileName(file.name);
    setFileContent("");
    setParsingPdf(true);
    try {
      const path = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("statements")
        .upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw new Error("Could not upload the file. Please try again.");

      const { data, error } = await supabase.functions.invoke("parse-statement", { body: { path } });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error(data?.error || "Failed to parse the PDF");

      setFileContent(data.text);
      toast({
        title: "PDF parsed!",
        description: `Extracted ${data.pages ?? 1} page(s). Review the text below, then run your audit.`,
      });
    } catch (err) {
      console.error(err);
      setFileContent("");
      toast({
        title: "Could not read PDF",
        description:
          err instanceof Error
            ? err.message
            : "This PDF appears to be scanned. Paste the statement text below instead.",
        variant: "destructive",
      });
    } finally {
      setParsingPdf(false);
    }
  };

  const fetchBankEmails = async () => {
    if (!oauthConn) {
      toast({
        title: "Not connected",
        description: "Connect your Gmail in one click to fetch bank messages.",
        variant: "destructive",
      });
      return;
    }
    setFetchingEmails(true);
    setFetchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("financial-email", {
        body: {
          provider: oauthConn.provider,
          refreshToken: oauthConn.refreshToken,
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
      // 0. Reuse the previous audit for the exact same statement so results stay stable
      const sameText = activeText.slice(0, 50000);
      const { data: recentSources, error: prevSourceError } = await supabase
        .from("financial_data_sources")
        .select("id, content_text")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (prevSourceError) throw prevSourceError;
      const prevSources = ((recentSources ?? []) as Array<{ id: string; content_text: string | null }>).filter(
        (s) => s.content_text === sameText
      );

      if (prevSources && prevSources.length > 0) {
        const { data: prevAudit, error: prevAuditError } = await supabase
          .from("financial_audits")
          .select("report_json")
          .eq("source_id", prevSources[0].id)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1);
        if (prevAuditError) throw prevAuditError;
        if (prevAudit && prevAudit.length > 0 && prevAudit[0]?.report_json) {
          clearInterval(stepTimer);
          toast({
            title: "Stable result",
            description: "Same statement detected - reusing your previous audit for identical results.",
          });
          navigate("/auditor/audit");
          return;
        }
      }

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
          report.recoverable.map((r: { description: string; amount: number; category: string; transactionDate?: string; sourceAmount?: number; sourceType?: string }) => ({
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
      <main className="flex-1 container mx-auto px-4 pt-24 md:pt-28 pb-10 max-w-4xl">
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
                <Input id="pdf" type="file" accept=".pdf,.txt" onChange={handleFileUpload} disabled={parsingPdf} />
                {parsingPdf && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Extracting text from your PDF...
                  </p>
                )}
                {fileName && !parsingPdf && <Badge variant="outline">{fileName}</Badge>}
                {fileContent && !parsingPdf && (
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
                  <div className="mb-6 rounded-xl border border-primary/20 bg-secondary/30 p-4 sm:p-5 space-y-5">
                    {/* How it works */}
                    <div>
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <Mail className="w-4 h-4 text-primary" />
                        Connect your email to auto-fetch bank messages
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        Connect your Gmail in one click — no app passwords needed. We
                        scan the last few months for messages from your bank (or with subjects like
                        “debit”, “credit”, “avail bal”), extract the transaction details and feed
                        them straight into your audit.
                      </p>
                    </div>

                    {/* One-click OAuth connect (recommended) */}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={oauthConn?.provider === "gmail" ? "default" : "outline"}
                          onClick={() => connectWithOAuth("gmail")}
                          disabled={connecting}
                        >
                          {connecting ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Mail className="w-4 h-4 mr-2" />
                          )}
                          Connect Gmail
                        </Button>
                      </div>

                      {oauthConn && (
                        <div className="mt-3 rounded-lg border border-green-600/30 bg-green-50 p-3 text-xs text-green-700 flex flex-wrap items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            Connected: <span className="font-medium">{oauthConn.email || oauthConn.provider}</span>
                          </span>
                          <select
                            value={emailMonths}
                            onChange={(e) => setEmailMonths(Number(e.target.value))}
                            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value={6}>6 mo</option>
                            <option value={12}>12 mo</option>
                            <option value={24}>24 mo</option>
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={fetchBankEmails}
                            disabled={fetchingEmails}
                          >
                            {fetchingEmails ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Mail className="w-3 h-3 mr-1" />
                            )}
                            {fetchingEmails ? "Fetching..." : "Fetch Bank Emails"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={disconnectOAuth}
                          >
                            <Unlink className="w-3 h-3 mr-1" /> Disconnect
                          </Button>
                        </div>
                      )}

                      {oauthConn && fetchResult && (
                        <p
                          className={cn(
                            "mt-2 text-xs flex items-center gap-1",
                            fetchResult.ok ? "text-green-600" : "text-red-600",
                          )}
                        >
                          {fetchResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <ScanLine className="w-3 h-3" />}
                          {fetchResult.message}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground mt-2">
                        Don’t want to connect an account? Paste your statement text directly below,
                        or upload a PDF above.
                      </p>
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
