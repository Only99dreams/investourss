import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TutorPreSurveyProps {
  sessionId: string;
  userId?: string | null;
  topic?: string;
  onComplete: (understanding: string) => void;
  onDismiss: () => void;
}

type Understanding = "well" | "slightly" | "not_at_all";

const options: { value: Understanding; label: string }[] = [
  { value: "well", label: "Well" },
  { value: "slightly", label: "Slightly" },
  { value: "not_at_all", label: "Not at all" },
];

const TutorPreSurvey = ({
  sessionId,
  userId,
  topic,
  onComplete,
  onDismiss,
}: TutorPreSurveyProps) => {
  const [selected, setSelected] = useState<Understanding | null>(null);

  const handleSelect = async (value: Understanding) => {
    setSelected(value);
    try {
      await supabase.from("tutor_survey_responses").insert({
        session_id: sessionId,
        user_id: userId ?? null,
        topic: topic ?? null,
        pre_understanding: value,
      });
    } catch {
      // Non-blocking: survey failure should not affect UX
    }
    onComplete(value);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="mx-4 mb-3 rounded-xl border border-border bg-card/80 backdrop-blur-sm p-3 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-muted-foreground">
            Quick check · Before this lesson, how well do you understand this topic?
          </p>
          <button
            onClick={onDismiss}
            className="text-muted-foreground/60 hover:text-muted-foreground flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-2">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                selected === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/50 hover:bg-primary/5 text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TutorPreSurvey;
