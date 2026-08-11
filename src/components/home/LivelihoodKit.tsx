import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ChevronDown, FileText, GraduationCap, ScanSearch, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KitTool {
  title: string;
  description: string;
  path: string;
  cta: string;
  icon: typeof ScanSearch;
  accent: string;
}

const KIT_TOOLS: KitTool[] = [
  {
    title: "AI Financial Auditor",
    description: "Monitor your financial health, detect financial leakages, and improve financial discipline.",
    path: "/auditor",
    cta: "Open AI Financial Auditor",
    icon: ScanSearch,
    accent: "text-primary bg-primary/10",
  },
  {
    title: "AI Business Planner",
    description: "Build professional business plans, validate business ideas, and prepare for funding opportunities.",
    path: "/business-plan",
    cta: "Open AI Business Planner",
    icon: FileText,
    accent: "text-accent bg-accent/10",
  },
  {
    title: "AI Financial Tutor",
    description: "Learn practical financial management, budgeting, investing, saving, and business finance through AI guidance.",
    path: "/tutor",
    cta: "Open AI Financial Tutor",
    icon: GraduationCap,
    accent: "text-investours-gold bg-investours-gold/10",
  },
  {
    title: "Investment Scam Detector",
    description: "Verify investment opportunities, identify red flags, and protect yourself from investment scams.",
    path: "/vetting",
    cta: "Open Scam Detector",
    icon: ShieldAlert,
    accent: "text-investours-coral bg-investours-coral/10",
  },
];

export const LivelihoodKit = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full max-w-xl mx-auto">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left"
        aria-expanded={open}
      >
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all opacity-50" />
          <div className="relative flex items-center justify-between gap-5 bg-primary rounded-2xl p-6 border border-primary shadow-lg hover:brightness-110 transition-all cursor-pointer">
            <div className="flex items-center gap-5 min-w-0">
              <div className="w-14 h-14 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-7 h-7 text-primary-foreground" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base text-primary-foreground">Livelihood Kit</h3>
                <p className="text-sm text-primary-foreground/70">
                  Everything you need to protect, build and improve your livelihood with AI.
                </p>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "w-6 h-6 text-primary-foreground/60 shrink-0 transition-transform duration-300",
                open && "rotate-180",
              )}
            />
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="grid sm:grid-cols-2 gap-4 pt-4">
              {KIT_TOOLS.map((tool, i) => (
                <motion.div
                  key={tool.title}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.08, duration: 0.35 }}
                >
                  <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-sm flex flex-col text-left">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center mb-3", tool.accent)}>
                      <tool.icon className="w-6 h-6" />
                    </div>
                    <h4 className="font-semibold text-sm">{tool.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1 flex-1">{tool.description}</p>
                    <Link to={tool.path} className="mt-4 block">
                      <Button size="sm" className="w-full group/btn">
                        {tool.cta}
                        <ArrowRight className="ml-1 w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
                      </Button>
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LivelihoodKit;
