import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Interest = "budgeting" | "saving" | "investing" | "credit" | "business";
type Level = "beginner" | "intermediate" | "advanced";
type Goal = "save_money" | "start_investing" | "escape_debt" | "build_wealth";

interface OnboardingData {
  interest: Interest | null;
  level: Level | null;
  goal: Goal | null;
}

interface FinancialTutorOnboardingProps {
  onComplete: (level: Level | null) => void;
}

const interestOptions: { value: Interest; label: string; icon: string }[] = [
  { value: "budgeting", label: "Budgeting", icon: "💰" },
  { value: "saving", label: "Saving", icon: "🏦" },
  { value: "investing", label: "Investing", icon: "📈" },
  { value: "credit", label: "Credit", icon: "💳" },
  { value: "business", label: "Business", icon: "🏢" },
];

const levelOptions: { value: Level; label: string; description: string }[] = [
  { value: "beginner", label: "Beginner", description: "New to financial concepts" },
  { value: "intermediate", label: "Intermediate", description: "Some financial knowledge" },
  { value: "advanced", label: "Advanced", description: "Confident investor" },
];

const goalOptions: { value: Goal; label: string; icon: string }[] = [
  { value: "save_money", label: "Save Money", icon: "💰" },
  { value: "start_investing", label: "Start Investing", icon: "📈" },
  { value: "escape_debt", label: "Escape Debt", icon: "🔓" },
  { value: "build_wealth", label: "Build Wealth", icon: "🏆" },
];

const learningPaths: Record<string, string> = {
  "beginner-budgeting": "Financial Foundations",
  "beginner-saving": "Financial Foundations",
  "beginner-investing": "Investing Basics",
  "beginner-credit": "Credit Mastery",
  "beginner-business": "Business Fundamentals",
  "intermediate-budgeting": "Smart Budgeting",
  "intermediate-saving": "Growth Saving",
  "intermediate-investing": "Wealth Builder",
  "intermediate-credit": "Credit Strategy",
  "intermediate-business": "Business Scaling",
  "advanced-budgeting": "Portfolio Mastery",
  "advanced-saving": "Wealth Optimization",
  "advanced-investing": "Portfolio Mastery",
  "advanced-credit": "Advanced Credit",
  "advanced-business": "Business Empire",
};

const FinancialTutorOnboarding = ({ onComplete }: FinancialTutorOnboardingProps) => {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({
    interest: null,
    level: null,
    goal: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  const handleSelect = (key: keyof OnboardingData, value: Interest | Level | Goal) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const getLearningPath = () => {
    if (data.level && data.interest) {
      return learningPaths[`${data.level}-${data.interest}`] || "Financial Foundations";
    }
    return "Financial Foundations";
  };

  const handleComplete = async () => {
    if (!data.interest || !data.level || !data.goal) return;
    
    setIsSubmitting(true);
    
    try {
      if (user) {
        await supabase.from("profiles").update({
          tutor_interest: data.interest,
          tutor_level: data.level,
          tutor_goal: data.goal,
        }).eq("id", user.id);
      }
      
      localStorage.setItem("tutor_onboarding", JSON.stringify(data));
      onComplete(data.level);
    } catch (error) {
      console.error("Onboarding error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">
            {step === 1 && "What do you want to learn?"}
            {step === 2 && "What is your current level?"}
            {step === 3 && "What is your financial goal?"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {step === 1 && (
                <div className="grid grid-cols-1 gap-3">
                  {interestOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect("interest", opt.value)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        data.interest === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{opt.icon}</span>
                        <span className="font-medium">{opt.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-1 gap-3">
                  {levelOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect("level", opt.value)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        data.level === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-sm text-muted-foreground">{opt.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="grid grid-cols-1 gap-3">
                  {goalOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect("goal", opt.value)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        data.goal === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{opt.icon}</span>
                        <span className="font-medium">{opt.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between mt-6">
            <Button
              variant="ghost"
              onClick={() => setStep(step - 1)}
              disabled={step === 1}
            >
              Back
            </Button>
            
            {step < 3 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={
                  (step === 1 && !data.interest) ||
                  (step === 2 && !data.level) ||
                  (step === 3 && !data.goal)
                }
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={isSubmitting}>
                {isSubmitting ? "Starting..." : "Start Learning"}
              </Button>
            )}
          </div>

          <div className="flex justify-center mt-4 gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full ${
                  s === step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FinancialTutorOnboarding;