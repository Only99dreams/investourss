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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Wallet, Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const WalletsTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWallet, setSelectedWallet] = useState<any>(null);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [transactionForm, setTransactionForm] = useState({
    type: "credit",
    wallet_type: "user_wallet",
    amount: "",
    narration: "",
  });
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      const { data: walletsData, error: walletsError } = await supabase
        .from("wallets")
        .select("*")
        .order("updated_at", { ascending: false });

      if (walletsError) throw walletsError;

      // Fetch profiles for all wallet users
      const userIds = walletsData?.map(wallet => wallet.user_id).filter(Boolean) || [];
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Combine wallets with profile data
      const walletsWithProfiles = walletsData?.map(wallet => ({
        ...wallet,
        profile: profilesData?.find(profile => profile.id === wallet.user_id) || null
      })) || [];

      setWallets(walletsWithProfiles);
    } catch (error) {
      console.error("Error fetching wallets:", error);
      toast({
        title: "Error",
        description: "Failed to load wallets",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualTransaction = async () => {
    if (!selectedWallet || !user) return;

    const amount = parseFloat(transactionForm.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive"
      });
      return;
    }

    try {
      const balanceField = transactionForm.wallet_type === "user_wallet" ? "user_wallet_balance" : "gfe_wallet_balance";
      const newBalance = transactionForm.type === "credit"
        ? selectedWallet[balanceField] + amount
        : selectedWallet[balanceField] - amount;

      if (newBalance < 0) {
        toast({
          title: "Insufficient Balance",
          description: "Cannot debit more than available balance",
          variant: "destructive"
        });
        return;
      }

      // Update wallet balance
      const { error: updateError } = await supabase
        .from("wallets")
        .update({
          [balanceField]: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq("id", selectedWallet.id);

      if (updateError) throw updateError;

      // Create transaction record
      const { error: transactionError } = await supabase
        .from("wallet_transactions")
        .insert({
          wallet_id: selectedWallet.id,
          amount: amount,
          transaction_type: transactionForm.type,
          narration: transactionForm.narration,
          source: "admin_manual",
          status: "completed",
          actor_id: user.id
        });

      if (transactionError) throw transactionError;

      toast({
        title: "Success",
        description: `Wallet ${transactionForm.type}ed successfully`
      });

      setIsTransactionDialogOpen(false);
      setTransactionForm({
        type: "credit",
        wallet_type: "user_wallet",
        amount: "",
        narration: "",
      });
      setSelectedWallet(null);
      fetchWallets();
    } catch (error) {
      console.error("Error processing transaction:", error);
      toast({
        title: "Error",
        description: "Failed to process transaction",
        variant: "destructive"
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5" /> Wallets Management
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
                  <TableHead>User Wallet Balance</TableHead>
                  <TableHead>Gem Points</TableHead>
                  <TableHead>GFE Wallet Balance</TableHead>
                  <TableHead>Updated At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No wallets found.
                    </TableCell>
                  </TableRow>
                ) : (
                  wallets.map((wallet) => (
                    <TableRow key={wallet.id}>
                      <TableCell className="font-medium">
                        {wallet.profile?.full_name || "N/A"}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {wallet.profile?.email}
                        </span>
                      </TableCell>
                      <TableCell>₦{wallet.user_wallet_balance?.toLocaleString()}</TableCell>
                      <TableCell>{wallet.gem_points?.toLocaleString()}</TableCell>
                      <TableCell>₦{wallet.gfe_wallet_balance?.toLocaleString()}</TableCell>
                      <TableCell>
                        {new Date(wallet.updated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedWallet(wallet);
                              setIsTransactionDialogOpen(true);
                            }}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Adjust
                          </Button>
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

      {/* Manual Transaction Dialog */}
      <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Wallet Adjustment</DialogTitle>
            <DialogDescription>
              Adjust wallet balance for {selectedWallet?.profile?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Transaction Type</Label>
              <Select
                value={transactionForm.type}
                onValueChange={(value) => setTransactionForm({ ...transactionForm, type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (Add Money)</SelectItem>
                  <SelectItem value="debit">Debit (Subtract Money)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Wallet Type</Label>
              <Select
                value={transactionForm.wallet_type}
                onValueChange={(value) => setTransactionForm({ ...transactionForm, wallet_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user_wallet">User Wallet</SelectItem>
                  <SelectItem value="gfe_wallet">GFE Wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                value={transactionForm.amount}
                onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Narration</Label>
              <Textarea
                placeholder="Reason for adjustment"
                value={transactionForm.narration}
                onChange={(e) => setTransactionForm({ ...transactionForm, narration: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransactionDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleManualTransaction}>
              Process Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default WalletsTab;

