import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Tag, Plus, Copy, Eye, EyeOff, Clock, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromoCode {
  id: string;
  code: string;
  campaign_name: string;
  discount_percentage: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  plan_type: string;
  applies_to: string;
  credit_pack_id: string | null;
  created_by: string;
  created_at: string;
  creator_name?: string;
  credit_pack_name?: string;
}

interface CreditPackOption {
  id: string;
  name: string;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function PromoCodesTab() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [creditPacks, setCreditPacks] = useState<CreditPackOption[]>([]);
  const creditPacksRef = useRef<CreditPackOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    campaign_name: '',
    discount_percentage: '',
    max_uses: '1',
    expiry_hours: '24',
    plan_type: 'annual',
    applies_to: 'subscription',
    credit_pack_id: 'all',
  });

  useEffect(() => {
    void fetchCreditPacks().then(() => fetchPromoCodes());
  }, []);

  const fetchCreditPacks = async () => {
    const { data } = await supabase
      .from('audit_credit_packs')
      .select('id,name')
      .order('sort_order');
    const options = (data ?? []) as CreditPackOption[];
    creditPacksRef.current = options;
    setCreditPacks(options);
  };

  const fetchPromoCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch creator names separately
      const codesWithCreators = await Promise.all(
        (data || []).map(async (code) => {
          let creatorName = 'Unknown';
          if (code.created_by) {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', code.created_by)
              .single();
            creatorName = profileData?.full_name || 'Unknown';
          }
          return {
            ...code,
            creator_name: creatorName,
            credit_pack_name: creditPacksRef.current.find((pack) => pack.id === code.credit_pack_id)?.name ?? null,
          };
        })
      );

      setPromoCodes(codesWithCreators);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to fetch promo codes"),
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generatePromoCode = async () => {
    if (!formData.campaign_name || !formData.discount_percentage) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    const discount = parseFloat(formData.discount_percentage);
    if (discount <= 0 || discount > 100) {
      toast({
        title: "Error",
        description: "Discount percentage must be between 1 and 100",
        variant: "destructive"
      });
      return;
    }

    setIsCreating(true);
    try {
      // Generate a unique promo code
      const { data: codeData, error: codeError } = await supabase.rpc('generate_promo_code', { length: 8 });

      if (codeError) throw codeError;

      const expiryDate = formData.expiry_hours !== 'never'
        ? new Date(Date.now() + parseInt(formData.expiry_hours) * 60 * 60 * 1000).toISOString()
        : null;

      const { error } = await supabase
        .from('promo_codes')
        .insert({
          code: codeData,
          campaign_name: formData.campaign_name,
          discount_percentage: discount,
          max_uses: parseInt(formData.max_uses),
          expires_at: expiryDate,
          // Credit-only codes are plan-agnostic. A restricted credit code
          // carries the chosen pack; NULL means every pack.
          plan_type: formData.applies_to === 'credits' ? 'all' : formData.plan_type,
          applies_to: formData.applies_to,
          credit_pack_id:
            formData.applies_to !== 'subscription' && formData.credit_pack_id !== 'all'
              ? formData.credit_pack_id
              : null,
          created_by: profile?.id
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Promo code ${codeData} created successfully`,
      });

      setShowCreateDialog(false);
      setFormData({
        campaign_name: '',
        discount_percentage: '',
        max_uses: '1',
        expiry_hours: '24',
        plan_type: 'annual',
        applies_to: 'subscription',
        credit_pack_id: 'all',
      });

      fetchPromoCodes();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to create promo code"),
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  const togglePromoCodeStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('promo_codes')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Promo code ${!currentStatus ? 'activated' : 'deactivated'}`,
      });

      fetchPromoCodes();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: errorMessage(error, "Failed to update promo code"),
        variant: "destructive"
      });
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied!",
      description: "Promo code copied to clipboard",
    });
  };

  const getStatusBadge = (code: PromoCode) => {
    if (!code.is_active) {
      return <Badge variant="secondary">Inactive</Badge>;
    }

    if (code.expires_at && new Date(code.expires_at) < new Date()) {
      return <Badge variant="destructive">Expired</Badge>;
    }

    if (code.used_count >= code.max_uses) {
      return <Badge variant="destructive">Used Up</Badge>;
    }

    return <Badge className="bg-green-100 text-green-800">Active</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Promo Codes</h2>
          <p className="text-muted-foreground">
            Manage promotional codes for subscriptions and platform credits
          </p>
        </div>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Promo Code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Promo Code</DialogTitle>
              <DialogDescription>
                Generate a promotional code for subscription or platform credit discounts
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="campaign_name">Campaign Name *</Label>
                <Input
                  id="campaign_name"
                  placeholder="e.g., NYSC Orientation 2026"
                  value={formData.campaign_name}
                  onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="discount_percentage">Discount Percentage *</Label>
                <Input
                  id="discount_percentage"
                  type="number"
                  placeholder="e.g., 50"
                  min="1"
                  max="100"
                  value={formData.discount_percentage}
                  onChange={(e) => setFormData({ ...formData, discount_percentage: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="max_uses">Max Uses</Label>
                <Input
                  id="max_uses"
                  type="number"
                  placeholder="1"
                  min="1"
                  value={formData.max_uses}
                  onChange={(e) => setFormData({ ...formData, max_uses: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="expiry_hours">Expiry Time</Label>
                <Select value={formData.expiry_hours} onValueChange={(v) => setFormData({ ...formData, expiry_hours: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="72">3 days</SelectItem>
                    <SelectItem value="168">1 week</SelectItem>
                    <SelectItem value="720">30 days</SelectItem>
                    <SelectItem value="never">Never expires</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="applies_to">Applies To</Label>
                <Select
                  value={formData.applies_to}
                  onValueChange={(v) => setFormData({ ...formData, applies_to: v })}
                >
                  <SelectTrigger id="applies_to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subscription">Subscriptions</SelectItem>
                    <SelectItem value="credits">Platform Credits</SelectItem>
                    <SelectItem value="both">Subscriptions &amp; Credits</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="plan_type">Plan Type</Label>
                <Select
                  value={formData.plan_type}
                  onValueChange={(v) => setFormData({ ...formData, plan_type: v })}
                  disabled={formData.applies_to === 'credits'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">1-Month Plan</SelectItem>
                    <SelectItem value="quarterly">3-Month Plan</SelectItem>
                    <SelectItem value="biennial">6-Month Plan</SelectItem>
                    <SelectItem value="annual">12-Month Plan</SelectItem>
                    <SelectItem value="b2b_quarterly">B2B Plan (12 months)</SelectItem>
                    <SelectItem value="all">Any plan</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formData.applies_to === 'credits'
                    ? 'Credit codes are not tied to a subscription plan.'
                    : 'Choose “Any plan” to make the code work on every subscription.'}
                </p>
              </div>

              {formData.applies_to !== 'subscription' && (
                <div>
                  <Label htmlFor="credit_pack_id">Credit Pack</Label>
                  <Select
                    value={formData.credit_pack_id}
                    onValueChange={(v) => setFormData({ ...formData, credit_pack_id: v })}
                  >
                    <SelectTrigger id="credit_pack_id">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any credit pack</SelectItem>
                      {creditPacks.map((pack) => (
                        <SelectItem key={pack.id} value={pack.id}>
                          {pack.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Just like a subscription plan, choose one pack or leave it open for all packs.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={generatePromoCode}
                  disabled={isCreating}
                  className="flex-1"
                >
                  {isCreating ? "Creating..." : "Create Code"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Alert>
        <Tag className="h-4 w-4" />
        <AlertDescription>
          Promo codes are single-use per account. Subscription codes apply to the
          chosen plan, and credit codes can target one platform credit pack (or
          any pack). They auto-expire based on the time set during creation.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>All Promo Codes</CardTitle>
          <CardDescription>View and manage all promotional codes</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading promo codes...</div>
          ) : promoCodes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No promo codes created yet
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promoCodes.map((code) => (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono font-medium">
                      <div className="flex items-center gap-2">
                        {code.code}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(code.code)}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{code.campaign_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {code.applies_to === 'credits'
                          ? 'Platform Credits'
                          : code.applies_to === 'both'
                            ? 'Subscriptions & Credits'
                            : 'Subscriptions'}
                      </Badge>
                      {code.applies_to !== 'credits' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {code.plan_type === 'all' ? 'Any plan' : code.plan_type}
                        </span>
                      )}
                      {code.applies_to !== 'subscription' && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {code.credit_pack_name ?? 'Any credit pack'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{code.discount_percentage}%</TableCell>
                    <TableCell>{code.used_count}/{code.max_uses}</TableCell>
                    <TableCell>{getStatusBadge(code)}</TableCell>
                    <TableCell>
                      {code.expires_at ? (
                        <span className={cn(
                          new Date(code.expires_at) < new Date() && "text-red-600"
                        )}>
                          {new Date(code.expires_at).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>{code.creator_name}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => togglePromoCodeStatus(code.id, code.is_active)}
                      >
                        {code.is_active ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}