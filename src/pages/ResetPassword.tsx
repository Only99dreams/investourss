// ResetPassword.tsx - OTP-based password reset flow
// Step 1: enter email -> receive 6-digit OTP code by email
// Step 2: enter code -> verified, session established
// Step 3: choose new password -> flag cleared, redirected to login
// Also supports the Supabase recovery-link emails (type=recovery) for backwards compatibility.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Mail, ShieldCheck, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import investoursLogo from "@/assets/investours-logo.png";

type Step = "email" | "code" | "password";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const urlEmail = searchParams.get("email") || "";
  const forced = searchParams.get("forced") === "1";
  const recoveryCode = searchParams.get("code");
  const recoveryType = searchParams.get("type");

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(urlEmail);
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const autoSentRef = useRef(false);

  const sendCode = async (targetEmail?: string) => {
    const emailValue = (targetEmail || email).trim().toLowerCase();
    if (!emailValue) {
      toast({
        title: "Email required",
        description: "Enter the email for your account.",
        variant: "destructive",
      });
      return;
    }

    setEmail(emailValue);
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailValue,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/reset-password?email=${encodeURIComponent(emailValue)}`,
        },
      });

      if (error) {
        console.error("OTP send error:", error.message);
        toast({
          title: "Code not sent",
          description:
            "If an account exists for this email, a reset code has been sent. Please check your inbox and try again.",
          variant: "destructive",
        });
        return;
      }

      setStep("code");
      toast({
        title: "Code sent!",
        description: `We've emailed a 6-digit reset code to ${emailValue}.`,
      });
    } catch (err) {
      console.error("OTP send error:", err);
      toast({
        title: "Error",
        description: "Failed to send the reset code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const token = otpCode.trim();
    if (!token) {
      toast({
        title: "Code required",
        description: "Enter the 6-digit code from your email.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });

      if (error) {
        console.error("OTP verify error:", error.message);
        toast({
          title: "Invalid code",
          description: error.message || "The code is incorrect or has expired. Try again or request a new code.",
          variant: "destructive",
        });
        setOtpCode("");
        return;
      }

      if (data.session) {
        setStep("password");
        setOtpCode("");
        toast({
          title: "Code verified",
          description: "Now choose your new password.",
        });
      } else {
        toast({
          title: "Code verified",
          description: "Now choose your new password.",
        });
        setStep("password");
      }
    } catch (err) {
      console.error("OTP verify error:", err);
      toast({
        title: "Error",
        description: "Could not verify the code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();

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

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error("Password update error:", error);
        toast({
          title: "Reset Failed",
          description: error.message || "Failed to update password. Please try again.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      // Clear the forced-reset flag (if set) for this account.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await (supabase.from("profiles") as any)
            .update({ must_reset_password: false })
            .eq("id", user.id);
        }
      } catch (flagError) {
        console.error("Could not clear must_reset_password:", flagError);
      }

      // Sign out so the user logs in fresh with the new password.
      await supabase.auth.signOut();

      setResetSuccess(true);
      toast({
        title: "Success!",
        description: "Your password has been reset successfully.",
      });

      setTimeout(() => {
        navigate("/auth");
      }, 2000);
    } catch (err: any) {
      console.error("Password update error:", err);
      toast({
        title: "Error",
        description: err?.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        if (recoveryCode && recoveryType === "recovery") {
          const { data, error } = await supabase.auth.exchangeCodeForSession(recoveryCode);
          if (error) {
            console.error("Recovery exchange error:", error);
            setErrorMessage("Invalid or expired reset link. Please request a new one.");
          } else if (data.session) {
            setStep("password");
          }
        } else {
          // If a session already exists (e.g. OTP verified previously), go to password step.
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error) {
            console.error("Session error:", error);
          } else if (session) {
            setStep("password");
          }
        }
      } catch (err) {
        console.error("Init error:", err);
        setErrorMessage("An error occurred. Please try again.");
      } finally {
        setReady(true);
      }
    };

    init();
  }, [recoveryCode, recoveryType]);

  // Forced reset (from login): automatically send the OTP code.
  useEffect(() => {
    if (forced && urlEmail && step === "email" && !autoSentRef.current) {
      autoSentRef.current = true;
      sendCode(urlEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced, urlEmail, step]);

  if (!ready) {
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

  // Invalid recovery link / unrecoverable state
  if (errorMessage) {
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
          <Button variant="ghost" onClick={() => navigate("/auth")} className="mb-6">
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
              <CardDescription>Your password reset link is no longer valid</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
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
              <CardDescription>Your password has been updated</CardDescription>
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
          onClick={() => {
            if (step === "email") navigate("/home");
            else if (step === "code") setStep("email");
            else navigate("/auth");
          }}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {step === "code" ? "Change email" : "Back"}
        </Button>

        <Card variant="elevated" className="border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <img src={investoursLogo} alt="INVESTOURS" className="w-12 h-12 mx-auto mb-4" />
            <CardTitle className="text-2xl">
              {step === "email" && "Reset Password"}
              {step === "code" && "Enter Reset Code"}
              {step === "password" && "Choose New Password"}
            </CardTitle>
            <CardDescription>
              {step === "email" && "Enter your email to receive a 6-digit reset code"}
              {step === "code" && `We sent a 6-digit code to ${email}`}
              {step === "password" && "Your identity is verified. Set a new password for your account"}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            {step === "email" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendCode();
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading || forced}
                    />
                  </div>
                </div>

                {forced && (
                  <p className="text-sm text-muted-foreground">
                    For your security, you need to set a new password before continuing. We've emailed
                    you a code.
                  </p>
                )}

                <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2"
                    />
                  ) : null}
                  {isLoading ? "Sending code..." : "Send Reset Code"}
                </Button>

                {!forced && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => navigate("/auth")}
                  >
                    Back to login
                  </Button>
                )}
              </form>
            )}

            {step === "code" && (
              <form onSubmit={verifyCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">6-digit code</Label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      className="pl-10 text-center text-lg tracking-[0.5em] font-semibold"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter the code from the email we sent to {email}.
                  </p>
                </div>

                <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading || otpCode.length < 6}>
                  {isLoading ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2"
                    />
                  ) : null}
                  {isLoading ? "Verifying..." : "Verify Code"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => sendCode()}
                >
                  Resend code
                </Button>
              </form>
            )}

            {step === "password" && (
              <form onSubmit={submitNewPassword} className="space-y-4">
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
                      disabled={isLoading}
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
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? (
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
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
