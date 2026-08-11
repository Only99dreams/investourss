import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, ScanSearch, Sparkles, Wallet, BrainCircuit, Shield, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface FeaturedSolution {
  id: string;
  key: string;
  title: string;
  description: string;
  path: string;
  icon: string;
  badge: string | null;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_SOLUTIONS: FeaturedSolution[] = [
  {
    id: "default-bp",
    key: "ai_business_plan",
    title: "AI Business Plan Generator",
    description: "Generate business plans, financial projections & funding readiness reports",
    path: "/business-plan",
    icon: "FileText",
    badge: null,
    sort_order: 1,
    is_active: true,
  },
  {
    id: "default-auditor",
    key: "ai_financial_auditor",
    title: "AI Financial Auditor",
    description: "Audit your finances, detect leakages and recover lost money",
    path: "/auditor",
    icon: "ScanSearch",
    badge: "NEW",
    sort_order: 2,
    is_active: true,
  },
];

const ICONS: Record<string, typeof FileText> = {
  FileText,
  ScanSearch,
  Sparkles,
  Wallet,
  BrainCircuit,
  Shield,
  BarChart3,
};

export const FeaturedSolutions = () => {
  const [solutions, setSolutions] = useState<FeaturedSolution[] | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("featured_solutions")
      .select("id,key,title,description,path,icon,badge,sort_order,is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error || !data || data.length === 0) {
          setSolutions(DEFAULT_SOLUTIONS);
          return;
        }
        setSolutions(data as FeaturedSolution[]);
      })
      .catch(() => {
        if (mounted) setSolutions(DEFAULT_SOLUTIONS);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!solutions) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-secondary/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {solutions.map((s, i) => {
        const Icon = ICONS[s.icon] ?? Sparkles;
        return (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.5 }}
          >
            <Link to={s.path}>
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all opacity-50" />
                <div className="relative flex items-center gap-5 bg-primary rounded-2xl p-6 border border-primary shadow-lg hover:brightness-110 transition-all cursor-pointer">
                  <div className="w-14 h-14 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0">
                    <Icon className="w-7 h-7 text-primary-foreground" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base text-primary-foreground">{s.title}</h3>
                      {s.badge && (
                        <Badge className="bg-accent text-accent-foreground text-xs">{s.badge}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-primary-foreground/70">{s.description}</p>
                  </div>
                  <ArrowRight className="w-6 h-6 text-primary-foreground/60 group-hover:text-primary-foreground group-hover:translate-x-1 transition-all shrink-0" />
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
};
