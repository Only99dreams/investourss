import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bold,
  Check,
  CheckCircle2,
  Heading1,
  Heading2,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  MailPlus,
  Paperclip,
  Quote,
  Redo,
  Search,
  Send,
  Upload,
  Strikethrough,
  Underline,
  Undo,
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
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

interface MailAttachment {
  name: string;
  url: string;
  size: number;
  kind: "image" | "pdf";
}

const memberName = (member: MailMember) =>
  member.full_name?.trim() || member.email?.trim() || "Unnamed member";

const emailOf = (member: MailMember) => member.email?.trim().toLowerCase() ?? "";

/** First letter used for the A-Z jump bar ("#" for numbers and symbols). */
const initialOf = (member: MailMember) => {
  const first = memberName(member).charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
};

const IMAGE_STYLE = "width:100%;max-width:520px;height:auto;display:block;border:0;border-radius:8px;";
const YOUTUBE_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

const youTubeId = (value: string) => value.match(YOUTUBE_URL_RE)?.[1] ?? null;

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const youTubeBlock = (url: string, id: string) => {
  const href = escapeAttr(url);
  const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  return (
    `<div data-youtube-block="1" contenteditable="false" style="display:block;max-width:520px;margin:0 0 16px;">` +
    `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:block;">` +
    `<img src="${thumb}" alt="YouTube video thumbnail" style="${IMAGE_STYLE} margin:0;" />` +
    `</a>` +
    `<p style="margin:8px 0 0;">` +
    `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#7c3aed;text-decoration:underline;">\u25B6 Watch on YouTube</a>` +
    `</p>` +
    `</div>`
  );
};

