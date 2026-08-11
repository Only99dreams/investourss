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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, DollarSign, CheckCircle, XCircle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { DepositRequestsManager } from "@/components/admin/DepositRequestsManager";

const PayoutsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [withdrawalRequests, setWithdrawalRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; status: string } | null>(null);
  const { toast } = useToast();
  const { user: adminUser } = useAuth();

  useEffect(() => {
    fetchWithdrawalRequests();
  }, []);

  const fetchWithdrawalRequests = async () => {
    try {
      const { data, error } = await supabase
        .from("withdrawal_requests")
        .select(`
          *,
          user:profiles(full_name, email, bank_name, bank_account_number)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWithdrawalRequests(data || []);
    } catch (error) {
      console.error("Error fetching payout requests:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      if (!adminUser) {
        toast({
          title: "Error",
          description: "Admin session not found",
          variant: "destructive",
        });
        return;
      }

      setProcessingId(id);
      const { data, error } = await supabase.rpc("process_withdrawal_request", {
        p_request_id: id,
        p_admin_id: adminUser.id,
        p_action: status,
      });

      if (error) throw error;
      if (!data) throw new Error("Request could not be processed");

      toast({
        title: "Success",
        description: `Request marked as ${status}`,
      });
      setConfirmAction(null);
      fetchWithdrawalRequests();
    } catch (error) {
      console.error("Error updating request:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update request",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="withdrawals" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="withdrawals" className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Withdrawal Requests
          </TabsTrigger>
          <TabsTrigger value="deposits" className="flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4" />
            Deposit Requests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="withdrawals">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5" /> Withdrawal Requests
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
                        <TableHead>Amount</TableHead>
                        <TableHead>Fee</TableHead>
                        <TableHead>Wallet Type</TableHead>
                        <TableHead>Bank Details</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {withdrawalRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center h-24">
                            No withdrawal requests found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        withdrawalRequests.map((req) => (
                          <TableRow key={req.id}>
                            <TableCell className="font-medium">
                              {req.user?.full_name || "N/A"}
                              <br />
                              <span className="text-xs text-muted-foreground">
                                {req.user?.email}
                              </span>
                            </TableCell>
                            <TableCell className="font-bold">
                              ₦{req.amount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs">
                              <p className="font-medium text-muted-foreground">
                                ₦{(req.fee_amount ?? 0).toLocaleString()}
                              </p>
                              <p className="text-muted-foreground">
                                {((req.fee_rate ?? 0) * 100).toFixed(0)}%
                              </p>
                            </TableCell>
                            <TableCell className="capitalize">
                              {req.wallet_type?.replace(/_/g, " ")}
                            </TableCell>
                            <TableCell>
                              <div className="text-xs">
                                {req.user?.bank_name}
                                <br />
                                {req.user?.bank_account_number}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  req.status === "approved"
                                    ? "default"
                                    : req.status === "pending"
                                    ? "secondary"
                                    : "destructive"
                                }
                              >
                                {req.status || "Pending"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {new Date(req.created_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                {req.status === "pending" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                      onClick={() => setConfirmAction({ id: req.id, status: "approve" })}
                                      title="Approve"
                                      disabled={processingId === req.id}
                                    >
                                      {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => setConfirmAction({ id: req.id, status: "reject" })}
                                      title="Reject"
                                      disabled={processingId === req.id}
                                    >
                                      {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                    </Button>
                                  </>
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
        </TabsContent>

        <TabsContent value="deposits">
          <DepositRequestsManager />
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.status === "approve" ? "Approve Withdrawal" : "Reject Withdrawal"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.status === "approve"
                ? "The net amount will be paid to the user's bank account and the held funds finalised."
                : "The full requested amount will be returned to the user's wallet."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction?.status === "approve" ? "default" : "destructive"}
              onClick={() => confirmAction && handleStatusUpdate(confirmAction.id, confirmAction.status)}
              disabled={processingId !== null}
            >
              {processingId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm {confirmAction?.status === "approve" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PayoutsTab;

