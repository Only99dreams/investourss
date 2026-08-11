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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import { formatNaira } from "@/lib/auditor";

interface PackOrder {
  id: string;
  user_id: string;
  pack_name: string;
  credits: number;
  amount: number;
  reference: string;
  status: "pending" | "active" | "expired" | "cancelled";
  expires_at: string | null;
  activated_at: string | null;
  created_at: string;
  user: { full_name: string | null; email: string | null } | null;
}

const AuditOrdersTab = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [orders, setOrders] = useState<PackOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_credit_packs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error(error);
      setOrders([]);
      setLoading(false);
      return;
    }

    const rows = data as PackOrder[];
    const userIds = rows.map((r) => r.user_id).filter(Boolean);
    let profiles: { id: string; full_name: string | null; email: string | null }[] = [];
    if (userIds.length > 0) {
      const { data: pData } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profiles = (pData as typeof profiles) || [];
    }
    setOrders(rows.map((r) => ({ ...r, user: profiles.find((p) => p.id === r.user_id) || null })));
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const activate = async (id: string) => {
    if (!user) return;
    setActivatingId(id);
    const { data, error } = await supabase.rpc("activate_user_audit_pack", {
      p_order_id: id,
      p_admin_id: user.id,
    });
    setActivatingId(null);
    if (error) {
      toast({ title: "Activation failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Activated", description: "Audit credits have been credited to the user." });
      fetchOrders();
    }
  };

  const statusVariant = (status: PackOrder["status"]) =>
    status === "active" ? "default" : status === "pending" ? "secondary" : "outline";

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Clock className="w-5 h-5" /> Audit Pack Orders
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">User</TableHead>
                    <TableHead className="min-w-[140px]">Pack</TableHead>
                    <TableHead className="min-w-[70px]">Credits</TableHead>
                    <TableHead className="min-w-[90px]">Amount</TableHead>
                    <TableHead className="min-w-[130px]">Reference</TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                    <TableHead className="min-w-[130px]">Created</TableHead>
                    <TableHead className="min-w-[90px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24">No orders yet.</TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <div className="text-sm">{order.user?.full_name || "Unknown"}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                            {order.user?.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{order.pack_name}</TableCell>
                        <TableCell className="text-sm">{order.credits}</TableCell>
                        <TableCell className="text-sm">{formatNaira(order.amount)}</TableCell>
                        <TableCell className="text-xs font-mono">{order.reference}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(order.status)} className="text-xs capitalize">
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{format(new Date(order.created_at), 'PPp')}</TableCell>
                        <TableCell>
                          {order.status === "pending" && (
                            <Button
                              size="sm"
                              onClick={() => activate(order.id)}
                              disabled={activatingId === order.id}
                            >
                              {activatingId === order.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4 mr-1" />
                              )}
                              Activate
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
    </div>
  );
};

export default AuditOrdersTab;
