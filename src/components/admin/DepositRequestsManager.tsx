import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, XCircle, Eye, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';

interface DepositRequest {
  id: string;
  amount: number;
  bank_name: string;
  bank_account_number: string;
  depositor_name: string;
  reference_number: string;
  proof_of_payment_url: string;
  admin_notes: string;
  narration: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  processed_at: string | null;
  processed_by: string | null;
  user: {
    full_name: string;
    email: string;
  };
}

export const DepositRequestsManager: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<DepositRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<DepositRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [selectedProofUrl, setSelectedProofUrl] = useState<string>('');

  const fetchDepositRequests = useCallback(async () => {
    try {
      const { data: requestsData, error: requestsError } = await supabase
        .from('deposit_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (requestsError) throw requestsError;

      // Fetch profiles for all request users
      const userIds = requestsData?.map(request => request.user_id).filter(Boolean) || [];
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      // Combine requests with profile data
      const requestsWithProfiles = requestsData?.map(request => ({
        ...request,
        user: profilesData?.find(profile => profile.id === request.user_id) || {
          full_name: 'Unknown User',
          email: 'N/A'
        }
      })) || [];

      setRequests(requestsWithProfiles);
    } catch (error) {
      console.error('Error fetching deposit requests:', error);
      toast({
        title: "Error",
        description: "Failed to load deposit requests.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDepositRequests();
  }, [fetchDepositRequests]);

  const processRequest = async (requestId: string, action: 'approve' | 'reject') => {
    if (!user) return;

    setProcessingId(requestId);

    try {
      // Call the database function to process the request
      const { data, error } = await supabase.rpc('process_deposit_request', {
        request_id: requestId,
        admin_id: user.id,
        action: action
      });

      if (error) throw error;

      toast({
        title: action === 'approve' ? "Deposit Approved" : "Deposit Rejected",
        description: `The deposit request has been ${action === 'approve' ? 'approved' : 'rejected'} successfully.`,
      });

      // Refresh the requests list
      await fetchDepositRequests();

    } catch (error) {
      console.error('Error processing deposit request:', error);
      toast({
        title: "Processing Failed",
        description: `Failed to ${action} the deposit request. Please try again.`,
        variant: "destructive"
      });
    } finally {
      setProcessingId(null);
      setSelectedRequest(null);
      setAdminNotes('');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'approved':
        return <Badge variant="default" className="bg-green-500">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 md:p-12">
        <Loader2 className="h-6 w-6 md:h-8 md:w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl">Deposit Requests Management</CardTitle>
          <CardDescription className="text-sm">
            Review and process manual bank transfer deposit requests from users.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {requests.length === 0 ? (
            <div className="text-center py-8 md:py-12 text-muted-foreground">
              <p className="text-sm md:text-base">No deposit requests found.</p>
            </div>
          ) : (
            <div className="space-y-3 md:space-y-4">
              {requests.map((request) => (
                <Card key={request.id} className="p-3 md:p-4 shadow-sm">
                  <div className="flex flex-col space-y-3 md:space-y-0 md:flex-row md:items-start md:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                        <h3 className="font-semibold text-sm md:text-base truncate">{request.user.full_name}</h3>
                        <div className="flex flex-wrap gap-1">
                          {request.narration?.includes('subscription') && (
                            <Badge variant="default" className="bg-purple-500 text-xs">
                              Subscription
                            </Badge>
                          )}
                          {getStatusBadge(request.status)}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs md:text-sm text-muted-foreground">
                        <div className="flex justify-between sm:block">
                          <span className="font-medium">Amount:</span>
                          <span>₦{request.amount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between sm:block">
                          <span className="font-medium">Type:</span>
                          <span>{request.narration?.includes('subscription') ? 'Subscription Payment' : 'Wallet Deposit'}</span>
                        </div>
                        <div className="flex justify-between sm:block">
                          <span className="font-medium">Bank:</span>
                          <span className="truncate">{request.bank_name || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between sm:block">
                          <span className="font-medium">Reference:</span>
                          <span className="truncate">{request.reference_number || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between sm:block sm:col-span-2">
                          <span className="font-medium">Submitted:</span>
                          <span>{format(new Date(request.created_at), 'PPp')}</span>
                        </div>
                        {request.processed_at && (
                          <div className="flex justify-between sm:block sm:col-span-2">
                            <span className="font-medium">Processed:</span>
                            <span>{format(new Date(request.processed_at), 'PPp')}</span>
                          </div>
                        )}
                      </div>
                      {request.admin_notes && (
                        <div className="mt-3 p-2 bg-gray-50 rounded-md">
                          <p className="text-xs md:text-sm">
                            <strong>Admin Notes:</strong> {request.admin_notes}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 md:ml-4">
                      {request.proof_of_payment_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedProofUrl(request.proof_of_payment_url);
                            setProofModalOpen(true);
                          }}
                          className="w-full sm:w-auto text-xs md:text-sm"
                        >
                          <Eye className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                          View Proof
                        </Button>
                      )}

                      {request.status === 'pending' && (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="default"
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 w-full sm:w-auto text-xs md:text-sm"
                                onClick={() => setSelectedRequest(request)}
                              >
                                <CheckCircle className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                                Approve
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="w-[95vw] max-w-md mx-auto">
                              <DialogHeader>
                                <DialogTitle className="text-base md:text-lg">Approve Deposit Request</DialogTitle>
                                <DialogDescription className="text-sm">
                                  Are you sure you want to approve this {request.narration?.includes('subscription') ? 'subscription payment' : 'deposit'} request for ₦{request.amount.toLocaleString()}?
                                  {request.narration?.includes('subscription')
                                    ? ' This will activate the user\'s premium subscription immediately.'
                                    : ' This will credit the user\'s wallet immediately.'
                                  }
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-sm font-medium">Admin Notes (Optional)</label>
                                  <Textarea
                                    placeholder="Add any notes about this approval..."
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                    className="text-sm"
                                  />
                                </div>
                              </div>
                              <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setSelectedRequest(null)}
                                  className="w-full sm:w-auto"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => processRequest(request.id, 'approve')}
                                  disabled={processingId === request.id}
                                  className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                                >
                                  {processingId === request.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  ) : (
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                  )}
                                  Approve Deposit
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="w-full sm:w-auto text-xs md:text-sm"
                                onClick={() => setSelectedRequest(request)}
                              >
                                <XCircle className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                                Reject
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="w-[95vw] max-w-md mx-auto">
                              <DialogHeader>
                                <DialogTitle className="text-base md:text-lg">Reject Deposit Request</DialogTitle>
                                <DialogDescription className="text-sm">
                                  Are you sure you want to reject this deposit request for ₦{request.amount.toLocaleString()}?
                                  The user will be notified of the rejection.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-sm font-medium">Reason for Rejection *</label>
                                  <Textarea
                                    placeholder="Please provide a reason for rejecting this request..."
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                    required
                                    className="text-sm"
                                  />
                                </div>
                              </div>
                              <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setSelectedRequest(null)}
                                  className="w-full sm:w-auto"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => processRequest(request.id, 'reject')}
                                  disabled={processingId === request.id || !adminNotes.trim()}
                                  className="w-full sm:w-auto"
                                >
                                  {processingId === request.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  ) : (
                                    <XCircle className="h-4 w-4 mr-2" />
                                  )}
                                  Reject Deposit
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Proof of Payment Modal */}
      <Dialog open={proofModalOpen} onOpenChange={setProofModalOpen}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Proof of Payment</DialogTitle>
            <DialogDescription>
              Review the uploaded proof of payment document
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center items-center min-h-[400px] bg-gray-50 rounded-lg">
            {selectedProofUrl ? (
              selectedProofUrl.toLowerCase().includes('.pdf') ? (
                <iframe
                  src={selectedProofUrl}
                  className="w-full h-[500px] border rounded"
                  title="Proof of Payment PDF"
                />
              ) : (
                <img
                  src={selectedProofUrl}
                  alt="Proof of Payment"
                  className="max-w-full max-h-[500px] object-contain rounded"
                  onError={(e) => {
                    e.currentTarget.src = '/placeholder-image.png';
                  }}
                />
              )
            ) : (
              <div className="text-center text-muted-foreground">
                <p>No proof of payment available</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProofModalOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => window.open(selectedProofUrl, '_blank')}
              disabled={!selectedProofUrl}
            >
              Open in New Tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};