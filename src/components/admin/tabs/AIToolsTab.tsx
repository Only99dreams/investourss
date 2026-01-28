import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bot, Search, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const AIToolsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const { data: logsData, error: logsError } = await supabase
        .from("ai_search_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;

      // Fetch profiles for all log users
      const userIds = logsData?.map(log => log.user_id).filter(Boolean) || [];
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Combine logs with profile data
      const logsWithProfiles = logsData?.map(log => ({
        ...log,
        user: profilesData?.find(profile => profile.id === log.user_id) || null
      })) || [];

      setLogs(logsWithProfiles);
    } catch (error) {
      console.error("Error fetching AI logs:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Bot className="w-5 h-5" /> AI Tool Usage Logs
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center p-8 md:p-12">
              <Loader2 className="h-6 w-6 md:h-8 md:w-8 animate-spin" />
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">User</TableHead>
                    <TableHead className="min-w-[100px]">Type</TableHead>
                    <TableHead className="min-w-[200px]">Query</TableHead>
                    <TableHead className="min-w-[150px]">Result</TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center h-24 text-sm md:text-base">
                        No logs found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">
                          <div className="text-sm md:text-base">
                            {log.user?.full_name || "Anonymous"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                            {log.user?.email}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize text-sm">
                          {log.search_type}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="truncate text-sm" title={log.query}>
                            {log.query}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="truncate text-sm">
                            {log.result || "N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={log.success ? "default" : "destructive"}
                            className="text-xs"
                          >
                            {log.success ? "Success" : "Failed"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs md:text-sm">
                          {format(new Date(log.created_at), 'PPp')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AIToolsTab;

