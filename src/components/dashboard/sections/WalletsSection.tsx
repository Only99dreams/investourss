import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Wallet, Gem, Users, ArrowUpRight, ArrowDownRight, Clock, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface WalletData {
  id: string;
  user_wallet_balance: number;
  gem_points: number;
  gfe_wallet_balance: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  bank_details_locked: boolean;
}

export function WalletsSection() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Bank Details State
  const [isBankDialogOpen, setIsBankDialogOpen] = useState(false);
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
  });

  // Withdrawal State
  const [isWithdrawalDialogOpen, setIsWithdrawalDialogOpen] = useState(false);
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: "",
    wallet_type: "user_wallet",
  });

  useEffect(() => {
    if (user) fetchWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchWallet = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setWallet(data);
      setBankForm({
        bank_name: data.bank_name || "",
        bank_account_number: data.bank_account_number || "",
        bank_account_name: data.bank_account_name || "",
      });
    }

    // Fetch transactions
    const { data: txns } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("wallet_id", data?.id)
      .order("created_at", { ascending: false })
      .limit(10);

    setTransactions(txns || []);
    setIsLoading(false);
  };

  const handleUpdateBankDetails = async () => {
    try {
      if (!wallet) return;

      const { error } = await supabase
        .from("wallets")
        .update({
          bank_name: bankForm.bank_name,
          bank_account_number: bankForm.bank_account_number,
          bank_account_name: bankForm.bank_account_name,
        })
        .eq("id", wallet.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Bank details updated successfully",
      });
      setIsBankDialogOpen(false);
      fetchWallet();
    } catch (error) {
      console.error("Error updating bank details:", error);
      toast({
        title: "Error",
        description: "Failed to update bank details",
        variant: "destructive",
      });
    }
  };

  const handleRequestWithdrawal = async () => {
    try {
      if (!wallet || !user || !profile) return;

      const amount = parseFloat(withdrawalForm.amount);
      const balance = withdrawalForm.wallet_type === "user_wallet"
        ? wallet.user_wallet_balance
        : wallet.gfe_wallet_balance;

      if (isNaN(amount) || amount < 5000) {
        toast({
          title: "Invalid Amount",
          description: "Minimum withdrawal is ₦5,000",
          variant: "destructive",
        });
        return;
      }

      if (amount > balance) {
        toast({
          title: "Insufficient Funds",
          description: "Withdrawal amount exceeds balance",
          variant: "destructive",
        });
        return;
      }

      // Get withdrawal fee rate based on user tier
      const feeRate = profile.user_tier === "premium" ? 0.10 : 0.15;
      const fee = amount * feeRate;
      const netAmount = amount - fee;

      const { error } = await supabase
        .from("withdrawal_requests")
        .insert({
          user_id: user.id,
          amount: netAmount, // Store net amount after fee
          wallet_type: withdrawalForm.wallet_type,
          status: "pending",
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Withdrawal request submitted. Fee: ₦${fee.toLocaleString()}, Net amount: ₦${netAmount.toLocaleString()}`,
      });
      setIsWithdrawalDialogOpen(false);
      setWithdrawalForm({ amount: "", wallet_type: "user_wallet" });
      // Optionally create a transaction record here or let a backend trigger handle it
    } catch (error) {
      console.error("Error requesting withdrawal:", error);
      toast({
        title: "Error",
        description: "Failed to submit withdrawal request",
        variant: "destructive",
      });
    }
  };

  const walletCards = [
    {
      title: "User Wallet",
      balance: wallet?.user_wallet_balance || 0,
      icon: Wallet,
      color: "from-emerald to-emerald/70",
      description: "Non-referral income"
    },
    {
      title: "Gem Points",
      balance: wallet?.gem_points || 0,
      icon: Gem,
      color: "from-gold to-gold/70",
      description: "Earned from learning activities, challenges, and engagement. (Redeemable)",
      isPoints: true
    },
    {
      title: "GFE Wallet",
      balance: wallet?.gfe_wallet_balance || 0,
      icon: Users,
      color: "from-primary to-primary/70",
      description: "Educator earnings",
      locked: !profile?.is_gfe || !profile?.gfe_terms_agreed_at,
      gfeOnly: true
    }
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Engagement Credit */}
      {!profile?.engagement_credit_earned && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="border-accent/20 bg-accent/5">
            <CardContent className="p-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">Unlock ₦2,000 1st Engagement Credit</h3>
                <p className="text-muted-foreground mb-4">
                  Complete these activities to earn your welcome bonus:
                </p>
                <div className="flex justify-center items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                      (profile?.ai_tutor_used || 0) >= 3 ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {(profile?.ai_tutor_used || 0) >= 3 ? "✓" : profile?.ai_tutor_used || 0}
                    </div>
                    <span>Use AI Tutor ×3</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                      (profile?.videos_watched || 0) >= 1 ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {(profile?.videos_watched || 0) >= 1 ? "✓" : profile?.videos_watched || 0}
                    </div>
                    <span>Watch 1 video</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                      (profile?.posts_created || 0) >= 1 ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {(profile?.posts_created || 0) >= 1 ? "✓" : profile?.posts_created || 0}
                    </div>
                    <span>Post once</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Wallet Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {walletCards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="overflow-hidden">
              <div className={cn("h-2 bg-gradient-to-r", card.color)} />
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.title}</p>
                    <p className="text-2xl font-bold mt-1">
                      {card.isPoints ? card.balance.toLocaleString() : `₦${card.balance.toLocaleString()}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
                  </div>
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    `bg-gradient-to-br ${card.color} text-white`
                  )}>
                    <card.icon className="w-5 h-5" />
                  </div>
                </div>
                
                {card.locked && (
                  <Badge variant="outline" className="mt-3 text-xs">
                    {card.gfeOnly ? "Become a GFE to access" : "Agree to GFE terms to unlock"}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Bank Details & Transactions */}
      <div className="grid md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Bank Account Details</CardTitle>
                <CardDescription>Your withdrawal account</CardDescription>
              </div>
              {!wallet?.bank_details_locked && (
                <Dialog open={isBankDialogOpen} onOpenChange={setIsBankDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      {wallet?.bank_account_number ? "Edit" : "Add"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Bank Account Details</DialogTitle>
                      <DialogDescription>
                        Enter your bank details for withdrawals.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="bank_name">Bank Name</Label>
                        <Input
                          id="bank_name"
                          placeholder="e.g. First Bank"
                          value={bankForm.bank_name}
                          onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="account_number">Account Number</Label>
                        <Input
                          id="account_number"
                          placeholder="0123456789"
                          value={bankForm.bank_account_number}
                          onChange={(e) => setBankForm({ ...bankForm, bank_account_number: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="account_name">Account Name</Label>
                        <Input
                          id="account_name"
                          placeholder="John Doe"
                          value={bankForm.bank_account_name}
                          onChange={(e) => setBankForm({ ...bankForm, bank_account_name: e.target.value })}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsBankDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleUpdateBankDetails}>Save Details</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              {wallet?.bank_account_number ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 border">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{wallet.bank_name}</p>
                      <p className="text-sm text-muted-foreground">{wallet.bank_account_number}</p>
                      <p className="text-xs text-muted-foreground uppercase">{wallet.bank_account_name}</p>
                    </div>
                  </div>
                  {wallet.bank_details_locked && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
                      <Clock className="w-4 h-4" />
                      <span>Details are locked pending verification</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No bank details added yet</p>
                  <Button variant="secondary" onClick={() => setIsBankDialogOpen(true)}>
                    Add Bank Details
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>Your latest wallet activity</CardDescription>
              </div>
              <Dialog open={isWithdrawalDialogOpen} onOpenChange={setIsWithdrawalDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!wallet?.bank_account_number}>
                    Request Withdrawal
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Request Withdrawal</DialogTitle>
                    <DialogDescription>
                      Withdraw funds to your linked bank account.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Select Wallet</Label>
                      <Select 
                        value={withdrawalForm.wallet_type} 
                        onValueChange={(val) => setWithdrawalForm({ ...withdrawalForm, wallet_type: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user_wallet">User Wallet (₦{wallet?.user_wallet_balance.toLocaleString()})</SelectItem>
                          <SelectItem value="gfe_wallet">GFE Wallet (₦{wallet?.gfe_wallet_balance.toLocaleString()})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount (₦)</Label>
                      <Input
                        id="amount"
                        type="number"
                        placeholder="5000"
                        min="5000"
                        value={withdrawalForm.amount}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Minimum withdrawal: ₦5,000</p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsWithdrawalDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleRequestWithdrawal}>Submit Request</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center",
                          tx.amount > 0 ? "bg-emerald/10 text-emerald" : "bg-coral/10 text-coral"
                        )}>
                          {tx.amount > 0 ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{tx.narration || tx.transaction_type}</p>
                          <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <p className={cn("font-medium", tx.amount > 0 ? "text-emerald" : "text-coral")}>
                        {tx.amount > 0 ? "+" : ""}₦{Math.abs(tx.amount).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No transactions yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Withdrawal Info */}
      <Card className="bg-muted/30">
        <CardContent className="p-6">
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Processing Fee</p>
              <p className="font-medium">
                {profile?.user_tier === "exclusive" ? "5%" : profile?.user_tier === "premium" ? "10%" : "15%"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Minimum Withdrawal</p>
              <p className="font-medium">₦5,000</p>
            </div>
            <div>
              <p className="text-muted-foreground">Processing Time</p>
              <p className="font-medium">Within 72 hours</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

