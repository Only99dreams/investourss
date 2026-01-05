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
import { Loader2, Building2, CheckCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FirmsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [firms, setFirms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchFirms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFirms = async () => {
    try {
      const { data, error } = await supabase
        .from("firms")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFirms(data || []);
    } catch (error) {
      console.error("Error fetching firms:", error);
      toast({
        title: "Error",
        description: "Failed to fetch firms",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (id: string) => {
    try {
      const { error } = await supabase
        .from("firms")
        .update({ 
          is_verified: true,
          verified_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Firm verified successfully",
      });
      fetchFirms();
    } catch (error) {
      console.error("Error verifying firm:", error);
      toast({
        title: "Error",
        description: "Failed to verify firm",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" /> Firms Management
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
                  <TableHead>Firm Name</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {firms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No firms found.
                    </TableCell>
                  </TableRow>
                ) : (
                  firms.map((firm) => (
                    <TableRow key={firm.id}>
                      <TableCell className="font-medium">
                        {firm.firm_name}
                      </TableCell>
                      <TableCell>{firm.sector || "N/A"}</TableCell>
                      <TableCell>
                        {firm.contact_person_name}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {firm.contact_email}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={firm.is_verified ? "default" : "secondary"}
                        >
                          {firm.is_verified ? "Verified" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(firm.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {!firm.is_verified && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleVerify(firm.id)}
                              title="Verify Firm"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {firm.license_document_url && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => window.open(firm.license_document_url, '_blank')}
                              title="View License"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
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

export default FirmsTab;

