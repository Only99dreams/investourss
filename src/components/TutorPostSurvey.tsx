import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TutorPostSurveyProps {
  sessionId: string;
  userId?: string | null;
  topic?: string;
  onDismiss: () => void;
}

type Completed = "yes" | "partially" | "no";
type Helpfulness = "very_helpful" | "somewhat_helpful" | "not_helpful";
type Understanding = "well" | "slightly" | "not_at_all";
type WantsAdvanced = "yes" | "maybe" | "no";

interface SurveyAnswers {
  pre_understanding: Understanding | null;
  completed: Completed | null;
  helpfulness: Helpfulness | null;
  post_understanding: Understanding | null;
  what_gained: string;
  wants_advanced: WantsAdvanced | null;
}

const TutorPostSurvey = ({
  sessionId,
  userId,
  topic,
  onDismiss,
}: TutorPostSurveyProps) => {
  const [answers, setAnswers] = useState<SurveyAnswers>({
    pre_understanding: null,
    completed: null,
    helpfulness: null,
    post_understanding: null,
    what_gained: "",
    wants_advanced: null,
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof SurveyAnswers>(key: K, value: SurveyAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const isReady =
    answers.pre_understanding && answers.completed && answers.helpfulness && answers.post_understanding && answers.wants_advanced;

  const handleSubmit = async () => {
    if (!isReady || submitting) return;
    setSubmitting(true);
    try {
      await supabase.from("tutor_survey_responses").upsert({
        session_id: sessionId,
        user_id: userId ?? null,
        topic: topic ?? null,
        pre_understanding: answers.pre_understanding,
        completed: answers.completed,
        helpfulness: answers.helpfulness,
        post_understanding: answers.post_understanding,
        what_gained: answers.what_gained || null,
        wants_advanced: answers.wants_advanced,
      }, { onConflict: "session_id" });
    } catch (err) {
      console.error('[TutorPostSurvey] Failed to save survey:', err);
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  type ChipProps = {
    active: boolean;
    onClick: () => void;
    label: string;
  };

  const Chip = ({ active, onClick, label }: ChipProps) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border hover:border-primary/50 hover:bg-primary/5 text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="mx-4 mt-2 mb-3 rounded-xl border border-border bg-card/90 backdrop-blur-sm p-4 shadow-sm"
      >
        {submitted ? (
          <div className="flex items-center gap-2 text-accent text-sm py-1">
            <CheckCircle2 className="w-4 h-4" />
            <span>Thanks for your feedback!</span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-foreground">Quick lesson feedback</p>
              <button onClick={onDismiss} className="text-muted-foreground/60 hover:text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Q1: Pre-understanding */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Before this lesson, how well did you understand this topic?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "well" as Understanding, l: "Well" },
                    { v: "slightly" as Understanding, l: "Slightly" },
                    { v: "not_at_all" as Understanding, l: "Not at all" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.pre_understanding === v} onClick={() => set("pre_understanding", v)} label={l} />
                  ))}
                </div>
              </div>

              {/* Q2: Completion */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Did you complete this lesson?</p>
                <div className="flex gap-2 flex-wrap">
                  {(["yes", "partially", "no"] as Completed[]).map((v) => (
                    <Chip
                      key={v}
                      active={answers.completed === v}
                      onClick={() => set("completed", v)}
                      label={v.charAt(0).toUpperCase() + v.slice(1)}
                    />
                  ))}
                </div>
              </div>

              {/* Q3: Helpfulness */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">How helpful was this lesson?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "very_helpful" as Helpfulness, l: "Very helpful" },
                    { v: "somewhat_helpful" as Helpfulness, l: "Somewhat" },
                    { v: "not_helpful" as Helpfulness, l: "Not helpful" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.helpfulness === v} onClick={() => set("helpfulness", v)} label={l} />
                  ))}
                </div>
              </div>

              {/* Q4: Post-understanding */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">How well do you understand the topic now?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "well" as Understanding, l: "Well" },
                    { v: "slightly" as Understanding, l: "Slightly" },
                    { v: "not_at_all" as Understanding, l: "Not at all" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.post_understanding === v} onClick={() => set("post_understanding", v)} label={l} />
                  ))}
                </div>
              </div>

              {/* Q5: What gained (optional) */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">What did you gain? <span className="opacity-60">(optional)</span></p>
                <input
                  type="text"
                  value={answers.what_gained}
                  onChange={(e) => set("what_gained", e.target.value)}
                  placeholder="Brief note..."
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={200}
                />
              </div>

              {/* Q6: Wants advanced */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Would you like more advanced tools, mentorship & earning guidance?</p>
                <div className="flex gap-2 flex-wrap">
                  {(["yes", "maybe", "no"] as WantsAdvanced[]).map((v) => (
                    <Chip
                      key={v}
                      active={answers.wants_advanced === v}
                      onClick={() => set("wants_advanced", v)}
                      label={v.charAt(0).toUpperCase() + v.slice(1)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isReady || submitting}
              className={`mt-3 w-full py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isReady
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {submitting ? "Saving..." : "Submit feedback →"}
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default TutorPostSurvey;
