import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Award,
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Lock,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SUBSCRIPTION_PLANS, SubscriptionPayment } from "@/components/SubscriptionPayment";
import { isActiveSubscriber, meetsPlanTier, planLabel } from "@/lib/subscription";
import { getVideoEmbedUrl } from "@/lib/videoEmbed";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PlanKey = keyof typeof SUBSCRIPTION_PLANS;

const PLAN_ORDER: PlanKey[] = ["monthly", "quarterly", "biennial", "annual", "b2b_quarterly"];

/** The cheapest plan that covers a course's required tier. */
const planForTier = (tier: string | null | undefined): PlanKey => {
  const key = String(tier ?? "").toLowerCase();
  if (key.startsWith("b2b")) return "b2b_quarterly";
  if (key === "annual") return "annual";
  if (key === "biennial") return "biennial";
  if (key === "quarterly") return "quarterly";
  return "monthly";
};

interface CertificationCourse {
  id: string;
  title: string;
  description: string | null;
  tier_required: string | null;
  order_index: number | null;
}

interface CertificationVideo {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  certification_course_id: string;
}

interface CertificationRequestRow {
  id: string;
  course_id: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  admin_notes: string | null;
  certificate_number: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
}

/**
 * Certification requests live in their own dashboard tab so the Education tab
 * stays focused on watching videos. A paid plan is what unlocks a course:
 * members without one (or on a plan below the course tier) see the plans and
 * can subscribe in place instead of hitting a dead end.
 */
