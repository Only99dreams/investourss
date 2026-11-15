import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Award,
  BadgeCheck,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Palette,
  Pencil,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CertificatePreview } from "@/components/certificates/CertificatePreview";
import { CertificatePreviewDialog } from "@/components/certificates/CertificatePreviewDialog";
import {
  CERTIFICATE_PURPOSES,
  CertificateDetails,
  CertificateTemplate,
  DEFAULT_CERTIFICATE_TEMPLATES,
  purposeLabel,
  resolveTemplate,
} from "@/lib/certificateTemplates";

type RequestStatus = "pending" | "approved" | "rejected";

interface CertificationCourse {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  template_id: string | null;
  is_published: boolean | null;
  order_index: number | null;
}

interface CertificationRequest {
  id: string;
  user_id: string;
  course_id: string;
  template_id: string | null;
  status: RequestStatus;
  note: string | null;
  admin_notes: string | null;
  certificate_number: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  notified_at: string | null;
}

interface Member {
  id: string;
  full_name: string | null;
  email: string | null;
  email_opt_in: boolean | null;
}

const BATCH_SIZE = 20;
// certificate_templates is newer than the generated Database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const memberName = (member: Member) =>
  member.full_name?.trim() || member.email?.trim() || "Unnamed member";
const memberEmail = (member: Member) => member.email?.trim().toLowerCase() ?? "";
const certificateNumber = () =>
  `INV-CERT-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : "-";

const CertificationTab = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<CertificationCourse[]>([]);
  const [requests, setRequests] = useState<CertificationRequest[]>([]);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Member>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Course form state
  const [isCourseDialogOpen, setIsCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CertificationCourse | null>(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseTemplateId, setCourseTemplateId] = useState("");
  const [coursePublished, setCoursePublished] = useState(true);

  // Template form state
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CertificateTemplate | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templatePurpose, setTemplatePurpose] = useState("completion");
  const [templateHeading, setTemplateHeading] = useState("Certificate of Completion");
  const [templateIntro, setTemplateIntro] = useState("This certifies that");
  const [templateBody, setTemplateBody] = useState("has successfully completed the");
  const [templateFooter, setTemplateFooter] = useState("Investours Education & Mentorship");
  const [templateIssuerName, setTemplateIssuerName] = useState("Olusegun Emmanuel");
  const [templateIssuerTitle, setTemplateIssuerTitle] = useState("Founder & CEO, Investours");
  const [templateAccentColor, setTemplateAccentColor] = useState("#7c3aed");
  const [templateDefault, setTemplateDefault] = useState(false);
  const [templatePublished, setTemplatePublished] = useState(true);

  // Preview state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<CertificateTemplate | null>(null);
  const [previewDetails, setPreviewDetails] = useState<CertificateDetails>({
    recipientName: "Member name",
    courseTitle: "Course title",
  });

  // Requests state
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "all">("pending");
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [notifyOnReview, setNotifyOnReview] = useState(true);

  // Direct-issue state
  const [issueCourseId, setIssueCourseId] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const fetchCourses = useCallback(async () => {
    const { data, error } = await supabase
      .from("education_certification_courses")
      .select("*")
      .order("order_index");
    if (error) {
      toast.error("Failed to load certification courses");
      return;
    }
    setCourses((data ?? []) as CertificationCourse[]);
  }, []);

  const fetchTemplates = useCallback(async () => {
    const { data, error } = await db
      .from("certificate_templates")
      .select("*")
      .order("order_index");
    if (error) {
      console.error("Could not load certificate templates:", error);
      setTemplates(DEFAULT_CERTIFICATE_TEMPLATES);
      return;
    }
    const rows = (data ?? []) as CertificateTemplate[];
    setTemplates(rows.length > 0 ? rows : DEFAULT_CERTIFICATE_TEMPLATES);
  }, []);

  const fetchRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("education_certification_requests")
      .select("*")
      .order("requested_at", { ascending: false });
    if (error) {
      toast.error("Failed to load certification requests");
      return;
    }
    const rows = (data ?? []) as CertificationRequest[];
    setRequests(rows);

    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    if (userIds.length === 0) {
      setProfiles({});
      return;
    }
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, email, email_opt_in")
      .in("id", userIds);
    if (profileError) {
      console.error("Could not load certification request profiles:", profileError);
      return;
    }
    const next: Record<string, Member> = {};
    for (const profile of (profileRows ?? []) as Member[]) next[profile.id] = profile;
    setProfiles(next);
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchCourses(), fetchRequests(), fetchTemplates()]);
    setIsLoading(false);
  }, [fetchCourses, fetchRequests, fetchTemplates]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const pageSize = 1000;
      const all: Member[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, email, email_opt_in")
          .not("email", "is", null)
          .neq("email", "")
          .order("full_name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as Member[];
        all.push(...rows);
        if (rows.length < pageSize) break;
      }
      setMembers(all);
    } catch (error) {
      console.error("Could not load members:", error);
      toast.error("Failed to load members");
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const coursesById = useMemo(() => {
    const map: Record<string, CertificationCourse> = {};
    for (const course of courses) map[course.id] = course;
    return map;
  }, [courses]);

  const filteredRequests = useMemo(
    () => requests.filter((request) => statusFilter === "all" || request.status === statusFilter),
    [requests, statusFilter],
  );

  const pendingRequests = useMemo(
    () => filteredRequests.filter((request) => request.status === "pending"),
    [filteredRequests],
  );

  const visibleMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    const selectedIds = new Set(selectedMembers.map((member) => member.id));
    const candidates = selectedIds.size > 0
      ? [...selectedMembers, ...members.filter((member) => !selectedIds.has(member.id))]
      : members;
    if (!query) return candidates.slice(0, 200);
    return candidates
      .filter(
        (member) =>
          memberName(member).toLowerCase().includes(query) ||
          memberEmail(member).includes(query),
      )
      .slice(0, 200);
  }, [members, memberSearch, selectedMembers]);

  const templatesById = useMemo(() => {
    const map: Record<string, CertificateTemplate> = {};
    for (const template of templates) map[template.id] = template;
    return map;
  }, [templates]);

  const defaultTemplate = useMemo(
    () => resolveTemplate(templates, null),
    [templates],
  );

  const templateNameFor = (templateId: string | null | undefined) =>
    resolveTemplate(templates, templateId).name;

  const openPreview = (template: CertificateTemplate, details: CertificateDetails) => {
    setPreviewTemplate(template);
    setPreviewDetails(details);
    setIsPreviewOpen(true);
  };

  const resetCourseForm = () => {
    setEditingCourse(null);
    setCourseTitle("");
    setCourseDescription("");
    setCourseTemplateId(defaultTemplate.id);
    setCoursePublished(true);
  };

  const openCourseDialog = (course?: CertificationCourse) => {
    if (course) {
      setEditingCourse(course);
      setCourseTitle(course.title);
      setCourseDescription(course.description ?? "");
      setCourseTemplateId(course.template_id ?? defaultTemplate.id);
      setCoursePublished(course.is_published ?? true);
    } else {
      resetCourseForm();
    }
    setIsCourseDialogOpen(true);
  };

  const handleCourseSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!courseTitle.trim()) {
      toast.error("Course title is required");
      return;
    }

    const payload = {
      title: courseTitle.trim(),
      description: courseDescription.trim() || null,
      category: "Certification",
      template_id: courseTemplateId || null,
      is_published: coursePublished,
      order_index: editingCourse
        ? editingCourse.order_index ?? 0
        : courses.reduce((max, course) => Math.max(max, course.order_index ?? 0), 0) + 1,
    };

    setWorking(true);
    const { error } = editingCourse
      ? await supabase
          .from("education_certification_courses")
          .update(payload)
          .eq("id", editingCourse.id)
      : await supabase.from("education_certification_courses").insert(payload);
    setWorking(false);

    if (error) {
      console.error("Could not save certification course:", error);
      toast.error("Failed to save certification course");
      return;
    }
    toast.success(editingCourse ? "Course updated" : "Course created");
    setIsCourseDialogOpen(false);
    resetCourseForm();
    void fetchCourses();
  };

  const toggleCoursePublished = async (course: CertificationCourse) => {
    const { error } = await supabase
      .from("education_certification_courses")
      .update({ is_published: !course.is_published })
      .eq("id", course.id);
    if (error) {
      toast.error("Failed to update course");
      return;
    }
    void fetchCourses();
  };

  const handleDeleteCourse = async (course: CertificationCourse) => {
    if (!confirm(`Delete "${course.title}"? Existing requests for it will also be removed.`)) return;
    const { error } = await supabase
      .from("education_certification_courses")
      .delete()
      .eq("id", course.id);
    if (error) {
      toast.error("Failed to delete course");
      return;
    }
    toast.success("Course deleted");
    void loadAll();
  };

  const resetTemplateForm = () => {
    setEditingTemplate(null);
    setTemplateName("");
    setTemplatePurpose("completion");
    setTemplateHeading("Certificate of Completion");
    setTemplateIntro("This certifies that");
    setTemplateBody("has successfully completed the");
    setTemplateFooter("Investours Education & Mentorship");
    setTemplateIssuerName("Olusegun Emmanuel");
    setTemplateIssuerTitle("Founder & CEO, Investours");
    setTemplateAccentColor("#7c3aed");
    setTemplateDefault(false);
    setTemplatePublished(true);
  };

  const openTemplateDialog = (template?: CertificateTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateName(template.name);
      setTemplatePurpose(template.purpose ?? "completion");
      setTemplateHeading(template.heading);
      setTemplateIntro(template.intro_text ?? "");
      setTemplateBody(template.body_text ?? "");
      setTemplateFooter(template.footer_note ?? "");
      setTemplateIssuerName(template.issuer_name ?? "");
      setTemplateIssuerTitle(template.issuer_title ?? "");
      setTemplateAccentColor(template.accent_color ?? "#7c3aed");
      setTemplateDefault(template.is_default ?? false);
      setTemplatePublished(template.is_published ?? true);
    } else {
      resetTemplateForm();
    }
    setIsTemplateDialogOpen(true);
  };

  const handleTemplateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateName.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (!templateHeading.trim()) {
      toast.error("Certificate heading is required");
      return;
    }

    setWorking(true);
    // The table allows a single default, so clear the old one first.
    if (templateDefault) {
      const { error } = await db
        .from("certificate_templates")
        .update({ is_default: false })
        .eq("is_default", true);
      if (error) {
        setWorking(false);
        toast.error("Failed to update the default template");
        return;
      }
    }

    const payload = {
      name: templateName.trim(),
      purpose: templatePurpose,
      heading: templateHeading.trim(),
      intro_text: templateIntro.trim() || null,
      body_text: templateBody.trim() || null,
      footer_note: templateFooter.trim() || null,
      issuer_name: templateIssuerName.trim() || null,
      issuer_title: templateIssuerTitle.trim() || null,
      accent_color: templateAccentColor,
      is_published: templatePublished,
      is_default: templateDefault,
      order_index: editingTemplate
        ? editingTemplate.order_index ?? 0
        : templates.reduce((max, template) => Math.max(max, template.order_index ?? 0), 0) + 1,
    };

    const { error } = editingTemplate
      ? await db.from("certificate_templates").update(payload).eq("id", editingTemplate.id)
      : await db.from("certificate_templates").insert(payload);
    setWorking(false);

    if (error) {
      console.error("Could not save certificate template:", error);
      toast.error(
        error.code === "23505"
          ? "A template with that name already exists"
          : "Failed to save certificate template",
      );
      return;
    }
    toast.success(editingTemplate ? "Template updated" : "Template created");
    setIsTemplateDialogOpen(false);
    resetTemplateForm();
    void fetchTemplates();
  };

  const toggleTemplatePublished = async (template: CertificateTemplate) => {
    const { error } = await db
      .from("certificate_templates")
      .update({ is_published: !template.is_published })
      .eq("id", template.id);
    if (error) {
      toast.error("Failed to update template");
      return;
    }
    void fetchTemplates();
  };

  const makeTemplateDefault = async (template: CertificateTemplate) => {
    setWorking(true);
    await db.from("certificate_templates").update({ is_default: false }).eq("is_default", true);
    const { error } = await db
      .from("certificate_templates")
      .update({ is_default: true })
      .eq("id", template.id);
    setWorking(false);
    if (error) {
      toast.error("Failed to set the default template");
      return;
    }
    toast.success(`"${template.name}" is now the default design`);
    void fetchTemplates();
  };

  const handleDeleteTemplate = async (template: CertificateTemplate) => {
    if (
      !confirm(
        `Delete "${template.name}"? Courses using it will fall back to the default design.`,
      )
    )
      return;
    const { error } = await db
      .from("certificate_templates")
      .delete()
      .eq("id", template.id);
    if (error) {
      toast.error("Failed to delete template");
      return;
    }
    if (template.is_default) {
      const next = templates.find((item) => item.id !== template.id);
      if (next) await db.from("certificate_templates").update({ is_default: true }).eq("id", next.id);
    }
    toast.success("Template deleted");
    void loadAll();
  };

  const demoCertificateDetails: CertificateDetails = {
    recipientName: "Member name",
    courseTitle: "Course title",
  };

  const sendCertificationEmail = async (course: CertificationCourse, recipients: Member[]) => {
    const deliverable = recipients.filter(
      (member) => memberEmail(member) && member.email_opt_in !== false,
    );
    if (deliverable.length === 0) return;

    const subject = `Your ${course.title} certification is approved`;
    const message =
      `Hello,\n\nYour certification for "${course.title}" has been approved by the Investours education team.\n\n` +
      `Your certificate is now available on your dashboard under Education & Mentorship → Certification.\n\n` +
      `Congratulations,\nInvestours Education Team`;
    const html = message
      .split("\n")
      .map((line) => `<p>${line || "&nbsp;"}</p>`)
      .join("");

    for (let index = 0; index < deliverable.length; index += BATCH_SIZE) {
      const batch = deliverable.slice(index, index + BATCH_SIZE);
      const { error } = await supabase.functions.invoke("send-admin-mail", {
        body: {
          subject,
          message,
          html,
          includeOptedOut: false,
          recipients: batch.map((member) => ({
            id: member.id,
            email: memberEmail(member),
            name: member.full_name,
          })),
        },
      });
      if (error) {
        console.error("Could not send certification email:", error);
        toast.error("Certification saved, but the email could not be sent");
        return;
      }
    }
    toast.success(
      `Email sent to ${deliverable.length} member${deliverable.length === 1 ? "" : "s"}`,
    );
  };

  const groupedMembersForRequests = (rows: CertificationRequest[]) => {
    const groups = new Map<string, Member[]>();
    for (const row of rows) {
      const member = profiles[row.user_id];
      if (!member) continue;
      const existing = groups.get(row.course_id) ?? [];
      if (!existing.some((item) => item.id === member.id)) existing.push(member);
      groups.set(row.course_id, existing);
    }
    return groups;
  };

  const approveRequests = async (rows: CertificationRequest[]) => {
    const pending = rows.filter((row) => row.status === "pending");
    if (pending.length === 0) {
      toast.error("Select at least one pending request");
      return;
    }

    setWorking(true);
    const now = new Date().toISOString();
    const approved: CertificationRequest[] = [];
    let failures = 0;

    for (const row of pending) {
      const { error } = await supabase
        .from("education_certification_requests")
        .update({
          status: "approved",
          reviewed_at: now,
          reviewed_by: user?.id ?? null,
          certificate_number: row.certificate_number || certificateNumber(),
          admin_notes: adminNote.trim() || row.admin_notes,
          notified_at: notifyOnReview ? now : row.notified_at,
        })
        .eq("id", row.id);
      if (error) {
        failures += 1;
        console.error("Could not approve certification request:", error);
      } else {
        approved.push(row);
      }
    }
    setWorking(false);

    if (failures > 0) toast.error(`${failures} request${failures === 1 ? "" : "s"} could not be approved`);
    if (approved.length > 0) {
      toast.success(`${approved.length} certification${approved.length === 1 ? "" : "s"} approved`);
    }

    if (notifyOnReview && approved.length > 0) {
      for (const [courseId, recipients] of groupedMembersForRequests(approved)) {
        const course = coursesById[courseId];
        if (course) await sendCertificationEmail(course, recipients);
      }
    }

    setSelectedRequestIds([]);
    setAdminNote("");
    void fetchRequests();
  };

  const rejectRequests = async (rows: CertificationRequest[]) => {
    const pending = rows.filter((row) => row.status === "pending");
    if (pending.length === 0) {
      toast.error("Select at least one pending request");
      return;
    }
    if (!confirm(`Reject ${pending.length} certification request${pending.length === 1 ? "" : "s"}?`)) return;

    setWorking(true);
    const { error } = await supabase
      .from("education_certification_requests")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id ?? null,
        admin_notes: adminNote.trim() || null,
      })
      .in(
        "id",
        pending.map((row) => row.id),
      );
    setWorking(false);

    if (error) {
      toast.error("Failed to reject requests");
      return;
    }
    toast.success(`${pending.length} request${pending.length === 1 ? "" : "s"} rejected`);
    setSelectedRequestIds([]);
    setAdminNote("");
    void fetchRequests();
  };

  const toggleRequest = (id: string) => {
    setSelectedRequestIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  };

  const toggleAllVisible = () => {
    const ids = pendingRequests.map((request) => request.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedRequestIds.includes(id));
    setSelectedRequestIds((prev) =>
      allSelected
        ? prev.filter((id) => !ids.includes(id))
        : Array.from(new Set([...prev, ...ids])),
    );
  };

  const toggleMember = (member: Member) => {
    setSelectedMembers((prev) =>
      prev.some((item) => item.id === member.id)
        ? prev.filter((item) => item.id !== member.id)
        : [...prev, member],
    );
  };

  const issueCertifications = async () => {
    const course = coursesById[issueCourseId];
    if (!course) {
      toast.error("Choose a certification course");
      return;
    }
    if (selectedMembers.length === 0) {
      toast.error("Select at least one member");
      return;
    }

    const targetIds = selectedMembers.map((member) => member.id);
    setWorking(true);

    const { data: existingRows, error: existingError } = await supabase
      .from("education_certification_requests")
      .select("id, user_id, status")
      .eq("course_id", course.id)
      .in("user_id", targetIds);

    if (existingError) {
      setWorking(false);
      toast.error("Failed to check existing certifications");
      return;
    }

    const existing = (existingRows ?? []) as Array<{ id: string; user_id: string; status: string }>;
    const approvedIds = new Set(existing.filter((row) => row.status === "approved").map((row) => row.user_id));
    const pendingByUser = new Map(existing.filter((row) => row.status === "pending").map((row) => [row.user_id, row.id]));

    const now = new Date().toISOString();
    const issued: Member[] = [];
    let failures = 0;
    let skipped = 0;

    for (const member of selectedMembers) {
      if (approvedIds.has(member.id)) {
        skipped += 1;
        continue;
      }
      const pendingId = pendingByUser.get(member.id);
      const payload = {
        status: "approved" as const,
        reviewed_at: now,
        reviewed_by: user?.id ?? null,
        template_id: course.template_id ?? null,
        certificate_number: certificateNumber(),
        admin_notes: issueNote.trim() || null,
        notified_at: now,
      };
      const { error } = pendingId
        ? await supabase.from("education_certification_requests").update(payload).eq("id", pendingId)
        : await supabase.from("education_certification_requests").insert({
            ...payload,
            user_id: member.id,
            course_id: course.id,
          });
      if (error) {
        failures += 1;
        console.error("Could not issue certification:", error);
      } else {
        issued.push(member);
      }
    }

    setWorking(false);

    if (issued.length > 0) {
      toast.success(
        `${issued.length} certificate${issued.length === 1 ? "" : "s"} issued${skipped ? `, ${skipped} already certified` : ""}`,
      );
      await sendCertificationEmail(course, issued);
      setSelectedMembers([]);
      setIssueNote("");
      void fetchRequests();
    } else if (failures > 0) {
      toast.error("Failed to issue certifications");
    } else {
      toast.info("Everyone selected already has this certification");
    }
  };

  const pendingCount = requests.filter((request) => request.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Certification</h2>
          <p className="text-muted-foreground">
            Manage certificate templates, courses, requests, and issue certificates by email.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog
            open={isTemplateDialogOpen}
            onOpenChange={(open) => {
              setIsTemplateDialogOpen(open);
              if (!open) resetTemplateForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" onClick={() => openTemplateDialog()}>
                <Palette className="mr-2 h-4 w-4" />
                Add Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingTemplate ? "Edit Certificate Template" : "New Certificate Template"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleTemplateSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Template name *</Label>
                    <Input
                      id="template-name"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="e.g., Certificate of Completion"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Purpose</Label>
                    <Select value={templatePurpose} onValueChange={setTemplatePurpose}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CERTIFICATE_PURPOSES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-heading">Certificate heading *</Label>
                  <Input
                    id="template-heading"
                    value={templateHeading}
                    onChange={(event) => setTemplateHeading(event.target.value)}
                    placeholder="Certificate of Completion"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="template-intro">Line above the name</Label>
                    <Input
                      id="template-intro"
                      value={templateIntro}
                      onChange={(event) => setTemplateIntro(event.target.value)}
                      placeholder="This certifies that"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-body">Line below the name</Label>
                    <Input
                      id="template-body"
                      value={templateBody}
                      onChange={(event) => setTemplateBody(event.target.value)}
                      placeholder="has successfully completed the"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="template-issuer-name">Signatory name</Label>
                    <Input
                      id="template-issuer-name"
                      value={templateIssuerName}
                      onChange={(event) => setTemplateIssuerName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-issuer-title">Signatory title</Label>
                    <Input
                      id="template-issuer-title"
                      value={templateIssuerTitle}
                      onChange={(event) => setTemplateIssuerTitle(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-footer">Footer note</Label>
                  <Input
                    id="template-footer"
                    value={templateFooter}
                    onChange={(event) => setTemplateFooter(event.target.value)}
                    placeholder="Investours Education & Mentorship"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="template-accent">Accent colour</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="template-accent"
                        type="color"
                        value={templateAccentColor}
                        onChange={(event) => setTemplateAccentColor(event.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border border-input bg-background"
                      />
                      <Input
                        value={templateAccentColor}
                        onChange={(event) => setTemplateAccentColor(event.target.value)}
                        className="font-mono uppercase"
                        maxLength={9}
                      />
                    </div>
                  </div>
                  <div className="space-y-3 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={templatePublished}
                        onCheckedChange={setTemplatePublished}
                      />
                      Visible to members
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={templateDefault} onCheckedChange={setTemplateDefault} />
                      Default design
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Preview</Label>
                  <CertificatePreview
                    template={{
                      id: editingTemplate?.id ?? "draft",
                      name: templateName || "Certificate",
                      purpose: templatePurpose,
                      heading: templateHeading || "Certificate",
                      intro_text: templateIntro,
                      body_text: templateBody,
                      footer_note: templateFooter,
                      issuer_name: templateIssuerName,
                      issuer_title: templateIssuerTitle,
                      accent_color: templateAccentColor,
                      is_published: templatePublished,
                      is_default: templateDefault,
                      order_index: editingTemplate?.order_index ?? 0,
                    }}
                    details={demoCertificateDetails}
                    className="border"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={working}>
                    {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingTemplate ? "Update Template" : "Create Template"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isCourseDialogOpen}
            onOpenChange={(open) => {
              setIsCourseDialogOpen(open);
              if (!open) resetCourseForm();
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => openCourseDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                Add Course
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingCourse ? "Edit Certification Course" : "New Certification Course"}</DialogTitle>
              </DialogHeader>
            <form onSubmit={handleCourseSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cert-title">Course title *</Label>
                <Input
                  id="cert-title"
                  value={courseTitle}
                  onChange={(event) => setCourseTitle(event.target.value)}
                  placeholder="e.g., Investment Fundamentals Certification"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cert-description">Description</Label>
                <Textarea
                  id="cert-description"
                  value={courseDescription}
                  onChange={(event) => setCourseDescription(event.target.value)}
                  placeholder="What the learner will be certified for"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Certificate template</Label>
                <Select value={courseTemplateId} onValueChange={setCourseTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a certificate design" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.is_default ? " · default" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {courseTemplateId && templatesById[courseTemplateId] ? (
                  <button
                    type="button"
                    className="mt-1 w-full text-left"
                    onClick={() =>
                      openPreview(templatesById[courseTemplateId], {
                        recipientName: "Member name",
                        courseTitle: courseTitle.trim() || "Course title",
                      })
                    }
                  >
                    <CertificatePreview
                      template={templatesById[courseTemplateId]}
                      details={{
                        recipientName: "Member name",
                        courseTitle: courseTitle.trim() || "Course title",
                      }}
                      className="border"
                    />
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Published</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch checked={coursePublished} onCheckedChange={setCoursePublished} />
                  <span className="text-sm text-muted-foreground">
                    {coursePublished ? "Visible to users" : "Hidden"}
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsCourseDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={working}>
                  {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingCourse ? "Update Course" : "Create Course"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Award className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{courses.length}</p>
              <p className="text-sm text-muted-foreground">Courses</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Palette className="h-8 w-8 text-sky-500" />
            <div>
              <p className="text-2xl font-bold">{templates.length}</p>
              <p className="text-sm text-muted-foreground">Templates</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BadgeCheck className="h-8 w-8 text-emerald-500" />
            <div>
              <p className="text-2xl font-bold">
                {requests.filter((request) => request.status === "approved").length}
              </p>
              <p className="text-sm text-muted-foreground">Approved certificates</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Mail className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-sm text-muted-foreground">Pending requests</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="requests">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="requests">
            Requests{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="issue">Issue &amp; email</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["pending", "approved", "rejected", "all"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => {
                  setStatusFilter(value);
                  setSelectedRequestIds([]);
                }}
              >
                {value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </div>

          {selectedRequestIds.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-medium">
                  {selectedRequestIds.length} request{selectedRequestIds.length === 1 ? "" : "s"} selected
                </p>
                <Input
                  value={adminNote}
                  onChange={(event) => setAdminNote(event.target.value)}
                  placeholder="Optional note to attach to the review"
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={notifyOnReview}
                    onCheckedChange={(value) => setNotifyOnReview(value === true)}
                  />
                  Email the member{selectedRequestIds.length === 1 ? "" : "s"} after approving
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={working}
                    onClick={() =>
                      void approveRequests(
                        requests.filter((request) => selectedRequestIds.includes(request.id)),
                      )
                    }
                  >
                    {working ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Approve selected
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={working}
                    onClick={() =>
                      void rejectRequests(
                        requests.filter((request) => selectedRequestIds.includes(request.id)),
                      )
                    }
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject selected
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Certification requests</CardTitle>
              <CardDescription>
                Approve learners individually or select a group to approve at once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading requests...
                </div>
              ) : filteredRequests.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">No requests in this view.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={
                              pendingRequests.length > 0 &&
                              pendingRequests.every((request) =>
                                selectedRequestIds.includes(request.id),
                              )
                            }
                            onCheckedChange={toggleAllVisible}
                            aria-label="Select all pending requests"
                          />
                        </TableHead>
                        <TableHead>Member</TableHead>
                        <TableHead>Course</TableHead>
                        <TableHead>Requested</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Certificate</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequests.map((request) => {
                        const member = profiles[request.user_id];
                        const course = coursesById[request.course_id];
                        return (
                          <TableRow key={request.id}>
                            <TableCell>
                              <Checkbox
                                disabled={request.status !== "pending"}
                                checked={selectedRequestIds.includes(request.id)}
                                onCheckedChange={() => toggleRequest(request.id)}
                                aria-label={`Select ${member ? memberName(member) : "request"}`}
                              />
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">
                                {member ? memberName(member) : "Unknown member"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {member?.email ?? "No email"}
                              </p>
                            </TableCell>
                            <TableCell>{course?.title ?? "Deleted course"}</TableCell>
                            <TableCell>{formatDate(request.requested_at)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  request.status === "approved"
                                    ? "default"
                                    : request.status === "rejected"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {request.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {request.certificate_number ?? "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {request.status === "pending" ? (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Approve"
                                    disabled={working}
                                    onClick={() => void approveRequests([request])}
                                  >
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Reject"
                                    disabled={working}
                                    onClick={() => void rejectRequests([request])}
                                  >
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Email certificate approval"
                                  disabled={working || !member}
                                  onClick={() => {
                                    if (!course || !member) return;
                                    void sendCertificationEmail(course, [member]);
                                  }}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Certification courses</CardTitle>
              <CardDescription>
                These appear in the user dropdown when requesting a training certification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="py-8 text-center text-muted-foreground">Loading...</p>
              ) : courses.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No certification courses yet. Click "Add Course" to create one.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {courses.map((course) => (
                        <TableRow key={course.id}>
                          <TableCell className="font-medium">{course.title}</TableCell>
                          <TableCell className="max-w-xs truncate text-muted-foreground">
                            {course.description || "-"}
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() =>
                                openPreview(resolveTemplate(templates, course.template_id), {
                                  recipientName: "Member name",
                                  courseTitle: course.title,
                                })
                              }
                            >
                              <Badge variant="outline">
                                {templateNameFor(course.template_id)}
                              </Badge>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void toggleCoursePublished(course)}
                              title={course.is_published ? "Unpublish" : "Publish"}
                            >
                              {course.is_published ? (
                                <Eye className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => openCourseDialog(course)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleDeleteCourse(course)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Certificate templates</CardTitle>
              <CardDescription>
                Reusable designs for different purposes. Courses use the template attached to them,
                or the default design when none is chosen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => openTemplateDialog()}>
                  <Plus className="mr-2 h-4 w-4" /> New template
                </Button>
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-muted-foreground">Loading...</p>
              ) : templates.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No certificate templates yet. Create one to control how certificates look.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {templates.map((template) => (
                    <div key={template.id} className="space-y-2 rounded-lg border p-3">
                      <button
                        type="button"
                        className="group w-full text-left"
                        onClick={() => openPreview(template, demoCertificateDetails)}
                      >
                        <CertificatePreview
                          template={template}
                          details={demoCertificateDetails}
                          className="border transition-shadow group-hover:shadow-md"
                        />
                      </button>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{template.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {purposeLabel(template.purpose)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {template.is_default ? <Badge>Default</Badge> : null}
                          <Badge variant={template.is_published ? "secondary" : "outline"}>
                            {template.is_published ? "Live" : "Hidden"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Preview"
                          onClick={() => openPreview(template, demoCertificateDetails)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit"
                          onClick={() => openTemplateDialog(template)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={template.is_published ? "Hide" : "Publish"}
                          onClick={() => void toggleTemplatePublished(template)}
                        >
                          {template.is_published ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4 text-emerald-500" />
                          )}
                        </Button>
                        {!template.is_default ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Make default"
                            disabled={working}
                            onClick={() => void makeTemplateDefault(template)}
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete"
                          onClick={() => void handleDeleteTemplate(template)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" /> Issue certificates &amp; email
              </CardTitle>
              <CardDescription>
                Create an approved certification for selected members and email them the approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Certification course *</Label>
                  <Select value={issueCourseId} onValueChange={setIssueCourseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Note (optional)</Label>
                  <Input
                    value={issueNote}
                    onChange={(event) => setIssueNote(event.target.value)}
                    placeholder="Internal note stored on the certification"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="h-4 w-4" /> Members
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder="Search members by name or email..."
                    className="pl-9"
                  />
                </div>

                {selectedMembers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedMembers.map((member) => (
                      <Badge key={member.id} variant="secondary" className="gap-1 pr-1">
                        <span className="max-w-[14rem] truncate">{memberName(member)}</span>
                        <button
                          type="button"
                          onClick={() => toggleMember(member)}
                          className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                          aria-label={`Remove ${memberName(member)}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="max-h-72 overflow-y-auto rounded-md border">
                  {loadingMembers ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading members...
                    </div>
                  ) : visibleMembers.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">No members found.</p>
                  ) : (
                    visibleMembers.map((member) => {
                      const checked = selectedMembers.some((item) => item.id === member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleMember(member)}
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
                              {member.email_opt_in === false && " · opted out of email"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => void issueCertifications()}
                  disabled={working || !issueCourseId || selectedMembers.length === 0}
                >
                  {working ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Issue certifications &amp; email
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CertificatePreviewDialog
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
        template={previewTemplate}
        details={previewDetails}
        title={previewTemplate ? `${previewTemplate.name} preview` : undefined}
      />
    </div>
  );
};

export default CertificationTab;