const AdminMailTab = () => {
  const { toast } = useToast();
  const [audience, setAudience] = useState<Audience>("all");
  const [selected, setSelected] = useState<MailMember[]>([]);
  const [search, setSearch] = useState("");
  const [letter, setLetter] = useState("All");
  const [members, setMembers] = useState<MailMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [includeOptedOut, setIncludeOptedOut] = useState(false);
  const [subject, setSubject] = useState("");
  const [messageHtml, setMessageHtml] = useState("");
  const [messageText, setMessageText] = useState("");
  const [uploadingKind, setUploadingKind] = useState<null | "image" | "pdf" | "inline">(null);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<SendSummary | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const selectedIds = useMemo(() => new Set(selected.map((member) => member.id)), [selected]);

  const upgradeYouTubeLinks = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    let changed = false;

    // Remove all existing YouTube blocks/anchors and rebuild from scratch
    el.querySelectorAll("[data-youtube-thumb='true'], [data-youtube-block='1']").forEach((node) => node.remove());
    el.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      if (youTubeId(href)) {
        anchor.remove();
        changed = true;
      }
    });

    // Find raw YouTube URLs in text nodes
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const processed = new Set<string>();
    for (const textNode of textNodes) {
      const text = textNode.textContent || "";
      const match = text.match(YOUTUBE_URL_RE);
      if (!match) continue;
      const url = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
      const id = youTubeId(url);
      if (!id || processed.has(id)) {
        textNode.parentElement?.removeChild(textNode);
        changed = true;
        continue;
      }
      processed.add(id);

      const span = document.createElement("div");
      span.innerHTML = youTubeBlock(url, id);
      textNode.parentElement?.replaceChild(span.firstElementChild || span, textNode);
      changed = true;
    }

    if (changed) syncEditor();
  }, []);

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

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const all: MailMember[] = [];
      const pageSize = 1000;

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, email, email_opt_in")
          .not("email", "is", null)
          .neq("email", "")
          .order("full_name", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        const rows = (data ?? []) as MailMember[];
        all.push(...rows);
        if (rows.length < pageSize) break;
      }

      all.sort((a, b) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" }));
      setMembers(all);
    } catch (error) {
      console.error("Could not load members:", error);
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    if (audience !== "selected") return;
    void loadMembers();
  }, [audience, loadMembers]);

  /** Members matching the active search and A-Z letter, in name order. */
  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((member) => {
      if (letter !== "All" && initialOf(member) !== letter) return false;
      if (!query) return true;
      return memberName(member).toLowerCase().includes(query) || emailOf(member).includes(query);
    });
  }, [members, search, letter]);

  const availableLetters = useMemo(() => {
    const present = new Set(members.map(initialOf));
    return ALPHABET.filter((value) => value === "#" ? present.has("#") : present.has(value));
  }, [members]);

  const toggleMember = (member: MailMember) => {
    setSelected((prev) =>
      prev.some((item) => item.id === member.id)
        ? prev.filter((item) => item.id !== member.id)
        : [...prev, member],
    );
  };

  /** Filter by a letter and tick everyone whose name starts with it (toggle off if all ticked). */
  const selectLetter = (value: string) => {
    setLetter(value);
    if (value === "All") return;

    const matches = members.filter((member) => initialOf(member) === value);
    if (matches.length === 0) return;

    const currentlySelected = new Set(selected.map((member) => member.id));
    const allSelected = matches.every((member) => currentlySelected.has(member.id));

    setSelected((prev) => {
      if (allSelected) {
        const remove = new Set(matches.map((member) => member.id));
        return prev.filter((member) => !remove.has(member.id));
      }
      const existing = new Set(prev.map((member) => member.id));
      return [...prev, ...matches.filter((member) => !existing.has(member.id))];
    });
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

  const syncEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setMessageHtml(el.innerHTML);
    const text = el.innerText || el.textContent || "";
    setMessageText(text.trim());
  }, []);

  const exec = useCallback(
    (command: string, value?: string) => {
      if (sending) return;
      editorRef.current?.focus();
      // document.execCommand is still widely supported and works well for simple email formatting.
      document.execCommand(command, false, value);
      syncEditor();
    },
    [sending, syncEditor],
  );

  const insertHtml = useCallback(
    (html: string) => {
      if (sending) return;
      editorRef.current?.focus();
      document.execCommand("insertHTML", false, html);
      syncEditor();
    },
    [sending, syncEditor],
  );

  const insertLink = useCallback(() => {
    if (sending) return;
    const url = window.prompt("Enter link URL (https://...)");
    if (!url) return;
    const trimmed = url.trim();
    const id = youTubeId(trimmed);
    if (id) {
      const el = editorRef.current;
      // Remove any existing YouTube content
      el?.querySelectorAll("[data-youtube-block='1'], [data-youtube-thumb='true'], a[href]").forEach((node) => {
        const href = (node as HTMLAnchorElement).getAttribute?.("href") || "";
        if (youTubeId(href) || node.getAttribute("data-youtube-block") === "1" || node.getAttribute("data-youtube-thumb") === "true") {
          node.remove();
        }
      });
      el?.querySelectorAll("p, div, span").forEach((n) => {
        if (n.textContent && n.textContent.trim() === trimmed && n.children.length === 0) {
          n.remove();
        }
      });
      el?.focus();
      document.execCommand("insertHTML", false, youTubeBlock(trimmed, id));
      syncEditor();
      window.setTimeout(() => {
        upgradeYouTubeLinks();
        syncEditor();
      }, 0);
      return;
    }
    exec("createLink", url);
  }, [exec, sending, syncEditor, upgradeYouTubeLinks]);

  /** Upgrade plain YouTube links (e.g. from the link prompt) to a thumbnail block. */
  
  const pickInlineImage = useCallback(() => {
    if (sending || uploadingKind) return;
    inlineImageInputRef.current?.click();
  }, [sending, uploadingKind]);

  const handleInlineImage = useCallback(
    async (file: File | undefined) => {
      if (!file || sending || uploadingKind) return;
      if (!file.type.startsWith("image/")) {
        toast({ title: "Not an image", description: "Choose a PNG, JPG, GIF or WebP file.", variant: "destructive" });
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({ title: "Image too large", description: "Images must be 10 MB or smaller.", variant: "destructive" });
        return;
      }

      setUploadingKind("inline");
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error("Sign in required to upload images.");

        const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
        const path = `${userData.user.id}/mail-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from("attachments").getPublicUrl(path);
        const alt = escapeAttr(file.name);
        insertHtml(`<img src="${publicUrlData.publicUrl}" alt="${alt}" style="${IMAGE_STYLE}" />`);
        toast({ title: "Image added", description: "The image was inserted into your message." });
      } catch (error) {
        console.error("Could not insert mail image:", error);
        toast({
          title: "Upload failed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setUploadingKind(null);
        if (inlineImageInputRef.current) inlineImageInputRef.current.value = "";
      }
    },
    [insertHtml, sending, toast, uploadingKind],
  );

  const pickImage = useCallback(() => {
    if (sending || uploadingKind) return;
    imageInputRef.current?.click();
  }, [sending, uploadingKind]);

  const pickPdf = useCallback(() => {
    if (sending || uploadingKind) return;
    pdfInputRef.current?.click();
  }, [sending, uploadingKind]);

  /** Upload files to storage and list them as email attachments (never inline). */
  const uploadAttachments = useCallback(
    async (files: FileList | null, kind: "image" | "pdf") => {
      if (!files || files.length === 0 || sending || uploadingKind) return;

      const input = kind === "image" ? imageInputRef : pdfInputRef;
      const incoming = Array.from(files);

      if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
        toast({
          title: "Too many attachments",
          description: `You can attach up to ${MAX_ATTACHMENTS} files per email.`,
          variant: "destructive",
        });
        if (input.current) input.current.value = "";
        return;
      }

      const existingBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
      const incomingBytes = incoming.reduce((total, file) => total + file.size, 0);
      if (existingBytes + incomingBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        toast({
          title: "Attachments too large",
          description: "Attachments must total 20 MB or less per email.",
          variant: "destructive",
        });
        if (input.current) input.current.value = "";
        return;
      }

      setUploadingKind(kind);
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error("Sign in required to upload attachments.");

        const uploaded: MailAttachment[] = [];

        for (const file of incoming) {
          const isImage = file.type.startsWith("image/");
          const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

          if ((kind === "image" && !isImage) || (kind === "pdf" && !isPdf)) {
            toast({
              title: kind === "image" ? "Not an image" : "Not a PDF",
              description: `${file.name} was skipped.`,
              variant: "destructive",
            });
            continue;
          }
          if (file.size > MAX_ATTACHMENT_BYTES) {
            toast({ title: "File too large", description: `${file.name} is larger than 10 MB.`, variant: "destructive" });
            continue;
          }

          const baseName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
          const path = `${userData.user.id}/mail-attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}`;

          const { error: uploadError } = await supabase.storage
            .from("attachments")
            .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase.storage.from("attachments").getPublicUrl(path);
          uploaded.push({
            name: file.name,
            url: publicUrlData.publicUrl,
            size: file.size,
            kind: kind === "image" ? "image" : "pdf",
          });
        }

        if (uploaded.length > 0) {
          setAttachments((prev) => [...prev, ...uploaded]);
          toast({
            title: "Attachment added",
            description: `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached to this email.`,
          });
        }
      } catch (error) {
        console.error("Could not upload mail attachment:", error);
        toast({
          title: "Upload failed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setUploadingKind(null);
        if (input.current) input.current.value = "";
      }
    },
    [attachments, sending, uploadingKind, toast],
  );

  const removeAttachment = (url: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.url !== url));
  };

  const handleSend = async () => {
    if (!subject.trim()) {
      toast({ title: "Subject required", description: "Add a subject line.", variant: "destructive" });
      return;
    }
    if (!messageText) {
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
      upgradeYouTubeLinks();
      const bodyHtml = (editorRef.current?.innerHTML ?? messageHtml).trim();

      for (let index = 0; index < recipients.length; index += BATCH_SIZE) {
        const batch = recipients.slice(index, index + BATCH_SIZE);
        const { data, error } = await supabase.functions.invoke("send-admin-mail", {
          body: {
            subject: subject.trim(),
            html: bodyHtml,
            message: messageText,
            includeOptedOut,
            attachments: attachments.map((attachment) => ({ filename: attachment.name, url: attachment.url })),
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
        setMessageHtml("");
        setMessageText("");
        setAttachments([]);
        if (editorRef.current) editorRef.current.innerHTML = "";
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

              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={letter === "All" ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setLetter("All")}
                  disabled={sending}
                  title="Show all names"
                >
                  All
                </Button>
                {ALPHABET.map((value) => {
                  const enabled = value === "#" ? availableLetters.includes("#") : availableLetters.includes(value);
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={letter === value ? "default" : "outline"}
                      className="h-7 w-7 p-0 text-xs"
                      onClick={() => selectLetter(value)}
                      disabled={sending || !enabled}
                      title={`Select everyone whose name starts with ${value}`}
                    >
                      {value}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick a letter to tick everyone whose name starts with it. Click the same letter again to untick them.
              </p>

              <div className="max-h-72 overflow-y-auto rounded-md border">
                {loadingMembers ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading members...
                  </div>
                ) : visibleMembers.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No members found.</p>
                ) : (
                  visibleMembers.map((member) => {
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
            <Label>Message</Label>
            <p className="text-xs text-muted-foreground">
              Live preview — this is exactly how the email will look. Images and PDFs are delivered as attachments.
            </p>
            <div className="overflow-hidden rounded-md border">
              <div
                className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1"
                onMouseDown={(event) => event.preventDefault()}
              >
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("bold")} disabled={sending} title="Bold">
                  <Bold className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("italic")} disabled={sending} title="Italic">
                  <Italic className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("underline")} disabled={sending} title="Underline">
                  <Underline className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("strikeThrough")} disabled={sending} title="Strikethrough">
                  <Strikethrough className="h-4 w-4" />
                </Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("formatBlock", "H1")} disabled={sending} title="Heading 1">
                  <Heading1 className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("formatBlock", "H2")} disabled={sending} title="Heading 2">
                  <Heading2 className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("formatBlock", "BLOCKQUOTE")} disabled={sending} title="Quote">
                  <Quote className="h-4 w-4" />
                </Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("insertUnorderedList")} disabled={sending} title="Bulleted list">
                  <List className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("insertOrderedList")} disabled={sending} title="Numbered list">
                  <ListOrdered className="h-4 w-4" />
                </Button>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={insertLink} disabled={sending} title="Insert link or YouTube video">
                  <LinkIcon className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={pickInlineImage}
                  disabled={sending || Boolean(uploadingKind)}
                  title="Insert image in email"
                >
                  {uploadingKind === "inline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={pickImage}
                  disabled={sending || Boolean(uploadingKind) || attachments.length >= MAX_ATTACHMENTS}
                  title="Attach image"
                >
                  {uploadingKind === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={pickPdf}
                  disabled={sending || Boolean(uploadingKind) || attachments.length >= MAX_ATTACHMENTS}
                  title="Attach PDF"
                >
                  {uploadingKind === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
                <input
                  ref={inlineImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void handleInlineImage(event.target.files?.[0])}
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => void uploadAttachments(event.target.files, "image")}
                />
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => void uploadAttachments(event.target.files, "pdf")}
                />
                <div className="mx-1 h-4 w-px bg-border" />
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("undo")} disabled={sending} title="Undo">
                  <Undo className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("redo")} disabled={sending} title="Redo">
                  <Redo className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => exec("removeFormat")} disabled={sending} title="Clear formatting">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Mirrors the HTML the send-admin-mail function wraps around the body. */}
              <div className="bg-[#f4f4f5] p-3 sm:p-5">
                <div className="mx-auto max-w-[600px] overflow-hidden rounded-t-3xl rounded-b-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
                  <div className="rounded-t-3xl border-2 border-[#7c3aed] bg-white px-8 py-6 text-center">
                    <span className="text-[22px] font-bold tracking-[1px] text-[#7c3aed]">INVESTOURS</span>
                  </div>
                  <div className="px-8 pt-8 pb-5">
                    <h1 className="m-0 font-[Arial,Helvetica,sans-serif] text-[22px] font-bold leading-[1.3] text-[#1a1a2e]">
                      {subject.trim() || "Subject line preview"}
                    </h1>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable={!sending}
                    suppressContentEditableWarning
                    onInput={syncEditor}
                    onBlur={() => {
                      upgradeYouTubeLinks();
                      syncEditor();
                    }}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData("text/plain").trim();
                      const id = youTubeId(text);
                      if (id && !/\s/.test(text)) {
                        event.preventDefault();
                        const el = editorRef.current;
                        // Clear any stale YouTube content first
                        el?.querySelectorAll("[data-youtube-block='1'], [data-youtube-thumb='true'], a[href]").forEach((node) => {
                          const href = (node as HTMLAnchorElement).getAttribute?.("href") || "";
                          if (youTubeId(href) || node.getAttribute("data-youtube-block") === "1" || node.getAttribute("data-youtube-thumb") === "true") {
                            node.remove();
                          }
                        });
                        el?.querySelectorAll("p, div, span").forEach((n) => {
                          if (n.textContent && n.textContent.trim() === text && n.children.length === 0) {
                            n.remove();
                          }
                        });
                        insertHtml(youTubeBlock(text, id));
                        window.setTimeout(() => {
                          upgradeYouTubeLinks();
                          syncEditor();
                        }, 0);
                        return;
                      }
                      window.setTimeout(syncEditor, 0);
                    }}
                    className={cn(
                      "min-h-[260px] bg-white px-8 pb-8 pt-0 font-[Arial,Helvetica,sans-serif] text-sm leading-[1.65] text-[#444] outline-none",
                      "[&_p]:mb-4 [&_p]:mt-0",
                      "[&_h1]:mb-4 [&_h1]:mt-0 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:text-[#1a1a2e]",
                      "[&_h2]:mb-3 [&_h2]:mt-0 [&_h2]:text-[18px] [&_h2]:font-bold [&_h2]:text-[#1a1a2e]",
                      "[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2",
                      "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#7c3aed] [&_blockquote]:pl-4 [&_blockquote]:text-[#555]",
                      "[&_a]:text-[#7c3aed] [&_a]:underline",
                      "[&_img]:mb-4 [&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:max-w-[520px] [&_img]:rounded-lg",
                      sending && "pointer-events-none opacity-70",
                    )}
                    data-placeholder="Write your message..."
                  />
                  <div className="bg-[#f4f4f5] px-8 py-5 text-center text-xs text-[#888]">
                    <p className="mb-2">You're receiving this because you have an Investours account.</p>
                    <p>© {new Date().getFullYear()} Investours. All rights reserved.</p>
                  </div>
                </div>
              </div>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <Badge key={attachment.url} variant="secondary" className="gap-1 pr-1">
                    {attachment.kind === "image" ? (
                      <ImageIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <Paperclip className="h-3 w-3 shrink-0" />
                    )}
                    <span className="max-w-[16rem] truncate" title={attachment.name}>{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.url)}
                      disabled={sending}
                      className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-right text-xs text-muted-foreground">{messageText.length.toLocaleString()} characters</p>
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
            <Button onClick={() => void handleSend()} disabled={sending || !subject.trim() || !messageText}>
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
