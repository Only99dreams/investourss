import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Wallet, FileCheck, TrendingUp, Users, Loader2, AlertTriangle, ScanSearch, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { formatNaira } from "@/lib/auditor";

const AuditAnalyticsTab = () => {
  const [stats, setStats] = useState({
    audits: 0,
    recoverable: 0,
    recoverableAmount: 0,
    monitoring: 0,
    connections: 0,
    packsActive: 0,
    pendingOrders: 0,
    avgScore: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const [
        audits,
        recoverable,
        recoverableSum,
        monitoring,
        connections,
        packs,
        pending,
        avgScore,
      ] = await Promise.all([
        supabase.from("financial_audits").select("id", { count: "exact", head: true }),
        supabase.from("recoverable_transactions").select("amount"),
        supabase.from("recoverable_transactions").select("amount").eq("status", "identified"),
        supabase.from("monitoring_reports").select("id", { count: "exact", head: true }),
        supabase.from("financial_data_sources").select("id", { count: "exact", head: true }),
        supabase.from("user_credit_packs").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("user_credit_packs").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("financial_audits").select("health_score"),
      ]);

      const recoverableRows = (recoverable.data as { amount: number }[] | null) ?? [];
      const scoreRows = (avgScore.data as { health_score: number }[] | null) ?? [];

      setStats({
        audits: audits.count ?? 0,
        recoverable: recoverableRows.length,
        recoverableAmount: recoverableRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
        monitoring: monitoring.count ?? 0,
        connections: connections.count ?? 0,
        packsActive: packs.count ?? 0,
        pendingOrders: pending.count ?? 0,
        avgScore: scoreRows.length
          ? Math.round(scoreRows.reduce((s, r) => s + r.health_score, 0) / scoreRows.length)
          : 0,
      });
    } catch (err) {
      console.error("Failed to fetch audit analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    { label: "Audits Run", value: stats.audits, icon: FileCheck, color: "text-primary" },
    { label: "Leakages Found", value: stats.recoverable, icon: AlertTriangle, color: "text-amber-500" },
    { label: "Recoverable Value", value: formatNaira(stats.recoverableAmount), icon: Wallet, color: "text-emerald-500" },
    { label: "Monitoring Reports", value: stats.monitoring, icon: Activity, color: "text-purple-500" },
    { label: "Connected Sources", value: stats.connections, icon: ScanSearch, color: "text-sky-500" },
    { label: "Active Packs", value: stats.packsActive, icon: TrendingUp, color: "text-primary" },
    { label: "Pending Orders", value: stats.pendingOrders, icon: Users, color: "text-rose-500" },
    { label: "Avg Health Score", value: `${stats.avgScore}/100`, icon: Activity, color: "text-investours-gold" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <BarChart3 className="w-5 h-5" /> AI Financial Auditor — Usage Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cards.map((card, i) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-xl border p-4"
                >
                  <card.icon className={`w-6 h-6 ${card.color} mb-2`} />
                  <div className="text-xl font-bold text-foreground">{card.value}</div>
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditAnalyticsTab;
