// ResetPassword.tsx - FIXED VERSION
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import investoursLogo from "@/assets/investours-logo.png";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { isLoading: authLoading } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        // Check for recovery token in URL (from reset email link)
        const code = searchParams.get('code');
        const type = searchParams.get('type');
        
        console.log('URL params:', { code, type });
        
        if (code && type === 'recovery') {
          // Exchange recovery code for session
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          
          if (error) {
            console.error('Token exchange error:', error);
            setErrorMessage('Invalid or expired reset link. Please request a new one.');
            setHasValidSession(false);
          } else if (data.session) {
            console.log('Session established from recovery code');
            setHasValidSession(true);
            setErrorMessage(null);
          }
        } else {
          // Try to get current session (for already authenticated users)
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Session error:', error);
            setErrorMessage('Session error. Please try requesting a new reset link.');
            setHasValidSession(false);
          } else if (session) {
            setHasValidSession(true);
            setErrorMessage(null);
          } else {
            setErrorMessage('Invalid or expired reset link. Please request a new one.');
            setHasValidSession(false);
          }
        }
      } catch (error) {
        console.error('Error checking session:', error);
        setErrorMessage('An error occurred. Please try again.');
        setHasValidSession(false);
      } finally {
        setReady(true);
      }
    };

    checkSession();
  }, [searchParams]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!password || !confirmPassword) {
      toast({
        title: "Missing Fields",
        description: "Please fill in both password fields.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Invalid Password",
        description: "Password must be at least 8 characters long.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords Do Not Match",
        description: "Please ensure both password fields match.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error('Password update error:', error);
        toast({
          title: "Reset Failed",
          description: error.message || "Failed to update password. Please try again.",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      // Success!
      setResetSuccess(true);
      toast({
        title: "Success!",
        description: "Your password has been reset successfully.",
      });

      // Redirect to login or dashboard after 2 seconds
      setTimeout(() => {
        navigate("/auth");
      }, 2000);
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  if (authLoading || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full"
        />
      </div>
    );
  }

  // Error state - invalid or expired link
  if (!hasValidSession && errorMessage) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md z-10"
        >
          <Button
            variant="ghost"
            onClick={() => navigate("/auth")}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Login
          </Button>

          <Card variant="elevated" className="border-0 shadow-xl">
            <CardHeader className="text-center pb-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5 }}
                className="flex justify-center mb-4"
              >
                <AlertCircle className="w-16 h-16 text-destructive" />
              </motion.div>
              <img src={investoursLogo} alt="INVESTOURS" className="w-12 h-12 mx-auto mb-3" />
              <CardTitle className="text-2xl">Reset Link Expired</CardTitle>
              <CardDescription>
                Your password reset link is no longer valid
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  {errorMessage}
                </p>
                <Button
                  onClick={() => navigate("/auth?mode=forgot")}
                  variant="hero"
                  className="w-full"
                >
                  Request New Reset Link
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (resetSuccess) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md z-10"
        >
          <Card variant="elevated" className="border-0 shadow-xl">
            <CardHeader className="text-center pb-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, type: "spring" }}
                className="flex justify-center mb-4"
              >
                <CheckCircle2 className="w-16 h-16 text-green-500" />
              </motion.div>
              <img src={investoursLogo} alt="INVESTOURS" className="w-12 h-12 mx-auto mb-3" />
              <CardTitle className="text-2xl">Password Reset Successful!</CardTitle>
              <CardDescription>
                Your password has been updated
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-center text-sm text-muted-foreground">
                Redirecting you to login...
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <Button
          variant="ghost"
          onClick={() => navigate("/home")}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        <Card variant="elevated" className="border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <img src={investoursLogo} alt="INVESTOURS" className="w-16 h-16 mx-auto mb-4" />
            <CardTitle className="text-2xl">Reset Password</CardTitle>
            <CardDescription>
              Choose a new password for your account
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter new password"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    disabled={submitting}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters long
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirm"
                    type="password"
                    placeholder="Confirm new password"
                    className="pl-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="hero"
                className="w-full"
                size="lg"
                disabled={submitting}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                    />
                    Updating Password...
                  </span>
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default ResetPassword;