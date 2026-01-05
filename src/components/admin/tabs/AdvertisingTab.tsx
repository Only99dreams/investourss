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
import { Loader2, Megaphone, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AdvertisingTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchAds();
  }, []);

  const fetchAds = async () => {
    try {
      const { data, error } = await supabase
        .from("adverts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAds(data || []);
    } catch (error) {
      console.error("Error fetching ads:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      const { error } = await supabase
        .from("adverts")
        .update({ status })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Ad marked as ${status}`,
      });
      fetchAds();
    } catch (error) {
      console.error("Error updating ad:", error);
      toast({
        title: "Error",
        description: "Failed to update ad",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="w-5 h-5" /> Advertising Management
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
                  <TableHead>Advertiser</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      No advertisements found.
                    </TableCell>
                  </TableRow>
                ) : (
                  ads.map((ad) => (
                    <TableRow key={ad.id}>
                      <TableCell className="font-medium">
                        {ad.advertiser_name || "N/A"}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {ad.advertiser_email}
                        </span>
                      </TableCell>
                      <TableCell>{ad.title}</TableCell>
                      <TableCell className="capitalize">{ad.channel}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ad.status === "active"
                              ? "default"
                              : ad.status === "pending"
                              ? "secondary"
                              : "destructive"
                          }
                        >
                          {ad.status || "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          Views: {ad.views_count || 0}
                          <br />
                          Clicks: {ad.clicks_count || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        {new Date(ad.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {ad.status !== "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleStatusUpdate(ad.id, "active")}
                              title="Approve / Activate"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {ad.status !== "rejected" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleStatusUpdate(ad.id, "rejected")}
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
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

export default AdvertisingTab;

