import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Eye, FileText, Sparkles, Download, Crown,
  TrendingUp, Users, Loader2, BarChart3
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MetricCard {
  label: string;
  eventType: string;
  icon: React.ElementType;
  color: string;
}

const metrics: MetricCard[] = [
  { label: "Opened Tool", eventType: "opened_tool", icon: Eye, color: "text-blue-500" },
  { label: "Started Form", eventType: "started_form", icon: FileText, color: "text-amber-500" },
  { label: "Generated Plan", eventType: "generated_plan", icon: Sparkles, color: "text-emerald-500" },
  { label: "Attempted Download", eventType: "attempted_download", icon: Download, color: "text-purple-500" },
  { label: "Attempted Upgrade", eventType: "attempted_upgrade", icon: Crown, color: "text-rose-500" },
];

interface EventRow {
  id: string;
  event_type: string;
  user_id: string | null;
  created_at: string;
}

const BusinessPlanStatsTab = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recentEvents, setRecentEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const eventTypes = metrics.map(m => m.eventType);
      const countPromises = eventTypes.map(type =>
        supabase
          .from("business_plan_analytics")
          .select("id", { count: "exact", head: true })
          .eq("event_type", type)
      );
      const countResults = await Promise.all(countPromises);
      const countMap: Record<string, number> = {};
      countResults.forEach((result, i) => {
        countMap[eventTypes[i]] = result.count ?? 0;
      });
      setCounts(countMap);

      const { data } = await supabase
        .from("business_plan_analytics")
        .select("id, event_type, user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      setRecentEvents(data ?? []);
    } catch (err) {
      console.error("Failed to fetch business plan stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const eventLabel = (type: string) => {
    const found = metrics.find(m => m.eventType === type);
    return found ? found.label : type;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="w-5 h-5 text-primary" />
            Business Plan Generator Funnel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              const count = counts[metric.eventType] ?? 0;
              const totalMetrics = metrics.map(m => counts[m.eventType] ?? 0);
              const maxCount = Math.max(...totalMetrics, 1);
              const percentage = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
              return (
                <motion.div
                  key={metric.eventType}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative"
                >
                  <Card className="overflow-hidden">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className={`p-2.5 rounded-lg bg-secondary ${metric.color}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="text-3xl font-bold text-foreground mb-1">{count}</div>
                      <div className="text-sm text-muted-foreground">{metric.label}</div>
                      <div className="mt-3 w-full bg-secondary rounded-full h-1.5">
                        <div
                          className={`h-full rounded-full ${metric.color.replace('text-', 'bg-')}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="w-5 h-5 text-primary" />
            Recent Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No events recorded yet. Events will appear once users interact with the Business Plan Generator.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{eventLabel(event.event_type)}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {event.user_id ? event.user_id.slice(0, 8) + "..." : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(event.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessPlanStatsTab;
