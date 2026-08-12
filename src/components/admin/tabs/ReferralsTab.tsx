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
import { Loader2, Share2 } from "lucide-react";

const ReferralsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReferrals();
  }, []);

  const fetchReferrals = async () => {
    try {
      // referral_stats has no FK to profiles, so PostgREST can't embed it.
      // Fetch stats and profiles separately, then join client-side.
      const { data: statsData, error } = await supabase
        .from("referral_stats")
        .select("*")
        .order("total_signups", { ascending: false });

      if (error) throw error;

      const rows = statsData || [];
      const userIds = rows.map((r) => r.user_id).filter(Boolean);

      const { data: profilesData } = userIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, full_name, email, referral_code")
            .in("id", userIds)
        : { data: [] };

      const profilesById = new Map(
        (profilesData || []).map((p) => [p.id, p])
      );

      setReferrals(
        rows.map((r) => ({ ...r, profile: profilesById.get(r.user_id) || null }))
      );
    } catch (error) {
      console.error("Error fetching referrals:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="w-5 h-5" /> Referral Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Referral Code</TableHead>
                  <TableHead>Clicks</TableHead>
                  <TableHead>Signups</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Invested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No referral data found.
                    </TableCell>
                  </TableRow>
                ) : (
                  referrals.map((ref) => (
                    <TableRow key={ref.id}>
                      <TableCell className="font-medium">
                        {ref.profile?.full_name || "N/A"}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {ref.profile?.email}
                        </span>
                      </TableCell>
                      <TableCell>{ref.profile?.referral_code}</TableCell>
                      <TableCell>{ref.total_clicks}</TableCell>
                      <TableCell>{ref.total_signups}</TableCell>
                      <TableCell>{ref.total_verified}</TableCell>
                      <TableCell>{ref.total_investing}</TableCell>
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

export default ReferralsTab;

