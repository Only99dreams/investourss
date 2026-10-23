import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MailPlus,
  Search,
  Send,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Audience = "all" | "selected";

interface MailMember {
  id: string;
  full_name: string | null;
  email: string | null;
  email_opt_in: boolean | null;
}

interface SendSummary {
  sent: number;
  skipped: number;
  failed: number;
}

const BATCH_SIZE = 20;

const memberName = (member: MailMember) =>
  member.full_name?.trim() || member.email?.trim() || "Unnamed member";

const emailOf = (member: MailMember) => member.email?.trim().toLowerCase() ?? "";

const AdminMailTab = () => {
  const { toast } = useToast();
  const [audience, setAudience] = useState<Audience>("all");
  const [selected, setSelected] = useState<MailMember[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MailMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [includeOptedOut, setIncludeOptedOut] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<SendSummary | null>(null);

  const selectedIds = useMemo(() => new Set(selected.map((member) => member.id)), [selected]);

  /** Count the audience for the "all members" option. */
  useEffect(() => {
    if (audience !== "all") return;
    let cancelled = false;

    void (async () => {
      let request = supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("email", "is", null)
        .neq("email", "");

      if (!includeOptedOut) {
        request = request.or("email_opt_in.eq.true,email_opt_in.is.null");
      }

      const { count, error } = await request;
      if (cancelled) return;
      if (error) {
        console.error("Could not count members:", error);
        setAllCount(null);
        return;
      }
      setAllCount(count ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [audience, includeOptedOut]);

  const searchMembers = useCallback(async (query: string) => {
    setSearching(true);
    try {
      // Strip PostgREST filter syntax so punctuation in a name cannot alter
      // the OR expression.
      const safe = query.trim().replace(/[(),%*\\]/g, " ").trim();

      let request = supabase
        .from("profiles")
        .select("id, full_name, email, email_opt_in")
        .not("email", "is", null)
        .neq("email", "")
        .order("full_name", { ascending: true })
        .limit(20);

      if (safe) {
        request = request.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
      }

      const { data, error } = await request;
      if (error) throw error;
      setResults((data ?? []) as MailMember[]);
    } catch (error) {
      console.error("Could not search members:", error);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (audience !== "selected") return;
    const timer = window.setTimeout(() => void searchMembers(search), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [audience, search, searchMembers]);

  const toggleMember = (member: MailMember) => {
    setSelected((prev) =>
      prev.some((item) => item.id === member.id)
        ? prev.filter((item) => item.id !== member.id)
        : [...prev, member],
    );
  };

  /** Every opted-in profile with an email address, paged to avoid the row cap. */
  const loadAllRecipients = async (): Promise<MailMember[]> => {
    const pageSize = 1000;
    const all: MailMember[] = [];

    for (let from = 0; ; from += pageSize) {
      let request = supabase
        .from("profiles")
        .select("id, full_name, email, email_opt_in")
        .not("email", "is", null)
        .neq("email", "")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (!includeOptedOut) {
        request = request.or("email_opt_in.eq.true,email_opt_in.is.null");
      }

      const { data, error } = await request;
      if (error) throw error;

      const rows = (data ?? []) as MailMember[];
      all.push(...rows);
      if (rows.length < pageSize) break;
    }

    return all;
  };

  /** Resolve the final recipient list for the current audience. */
  const buildRecipients = async (): Promise<MailMember[]> => {
    const base = audience === "all" ? await loadAllRecipients() : selected;
    const seen = new Set<string>();
    const recipients: MailMember[] = [];

    for (const member of base) {
      const email = emailOf(member);
      if (!email || seen.has(email)) continue;
      if (!includeOptedOut && member.email_opt_in === false) continue;
      seen.add(email);
      recipients.push(member);
    }

    return recipients;
  };

  const handleSend = async () => {
    if (!subject.trim()) {
      toast({ title: "Subject required", description: "Add a subject line.", variant: "destructive" });
      return;
    }
    if (!message.trim()) {
      toast({ title: "Message required", description: "Write the email body.", variant: "destructive" });
      return;
    }
    if (audience === "selected" && selected.length === 0) {
      toast({ title: "No recipients", description: "Choose at least one member.", variant: "destructive" });
      return;
    }

    setSending(true);
    setProgress(0);
    setSummary(null);

    try {
      const recipients = await buildRecipients();
      if (recipients.length === 0) {
        toast({ title: "No recipients", description: "No member with a valid email matched this audience.", variant: "destructive" });
        return;
      }

      const total = recipients.length;
      const running: SendSummary = { sent: 0, skipped: 0, failed: 0 };

      for (let index = 0; index < recipients.length; index += BATCH_SIZE) {
        const batch = recipients.slice(index, index + BATCH_SIZE);
        const { data, error } = await supabase.functions.invoke("send-admin-mail", {
          body: {
            subject: subject.trim(),
            message: message.trim(),
            includeOptedOut,
            recipients: batch.map((member) => ({
              id: member.id,
              email: emailOf(member),
              name: member.full_name,
            })),
          },
        });

        if (error) {
          let detail = error.message;
          const context = (error as { context?: Response }).context;
          if (context) {
            try {
              const body = await context.json();
              detail = body?.error || detail;
            } catch {
              /* context already consumed or not JSON */
            }
          }
          throw new Error(detail);
        }

        const result = data as Partial<SendSummary> | null;
        running.sent += Number(result?.sent ?? 0);
        running.skipped += Number(result?.skipped ?? 0);
        running.failed += Number(result?.failed ?? 0);

        setProgress(Math.round((Math.min(index + BATCH_SIZE, total) / total) * 100));
      }

      setSummary(running);
      toast({
        title: "Mail sent",
        description: `${running.sent} sent${running.skipped ? `, ${running.skipped} skipped` : ""}${running.failed ? `, ${running.failed} failed` : ""}.`,
        variant: running.failed > 0 ? "destructive" : undefined,
      });

      if (running.failed === 0) {
        setSubject("");
        setMessage("");
      }
    } catch (error) {
      console.error("Error sending admin mail:", error);
      toast({
        title: "Could not send mail",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const recipientLabel =
    audience === "all"
      ? allCount === null
        ? "all members with an email address"
        : `${allCount.toLocaleString()} member${allCount === 1 ? "" : "s"}`
      : `${selected.length} selected member${selected.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailPlus className="h-5 w-5" /> Send Mail
          </CardTitle>
          <CardDescription>
            Compose an email to every member or a hand-picked group. Messages are delivered through
            the Investours email service.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Audience */}
          <div className="space-y-2">
            <Label>Recipients</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={audience === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setAudience("all")}
                disabled={sending}
              >
                <Users className="mr-2 h-4 w-4" /> All members
              </Button>
              <Button
                type="button"
                variant={audience === "selected" ? "default" : "outline"}
                size="sm"
                onClick={() => setAudience("selected")}
                disabled={sending}
              >
                <UserCheck className="mr-2 h-4 w-4" /> Selected members
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sending to {recipientLabel}.
            </p>
          </div>

          {audience === "selected" && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search members by name or email..."
                  className="pl-9"
                  disabled={sending}
                />
              </div>

              <div className="max-h-56 overflow-y-auto rounded-md border">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                  </div>
                ) : results.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No members found.</p>
                ) : (
                  results.map((member) => {
                    const checked = selectedIds.has(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleMember(member)}
                        disabled={sending}
                        className={cn(
                          "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60",
                          checked && "bg-primary/5",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary",
                            checked ? "bg-primary text-primary-foreground" : "bg-background",
                          )}
                          aria-hidden="true"
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{memberName(member)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {member.email}
                            {member.email_opt_in === false && " · opted out"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {selected.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.map((member) => (
                    <Badge key={member.id} variant="secondary" className="gap-1 pr-1">
                      <span className="max-w-[14rem] truncate">{memberName(member)}</span>
                      <button
                        type="button"
                        onClick={() => toggleMember(member)}
                        disabled={sending}
                        className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Remove ${memberName(member)}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>
                Members who opted out of emails are skipped by default. Tick the box below only for
                account-critical announcements.
              </p>
              <label className="mt-2 flex items-center gap-2 font-medium">
                <Checkbox
                  checked={includeOptedOut}
                  onCheckedChange={(value) => setIncludeOptedOut(value === true)}
                  disabled={sending}
                />
                Include members who opted out
              </label>
            </div>
          </div>

          {/* Compose */}
          <div className="space-y-2">
            <Label htmlFor="mail-subject">Subject</Label>
            <Input
              id="mail-subject"
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What is this email about?"
              disabled={sending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-body">Message</Label>
            <Textarea
              id="mail-body"
              value={message}
              maxLength={20000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write your message..."
              className="min-h-[220px]"
              disabled={sending}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length.toLocaleString()} / 20,000</p>
          </div>

          {sending && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">Sending... {progress}%</p>
            </div>
          )}

          {summary && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-400/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {summary.sent} email{summary.sent === 1 ? "" : "s"} sent
                {summary.skipped > 0 && `, ${summary.skipped} skipped (opted out)`}
                {summary.failed > 0 && `, ${summary.failed} failed`}.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void handleSend()} disabled={sending || !subject.trim() || !message.trim()}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" /> Send mail
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminMailTab;
