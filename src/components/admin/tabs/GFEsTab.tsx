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
import { Loader2, UserCheck } from "lucide-react";

const GFEsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [gfes, setGfes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGFEs();
  }, []);

  const fetchGFEs = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_gfe", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGfes(data || []);
    } catch (error) {
      console.error("Error fetching GFEs:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="w-5 h-5" /> GFE Management
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
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Referral Code</TableHead>
                  <TableHead>Agreed To Terms</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gfes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No GFEs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  gfes.map((gfe) => (
                    <TableRow key={gfe.id}>
                      <TableCell className="font-medium">{gfe.full_name}</TableCell>
                      <TableCell>{gfe.email}</TableCell>
                      <TableCell>{gfe.phone}</TableCell>
                      <TableCell>{gfe.region || "N/A"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{gfe.referral_code}</Badge>
                      </TableCell>
                      <TableCell>
                        {gfe.gfe_terms_agreed_at
                          ? new Date(gfe.gfe_terms_agreed_at).toLocaleDateString()
                          : "Pending"}
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

export default GFEsTab;

