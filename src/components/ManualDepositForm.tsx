import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, Banknote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface ManualDepositFormProps {
  onSuccess?: () => void;
  narration?: string;
  prefillAmount?: number;
  promoCode?: any;
}

export const ManualDepositForm: React.FC<ManualDepositFormProps> = ({ onSuccess, narration, prefillAmount, promoCode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    bankName: '',
    bankAccountNumber: '',
    depositorName: '',
    referenceNumber: '',
    proofOfPayment: null as File | null,
    notes: ''
  });

  // Prefill amount if provided
  useEffect(() => {
    if (prefillAmount) {
      setFormData(prev => ({ ...prev, amount: prefillAmount.toString() }));
    }
  }, [prefillAmount]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, proofOfPayment: file }));
    }
  };

  const isFormValid = () => {
    const amount = parseFloat(formData.amount);
    return (
      formData.amount &&
      !isNaN(amount) &&
      amount > 0 &&
      formData.bankName &&
      formData.depositorName &&
      formData.proofOfPayment
    );
  };

  const uploadProofOfPayment = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `proof-of-payment_${Date.now()}.${fileExt}`;
    const filePath = `${user?.id}/${fileName}`;

    // Try to upload to 'attachments' bucket first, fall back to 'deposit-proofs'
    let uploadError: any = null;
    let usedBucket = 'attachments';

    const result = await supabase.storage
      .from('attachments')
      .upload(filePath, file);

    uploadError = result.error;

    // If the bucket doesn't exist, try 'deposit-proofs' bucket
    if (uploadError && (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket') || uploadError.statusCode === '404')) {
      console.warn('Attachments bucket not found, trying deposit-proofs bucket...');
      usedBucket = 'deposit-proofs';
      const fallbackResult = await supabase.storage
        .from('deposit-proofs')
        .upload(filePath, file);
      uploadError = fallbackResult.error;
    }

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      throw new Error(`File upload failed: ${uploadError.message || 'Storage bucket may not exist. Please contact support.'}`);
    }

    const { data } = supabase.storage
      .from(usedBucket)
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please log in to submit a deposit request.",
        variant: "destructive"
      });
      return;
    }

    if (!formData.amount || !formData.bankName || !formData.depositorName || !formData.proofOfPayment) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields and upload proof of payment.",
        variant: "destructive"
      });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid deposit amount.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      let proofUrl = null;
      if (formData.proofOfPayment) {
        proofUrl = await uploadProofOfPayment(formData.proofOfPayment);
        if (!proofUrl) {
          throw new Error('Failed to upload proof of payment. Please try a different file.');
        }
      }

      const { error } = await supabase
        .from('deposit_requests')
        .insert({
          user_id: user.id,
          amount: amount,
          bank_name: formData.bankName,
          bank_account_number: formData.bankAccountNumber,
          depositor_name: formData.depositorName,
          reference_number: formData.referenceNumber,
          proof_of_payment_url: proofUrl,
          admin_notes: formData.notes,
          narration: narration || 'Manual Bank Transfer',
          status: 'pending'
        });

      if (error) {
        console.error('Supabase insert error:', error);
        throw new Error(error.message || 'Database error');
      }

      // Record promo code usage if applicable
      if (promoCode) {
        const { error: promoError } = await supabase
          .from('promo_code_uses')
          .insert({
            promo_code_id: promoCode.promo_code_id,
            user_id: user.id,
            discount_applied: (prefillAmount || amount) - amount // The discount amount
          });

        if (promoError) {
          console.error('Error recording promo code usage:', promoError);
          // Don't fail the whole transaction for promo code recording error
        }

        // Update promo code usage count
        const { error: updateError } = await supabase.rpc('increment_promo_usage', {
          promo_id: promoCode.promo_code_id
        });

        if (updateError) {
          console.error('Error updating promo code usage count:', updateError);
        }
      }

      toast({
        title: "Deposit Request Submitted",
        description: "Your manual bank transfer request has been submitted and is pending approval. You will be notified once it's processed.",
      });

      // Reset form
      setFormData({
        amount: '',
        bankName: '',
        bankAccountNumber: '',
        depositorName: '',
        referenceNumber: '',
        proofOfPayment: null,
        notes: ''
      });

      onSuccess?.();

    } catch (error) {
      console.error('Error submitting deposit request:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      toast({
        title: "Submission Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5" />
          Manual Bank Transfer Deposit
        </CardTitle>
        <CardDescription>
          Submit a request for manual bank transfer deposit. Your request will be reviewed and approved by our admin team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert className="mb-6">
          <AlertDescription>
            <strong>Important:</strong> Please ensure all information is accurate. Upload a clear photo or screenshot of your bank transfer receipt as proof of payment.
          </AlertDescription>
        </Alert>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">Transfer to Our Account</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="font-medium text-blue-800">Account Name:</span>
              <span className="text-blue-700">INVESTOURS WORLD LIMITED</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-blue-800">Account Number:</span>
              <span className="text-blue-700">1042347811</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium text-blue-800">Bank:</span>
              <span className="text-blue-700">First City Monument Bank (FCMB)</span>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-3">
            Please transfer the exact amount to this account and upload your proof of payment below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Deposit Amount (₦) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                disabled={!!prefillAmount}
                className={prefillAmount ? "bg-gray-50" : ""}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankName">Bank Name *</Label>
              <Select value={formData.bankName} onValueChange={(value) => handleInputChange('bankName', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your bank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="access">Access Bank</SelectItem>
                  <SelectItem value="fidelity">Fidelity Bank</SelectItem>
                  <SelectItem value="firstbank">First Bank</SelectItem>
                  <SelectItem value="gtb">Guaranty Trust Bank (GTB)</SelectItem>
                  <SelectItem value="heritage">Heritage Bank</SelectItem>
                  <SelectItem value="keystone">Keystone Bank</SelectItem>
                  <SelectItem value="polaris">Polaris Bank</SelectItem>
                  <SelectItem value="providus">Providus Bank</SelectItem>
                  <SelectItem value="stanbic">Stanbic IBTC Bank</SelectItem>
                  <SelectItem value="sterling">Sterling Bank</SelectItem>
                  <SelectItem value="uba">United Bank for Africa (UBA)</SelectItem>
                  <SelectItem value="union">Union Bank</SelectItem>
                  <SelectItem value="unity">Unity Bank</SelectItem>
                  <SelectItem value="wema">Wema Bank</SelectItem>
                  <SelectItem value="zenith">Zenith Bank</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bankAccountNumber">Bank Account Number</Label>
              <Input
                id="bankAccountNumber"
                placeholder="Account number used for transfer"
                value={formData.bankAccountNumber}
                onChange={(e) => handleInputChange('bankAccountNumber', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="depositorName">Depositor Name *</Label>
              <Input
                id="depositorName"
                placeholder="Name on the bank account"
                value={formData.depositorName}
                onChange={(e) => handleInputChange('depositorName', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="referenceNumber">Reference Number / Transaction ID</Label>
            <Input
              id="referenceNumber"
              placeholder="Bank transfer reference or transaction ID"
              value={formData.referenceNumber}
              onChange={(e) => handleInputChange('referenceNumber', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proofOfPayment">Proof of Payment *</Label>
            <div className="flex items-center gap-2">
              <Input
                id="proofOfPayment"
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('proofOfPayment')?.click()}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {formData.proofOfPayment ? formData.proofOfPayment.name : 'Upload Receipt'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload a clear photo or screenshot of your bank transfer receipt (PNG, JPG, PDF)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional information about your transfer..."
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              rows={3}
            />
          </div>

          <Button type="submit" disabled={isLoading || !isFormValid()} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting Request...
              </>
            ) : (
              'Submit Deposit Request'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};