export function RequestCertificateSection() {
  const { user, profile, refreshProfile } = useAuth();
  const [courses, setCourses] = useState<CertificationCourse[]>([]);
  const [videos, setVideos] = useState<CertificationVideo[]>([]);
  const [requests, setRequests] = useState<CertificationRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [note, setNote] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);

  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [plan, setPlan] = useState<PlanKey>("monthly");

  const [activeVideo, setActiveVideo] = useState<CertificationVideo | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [courseResult, videoResult] = await Promise.all([
        supabase
          .from("education_certification_courses")
          .select("id, title, description, tier_required, order_index")
          .eq("is_published", true)
          .order("order_index"),
        supabase
          .from("education_modules")
          .select("id, title, description, video_url, certification_course_id")
          .eq("is_published", true)
          .not("certification_course_id", "is", null)
          .order("order_index"),
      ]);

      if (courseResult.error) throw courseResult.error;
      if (videoResult.error) throw videoResult.error;

      setCourses((courseResult.data ?? []) as CertificationCourse[]);
      setVideos((videoResult.data ?? []) as CertificationVideo[]);

      if (user) {
        const { data, error } = await supabase
          .from("education_certification_requests")
          .select("*")
          .eq("user_id", user.id)
          .order("requested_at", { ascending: false });
        if (error) throw error;
        setRequests((data ?? []) as CertificationRequestRow[]);
      }
    } catch (error) {
      console.error("Could not load certification:", error);
      toast.error("Could not load the certification catalogue");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const subscribed = isActiveSubscriber(profile);
  const canRequest = useCallback(
    (course: CertificationCourse | undefined) =>
      Boolean(course) && subscribed && meetsPlanTier(profile, course?.tier_required),
    [profile, subscribed],
  );

  const requestableCourses = useMemo(
    () => courses.filter((course) => canRequest(course)),
    [courses, canRequest],
  );

  const videosByCourse = useMemo(() => {
    const grouped: Record<string, CertificationVideo[]> = {};
    for (const video of videos) {
      const key = video.certification_course_id;
      if (!key) continue;
      (grouped[key] ??= []).push(video);
    }
    return grouped;
  }, [videos]);

  const pendingCourseIds = useMemo(
    () => new Set(requests.filter((row) => row.status === "pending").map((row) => row.course_id)),
    [requests],
  );
  const approvedCourseIds = useMemo(
    () => new Set(requests.filter((row) => row.status === "approved").map((row) => row.course_id)),
    [requests],
  );

  const courseTitle = (courseId: string) =>
    courses.find((course) => course.id === courseId)?.title ?? "Certification course";

  const openPlans = (tier?: string | null) => {
    setPlan(planForTier(tier));
    setIsPlanOpen(true);
  };

  const openRequest = (course: CertificationCourse) => {
    if (!canRequest(course)) {
      toast.info(
        `${planLabel(course.tier_required)} is required for ${course.title}. Choose a plan to continue.`,
      );
      openPlans(course.tier_required);
      return;
    }
    setSelectedCourseId(course.id);
    setNote("");
    setIsRequestOpen(true);
  };

  const handlePurchased = async () => {
    await refreshProfile();
    setIsPlanOpen(false);
    toast.success("Your plan is active. You can request your certificate now.");
  };

  const submitRequest = async () => {
    if (!user) {
      toast.error("Please sign in to request a certification");
      return;
    }
    if (!selectedCourseId) {
      toast.error("Select a certification course");
      return;
    }

    setIsRequesting(true);
    const { error } = await supabase.from("education_certification_requests").insert({
      user_id: user.id,
      course_id: selectedCourseId,
      note: note.trim() || null,
      status: "pending",
    });
    setIsRequesting(false);

    if (error) {
      if (error.code === "23505") {
        toast.error("You already have a pending request for this course");
      } else {
        console.error("Error requesting certification:", error);
        toast.error("Could not send your certification request");
      }
      return;
    }

    toast.success("Certification request sent to the education team");
    setIsRequestOpen(false);
    setSelectedCourseId("");
    setNote("");
    void load();
  };

  const planName = planLabel(profile?.subscription_type ?? (subscribed ? "monthly" : null));
  const expiry = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at).toLocaleDateString("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Request Certificate</h2>
        <p className="text-muted-foreground">
          Request a certificate for any course in our certification catalogue.
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <Card className={cn("border-primary/20", subscribed ? "bg-primary/5" : "bg-muted/40")}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">
                  {subscribed ? `${planName} subscription` : "A paid plan is required"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {subscribed
                    ? `Certification requests are open${expiry ? ` · plan ends ${expiry}` : ""}. A course needs a plan at or above its tier.`
                    : "Certification requests are for subscribers. Choose a plan and you can request a certificate straight away."}
                </p>
              </div>
            </div>
            <Button
              variant={subscribed ? "outline" : "default"}
              onClick={() => openPlans(subscribed ? profile?.subscription_type : "monthly")}
              className="shrink-0"
            >
              {subscribed ? "Change plan" : "View plans"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Award className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              Certification courses will appear here once the education team publishes them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course, index) => {
            const allowed = canRequest(course);
            const courseVideos = videosByCourse[course.id] ?? [];
            const pending = pendingCourseIds.has(course.id);
            const approved = approvedCourseIds.has(course.id);

            return (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="flex h-full flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{course.title}</CardTitle>
                      <Badge variant={allowed ? "secondary" : "outline"} className="shrink-0 gap-1">
                        {allowed ? null : <Lock className="h-3 w-3" />}
                        {planLabel(course.tier_required)}
                      </Badge>
                    </div>
                    <CardDescription>
                      {course.description || "Certification course"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {courseVideos.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Course videos
                        </p>
                        {courseVideos.map((video) => (
                          <button
                            key={video.id}
                            type="button"
                            disabled={!allowed}
                            onClick={() => setActiveVideo(video)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm transition-colors",
                              allowed
                                ? "border-border hover:bg-muted"
                                : "cursor-not-allowed border-dashed text-muted-foreground",
                            )}
                          >
                            {allowed ? (
                              <Play className="h-4 w-4 shrink-0 text-primary" />
                            ) : (
                              <Lock className="h-4 w-4 shrink-0" />
                            )}
                            <span className="truncate">{video.title}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-auto space-y-2">
                      {approved ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Certificate issued
                        </Badge>
                      ) : pending ? (
                        <Badge variant="secondary">Request pending</Badge>
                      ) : null}
                      <Button
                        className="w-full"
                        variant={approved || pending ? "outline" : "default"}
                        disabled={approved || pending}
                        onClick={() => (allowed ? openRequest(course) : openPlans(course.tier_required))}
                      >
                        {approved ? (
                          <>
                            <BadgeCheck className="mr-2 h-4 w-4" /> Approved
                          </>
                        ) : pending ? (
                          "Awaiting review"
                        ) : allowed ? (
                          <>
                            <BadgeCheck className="mr-2 h-4 w-4" /> Request certificate
                          </>
                        ) : (
                          <>
                            <Lock className="mr-2 h-4 w-4" />
                            {subscribed ? "Upgrade to unlock" : "Subscribe to unlock"}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {requests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{courseTitle(request.course_id)}</p>
                  <p className="text-xs text-muted-foreground">
                    Requested{" "}
                    {request.requested_at
                      ? new Date(request.requested_at).toLocaleDateString()
                      : "-"}
                    {request.reviewed_at &&
                      ` · Reviewed ${new Date(request.reviewed_at).toLocaleDateString()}`}
                  </p>
                  {request.admin_notes && (
                    <p className="mt-1 text-xs text-muted-foreground">{request.admin_notes}</p>
                  )}
                  {request.certificate_number && (
                    <p className="mt-1 font-mono text-xs text-emerald-600">
                      {request.certificate_number}
                    </p>
                  )}
                </div>
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
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Request dialog */}
      <Dialog open={isRequestOpen} onOpenChange={setIsRequestOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request training certification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Certification course</Label>
              <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  {requestableCourses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-note">Note (optional)</Label>
              <Textarea
                id="cert-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Anything the education team should know"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsRequestOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void submitRequest()}
                disabled={isRequesting || !selectedCourseId}
              >
                {isRequesting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BadgeCheck className="mr-2 h-4 w-4" />
                )}
                Send request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Subscription dialog */}
      <Dialog open={isPlanOpen} onOpenChange={setIsPlanOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a plan for certification</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Certification requests require an active plan at or above the course tier. Your plan
            also unlocks the course videos.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PLAN_ORDER.map((key) => {
              const detail = SUBSCRIPTION_PLANS[key];
              const selected = plan === key;
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
                  onClick={() => setPlan(key)}
                >
                  <span className="text-xs font-semibold">{detail.name}</span>
                  <span
                    className={cn(
                      "text-[11px]",
                      selected ? "opacity-90" : "text-muted-foreground",
                    )}
                  >
                    ₦{detail.price.toLocaleString()} / {detail.period}
                  </span>
                </Button>
              );
            })}
          </div>
          <SubscriptionPayment
            planType={plan}
            onSuccess={() => void handlePurchased()}
            onCancel={() => setIsPlanOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Course video dialog */}
      <Dialog open={Boolean(activeVideo)} onOpenChange={(open) => !open && setActiveVideo(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeVideo?.title}</DialogTitle>
          </DialogHeader>
          {activeVideo?.video_url ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={getVideoEmbedUrl(activeVideo.video_url)}
                title={activeVideo.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This course video has no playable link yet.
            </p>
          )}
          {activeVideo?.description ? (
            <p className="text-sm text-muted-foreground">{activeVideo.description}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RequestCertificateSection;
