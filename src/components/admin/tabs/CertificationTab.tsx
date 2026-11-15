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
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PLAN_TIER_OPTIONS, planLabel } from "@/lib/subscription";

type Tier = "free" | "monthly" | "quarterly" | "biennial" | "annual" | "b2b";
type RequestStatus = "pending" | "approved" | "rejected";

interface CertificationCourse {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  tier_required: Tier | null;
  is_published: boolean | null;
  order_index: number | null;
}

interface CertificationRequest {
  id: string;
  user_id: string;
  course_id: string;
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
  const [profiles, setProfiles] = useState<Record<string, Member>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Course form state
  const [isCourseDialogOpen, setIsCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CertificationCourse | null>(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseTier, setCourseTier] = useState<Tier>("free");
  const [coursePublished, setCoursePublished] = useState(true);

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
    await Promise.all([fetchCourses(), fetchRequests()]);
    setIsLoading(false);
  }, [fetchCourses, fetchRequests]);

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

  const resetCourseForm = () => {
    setEditingCourse(null);
    setCourseTitle("");
    setCourseDescription("");
    setCourseTier("free");
    setCoursePublished(true);
  };

  const openCourseDialog = (course?: CertificationCourse) => {
    if (course) {
      setEditingCourse(course);
      setCourseTitle(course.title);
      setCourseDescription(course.description ?? "");
      setCourseTier((course.tier_required ?? "free") as Tier);
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
      tier_required: courseTier,
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

  const tierLabel = (tier: Tier | null) => planLabel(tier);

  const pendingCount = requests.filter((request) => request.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Certification</h2>
          <p className="text-muted-foreground">
            Manage certification courses, review requests, and issue certificates by email.
          </p>
        </div>
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tier required</Label>
                  <Select value={courseTier} onValueChange={(value: Tier) => setCourseTier(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_TIER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
          <TabsTrigger value="requests">
            Requests{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
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
                        <TableHead>Tier</TableHead>
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
                            <Badge variant="outline">{tierLabel(course.tier_required)}</Badge>
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
    </div>
  );
};

export default CertificationTab;
