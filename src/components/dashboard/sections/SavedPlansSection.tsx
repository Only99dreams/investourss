import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Eye, Download, Trash2, Loader2, AlertCircle, BookOpen, Crown, Lock } from "lucide-react";
import { downloadPDF, downloadDOCX } from "@/lib/planExport";
import { cn } from "@/lib/utils";

interface SavedPlan {
  id: string;
  name: string;
  form_data: any;
  plan_content: string;
  version: string;
  created_at: string;
  updated_at: string;
}

const FREE_SAVE_LIMIT = 3;

export function SavedPlansSection() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const isPremium = profile?.user_tier === "premium" || profile?.user_tier === "exclusive";

  useEffect(() => {
    if (user) fetchPlans();
  }, [user]);

  const fetchPlans = async () => {
    try {
      const { data, error } = await supabase
        .from("business_plans")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPlans(data || []);
    } catch (err: any) {
      console.error("Error fetching plans:", err);
      toast({ title: "Error", description: "Failed to load saved plans", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!window.confirm("Delete this plan? This cannot be undone.")) return;
    setDeletingId(planId);
    try {
      const { error } = await supabase.from("business_plans").delete().eq("id", planId);
      if (error) throw error;
      setPlans(prev => prev.filter(p => p.id !== planId));
      toast({ title: "Deleted", description: "Plan has been removed." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to delete plan", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleView = (plan: SavedPlan) => {
    navigate("/business-plan", { state: { savedPlan: plan } });
  };

  const handleDownloadPDF = (plan: SavedPlan) => {
    if (!isPremium) {
      toast({ title: "Premium Feature", description: "Upgrade to Premium to download plans.", variant: "destructive" });
      return;
    }
    downloadPDF(plan.plan_content, plan.name);
  };

  const handleDownloadDOCX = (plan: SavedPlan) => {
    if (!isPremium) {
      toast({ title: "Premium Feature", description: "Upgrade to Premium to download plans.", variant: "destructive" });
      return;
    }
    downloadDOCX(plan.plan_content, plan.name);
  };

  const remainingSlots = FREE_SAVE_LIMIT - plans.length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Saved Business Plans</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isPremium
              ? "Unlimited saved plans"
              : `${remainingSlots} of ${FREE_SAVE_LIMIT} free slots remaining`
            }
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/business-plan")}>
          <FileText className="w-4 h-4 mr-2" />
          New Plan
        </Button>
      </div>

      {!isPremium && remainingSlots <= 1 && (
        <Card className="border-amber-500/30 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-800">
                  {remainingSlots === 0
                    ? "You've used all free save slots. Upgrade to Premium to save unlimited plans."
                    : "You have only 1 free save slot remaining."
                  }
                </p>
                <p className="text-sm text-amber-700 mt-1.5 italic">
                  Unlock <Lock className="w-3 h-3 inline-block align-text-top" /> Download (PDF/DOC) with{" "}
                  <strong className="not-italic">₦4,500 Premium Plan for a Month</strong>
                </p>
              </div>
              <Button size="sm" variant="default" onClick={() => navigate("/pricing")}>
                <Crown className="w-4 h-4 mr-1" /> Upgrade
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No saved plans yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Generate your first business plan and save it here.
            </p>
            <Button onClick={() => navigate("/business-plan")}>
              <BookOpen className="w-4 h-4 mr-2" />
              Create a Business Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <h3 className="font-semibold truncate">{plan.name || "Untitled Plan"}</h3>
                        <Badge variant="outline" className="text-xs capitalize">{plan.version}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Saved {new Date(plan.created_at).toLocaleDateString()} &middot;{" "}
                        {new Date(plan.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex gap-1 sm:gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => handleView(plan)}>
                        <Eye className="w-3.5 h-3.5 sm:mr-1" />
                        <span className="hidden sm:inline">View</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadPDF(plan)}
                        disabled={!isPremium}
                        title={!isPremium ? "Upgrade to Premium to download" : "Download PDF"}
                      >
                        {!isPremium ? <Lock className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5 sm:mr-1" />}
                        <span className="hidden sm:inline">{isPremium ? "PDF" : ""}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadDOCX(plan)}
                        disabled={!isPremium}
                        title={!isPremium ? "Upgrade to Premium to download" : "Download DOCX"}
                      >
                        {!isPremium ? <Lock className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5 sm:mr-1" />}
                        <span className="hidden sm:inline">{isPremium ? "DOCX" : ""}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(plan.id)}
                        disabled={deletingId === plan.id}
                      >
                        {deletingId === plan.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
