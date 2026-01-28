import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Search, Shield, AlertTriangle, CheckCircle, Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface AISearchLog {
  id: string;
  search_type: string;
  query: string;
  result: any;
  success: boolean;
  created_at: string;
}

export function AIReportsSection() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AISearchLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AISearchLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");

  useEffect(() => {
    fetchLogs();
  }, [user]);

  useEffect(() => {
    filterLogs();
  }, [logs, searchQuery, typeFilter, dateFilter]);

  const fetchLogs = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("ai_search_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (data) {
      setLogs(data);
      setFilteredLogs(data);
    }
    setIsLoading(false);
  };

  const filterLogs = () => {
    let filtered = logs;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(log =>
        log.query.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.search_type.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter(log => log.search_type === typeFilter);
    }

    // Date filter
    if (dateFilter !== "all") {
      const now = new Date();
      const filterDate = new Date();

      switch (dateFilter) {
        case "today":
          filterDate.setHours(0, 0, 0, 0);
          filtered = filtered.filter(log => new Date(log.created_at) >= filterDate);
          break;
        case "week":
          filterDate.setDate(now.getDate() - 7);
          filtered = filtered.filter(log => new Date(log.created_at) >= filterDate);
          break;
        case "month":
          filterDate.setMonth(now.getMonth() - 1);
          filtered = filtered.filter(log => new Date(log.created_at) >= filterDate);
          break;
      }
    }

    setFilteredLogs(filtered);
  };

  const getRiskIcon = (type: string) => {
    switch (type) {
      case "quick":
        return <Search className="w-4 h-4" />;
      case "deep":
        return <Shield className="w-4 h-4" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  const getRiskColor = (result: any) => {
    if (!result) return "bg-gray-100 text-gray-800";

    const riskLevel = result.riskLevel || result.risk_level;
    switch (riskLevel) {
      case "safe":
      case "low":
        return "bg-green-100 text-green-800";
      case "warning":
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "danger":
      case "high":
      case "critical":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "quick":
        return "bg-blue-100 text-blue-800";
      case "deep":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const stats = {
    total: logs.length,
    quick: logs.filter(log => log.search_type === "quick").length,
    deep: logs.filter(log => log.search_type === "deep").length,
    successful: logs.filter(log => log.success).length,
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">AI Reports</h1>
            <p className="text-muted-foreground">Your AI-powered scam detection and analysis history</p>
          </div>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardContent className="p-4 text-center">
              <Search className="w-6 h-6 mx-auto mb-2 text-blue-500" />
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Searches</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardContent className="p-4 text-center">
              <Shield className="w-6 h-6 mx-auto mb-2 text-purple-500" />
              <p className="text-2xl font-bold">{stats.deep}</p>
              <p className="text-xs text-muted-foreground">Deep Analysis</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-500" />
              <p className="text-2xl font-bold">{stats.successful}</p>
              <p className="text-xs text-muted-foreground">Successful</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card>
            <CardContent className="p-4 text-center">
              <Clock className="w-6 h-6 mx-auto mb-2 text-orange-500" />
              <p className="text-2xl font-bold">{new Date().toLocaleDateString()}</p>
              <p className="text-xs text-muted-foreground">Last Activity</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search queries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="quick">Quick Search</SelectItem>
                  <SelectItem value="deep">Deep Analysis</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Filter by date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reports List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Analysis History</CardTitle>
            <CardDescription>
              {filteredLogs.length} of {logs.length} reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground mt-2">Loading reports...</p>
              </div>
            ) : filteredLogs.length > 0 ? (
              <div className="space-y-4">
                {filteredLogs.map((log, index) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-1">
                          {getRiskIcon(log.search_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className={cn("text-xs", getTypeBadgeColor(log.search_type))}>
                              {log.search_type === "quick" ? "Quick Search" : "Deep Analysis"}
                            </Badge>
                            {log.result && (
                              <Badge className={cn("text-xs", getRiskColor(log.result))}>
                                {log.result.riskLevel || log.result.risk_level || "Unknown"}
                              </Badge>
                            )}
                            {!log.success && (
                              <Badge variant="destructive" className="text-xs">
                                Failed
                              </Badge>
                            )}
                          </div>
                          <h4 className="font-medium text-sm mb-1 truncate">{log.query}</h4>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(log.created_at)}
                          </p>
                          {log.result && log.result.summary && (
                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                              {log.result.summary}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-semibold mb-2">No reports found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || typeFilter !== "all" || dateFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Start by performing some AI analysis on the Vetting page"}
                </p>
                <Button onClick={() => window.open("/vetting", "_blank")}>
                  Go to Vetting Page
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}