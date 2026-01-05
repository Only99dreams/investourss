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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, LifeBuoy, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SupportTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [complaints, setComplaints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchComplaints();
  }, []);

  const fetchComplaints = async () => {
    try {
      const { data, error } = await supabase
        .from("complaints")
        .select(`
          *,
          user:profiles(full_name, email)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setComplaints(data || []);
    } catch (error) {
      console.error("Error fetching complaints:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      const { error } = await supabase
        .from("complaints")
        .update({ 
          status: "resolved",
          resolved_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Complaint marked as resolved",
      });
      fetchComplaints();
    } catch (error) {
      console.error("Error resolving complaint:", error);
      toast({
        title: "Error",
        description: "Failed to resolve complaint",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5" /> Support & Complaints
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Issue Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complaints.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No complaints found.
                    </TableCell>
                  </TableRow>
                ) : (
                  complaints.map((complaint) => (
                    <TableRow key={complaint.id}>
                      <TableCell className="font-medium">
                        {complaint.user?.full_name || "N/A"}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {complaint.user?.email}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">
                        {complaint.issue_type}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {complaint.description}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            complaint.status === "resolved"
                              ? "default"
                              : "destructive"
                          }
                        >
                          {complaint.status || "Open"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(complaint.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {complaint.status !== "resolved" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => handleResolve(complaint.id)}
                            title="Mark as Resolved"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
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
  );
};

export default SupportTab;

