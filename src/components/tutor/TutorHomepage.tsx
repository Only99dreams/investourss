import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { BookOpen, Award, TrendingUp, Shield, Target, ChevronRight, Star } from "lucide-react";

type UserLevel = "beginner" | "intermediate" | "advanced" | null;

interface TutorHomepageProps {
  userLevel: UserLevel;
  onLessonClick: (lessonTitle: string) => void;
  xp?: number;
  nextLevelXp?: number;
}

const beginnerLabels = [
  "What is budgeting?",
  "How do I save money?",
  "Emergency funds explained",
  "Needs vs wants",
  "How do banks work?",
  "What is compound interest?",
];

const intermediateLabels = [
  "What are stocks?",
  "How do ETFs work?",
  "How do credit scores work?",
  "Inflation explained",
  "Side hustles",
  "Investment risk",
];

const advancedLabels = [
  "Portfolio diversification",
  "Dividend investing",
  "Retirement planning",
  "Tax strategies",
  "Real estate investing",
  "Market cycles",
];

const levelLabels = {
  beginner: "Learning Foundations",
  intermediate: "Wealth Builder",
  advanced: "Portfolio Mastery",
};

const TutorHomepage = ({ userLevel, onLessonClick, xp = 0, nextLevelXp = 100 }: TutorHomepageProps) => {
  const labels = userLevel 
    ? (userLevel === "beginner" ? beginnerLabels 
      : userLevel === "intermediate" ? intermediateLabels 
      : advancedLabels)
    : beginnerLabels;

  const progressPercent = Math.min((xp / nextLevelXp) * 100, 100);

  return (
    <div className="space-y-8">
      {/* Progress Section */}
      {userLevel && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-foreground">Your Learning Path</h3>
              <p className="text-sm text-muted-foreground">{levelLabels[userLevel]}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1 text-primary">
                <Star className="w-4 h-4 fill-current" />
                <span className="font-bold">{xp} XP</span>
              </div>
            </div>
          </div>
          
          <div className="w-full bg-border rounded-full h-2 mb-2">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {nextLevelXp - xp} XP to next level
          </p>
        </motion.div>
      )}

      {/* Quick Learning Buttons */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          Quick Lessons
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {labels.map((label, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onLessonClick(label)}
              className="group flex items-center justify-between p-4 rounded-xl border border-border hover:border-primary/50 bg-card hover:bg-primary/5 transition-all text-left"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-primary">
                {label}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Learning Categories</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {["Budgeting", "Saving", "Investing", "Credit", "Business"].map((category, i) => (
            <motion.button
              key={category}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => onLessonClick(`Tell me about ${category.toLowerCase()}`)}
              className="p-4 rounded-xl border border-border text-center hover:border-primary/50 bg-card hover:bg-primary/5 transition-all"
            >
              <div className="font-medium text-foreground">{category}</div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Achievement Badges Preview */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Award className="w-5 h-5 text-primary" />
          Your Achievements
        </h3>
        <div className="flex gap-3">
          <div className="flex-1 p-4 rounded-xl border border-border bg-card text-center opacity-60">
            <div className="text-2xl mb-1">🏆</div>
            <div className="text-xs font-medium">First Lesson</div>
          </div>
          <div className="flex-1 p-4 rounded-xl border border-border bg-card text-center opacity-40">
            <div className="text-2xl mb-1">🔒</div>
            <div className="text-xs font-medium">Locked</div>
          </div>
          <div className="flex-1 p-4 rounded-xl border border-border bg-card text-center opacity-40">
            <div className="text-2xl mb-1">🔒</div>
            <div className="text-xs font-medium">Locked</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TutorHomepage;