import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ScamDetectorSurveyProps {
  sessionId: string;
  userId?: string | null;
  onDismiss: () => void;
}

type IdentifiedRisk = "yes" | "not_sure" | "no";
type ActionTaken = "avoided" | "cautious" | "continued";
type ConfidenceAfter = "more_confident" | "slightly_confident" | "no_difference";

interface Answers {
  identified_risk: IdentifiedRisk | null;
  action_taken: ActionTaken | null;
  confidence_after: ConfidenceAfter | null;
}

const ScamDetectorSurvey = ({ sessionId, userId, onDismiss }: ScamDetectorSurveyProps) => {
  const [answers, setAnswers] = useState<Answers>({
    identified_risk: null,
    action_taken: null,
    confidence_after: null,
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const isReady = answers.identified_risk && answers.action_taken && answers.confidence_after;

  const handleSubmit = async () => {
    if (!isReady || submitting) return;
    setSubmitting(true);
    try {
      await supabase.from("scam_detector_survey_responses").insert({
        session_id: sessionId,
        user_id: userId ?? null,
        identified_risk: answers.identified_risk,
        action_taken: answers.action_taken,
        confidence_after: answers.confidence_after,
      });
    } catch (err) {
      console.error('[ScamDetectorSurvey] Failed to save survey:', err);
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  type ChipProps = { active: boolean; onClick: () => void; label: string };
  const Chip = ({ active, onClick, label }: ChipProps) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-accent text-accent-foreground border-accent"
          : "border-border hover:border-accent/50 hover:bg-accent/5 text-foreground"
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
        className="mt-4 rounded-xl border border-border bg-card/90 backdrop-blur-sm p-4 shadow-sm"
      >
        {submitted ? (
          <div className="flex items-center gap-2 text-accent text-sm py-1">
            <CheckCircle2 className="w-4 h-4" />
            <span>Thanks! Your feedback helps us improve.</span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-foreground">Quick feedback · 3 taps</p>
              <button onClick={onDismiss} className="text-muted-foreground/60 hover:text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Q1: Identified risk */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Did this tool help you identify a scam or risk?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "yes" as IdentifiedRisk, l: "Yes" },
                    { v: "not_sure" as IdentifiedRisk, l: "Not sure" },
                    { v: "no" as IdentifiedRisk, l: "No" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.identified_risk === v} onClick={() => set("identified_risk", v)} label={l} />
                  ))}
                </div>
              </div>

              {/* Q2: Action taken */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">What action did you take after using this tool?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "avoided" as ActionTaken, l: "Avoided the opportunity" },
                    { v: "cautious" as ActionTaken, l: "Proceeded with caution" },
                    { v: "continued" as ActionTaken, l: "Continued as planned" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.action_taken === v} onClick={() => set("action_taken", v)} label={l} />
                  ))}
                </div>
              </div>

              {/* Q3: Confidence after */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">How confident do you feel after using this tool?</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: "more_confident" as ConfidenceAfter, l: "More confident" },
                    { v: "slightly_confident" as ConfidenceAfter, l: "Slightly confident" },
                    { v: "no_difference" as ConfidenceAfter, l: "No difference" },
                  ]).map(({ v, l }) => (
                    <Chip key={v} active={answers.confidence_after === v} onClick={() => set("confidence_after", v)} label={l} />
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isReady || submitting}
              className={`mt-3 w-full py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isReady
                  ? "bg-accent text-accent-foreground hover:bg-accent/90"
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

export default ScamDetectorSurvey;
