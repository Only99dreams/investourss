import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, Lock, Mail, UserCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import investoursLogo from "@/assets/investours-logo.png";
import {
  normalizeReferralCode,
  readReferralCode,
  verifyReferralCode,
  clearReferralCode,
} from "@/lib/referral";

export type CommunityAuthMode = "login" | "signup";

interface CommunityAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which form to land on. The visitor can switch freely inside. */
  initialMode?: CommunityAuthMode;
  /**
   * The post owner's referral code, carried by a shared link. When absent the
   * code captured earlier in the session is used instead.
   */
  referralCode?: string | null;
  /**
   * Called after a session is established, so the caller can resume whatever
   * the visitor was trying to do (like, comment, or vote).
   */
  onAuthenticated: () => void;
}

type ReferralStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid"; name: string | null }
  | { state: "invalid" };

/**
 * Sign in or sign up without leaving the community.
 *
 * The fields mirror the real /auth and /signup screens exactly (individual
 * registration), so a visitor who arrives from a shared post can register in
 * place and go straight back to voting. The referral code from the shared link
 * is prefilled and applied server-side, so the post owner gets credited.
 *
 * Email confirmation remains the source of truth: when Supabase returns a
 * session the visitor is signed in and the pending action resumes; when a
 * confirmation email is required there is no session yet, so they are told to
 * confirm and the dialog falls back to sign in.
 */
export function CommunityAuthDialog({
  open,
  onOpenChange,
  initialMode = "login",
  referralCode = null,
  onAuthenticated,
}: CommunityAuthDialogProps) {
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<CommunityAuthMode>(initialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [referralStatus, setReferralStatus] = useState<ReferralStatus>({ state: "idle" });

  const [formData, setFormData] = useState({
    // Login
    email: "",
    password: "",
    // Individual signup
    fullName: "",
    phone: "",
    gender: "",
    country: "",
    disability: "",
    accountType: "individual",
    referralCode: "",
  });

  // Reset to the requested form each time the dialog opens; a previous session
  // should never bleed into a fresh one.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setIsLoading(false);
    setShowPassword(false);
    const code = normalizeReferralCode(referralCode) || readReferralCode();
    setFormData((prev) => ({ ...prev, password: "", referralCode: code }));
  }, [open, initialMode, referralCode]);

  // Verify the referral code so the visitor can see their referrer is linked.
  // Debounced because the code field is editable.
  useEffect(() => {
    if (!open || mode !== "signup") return;
    const code = normalizeReferralCode(formData.referralCode) || readReferralCode();
    if (!code) {
      setReferralStatus({ state: "idle" });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setReferralStatus({ state: "checking" });
      verifyReferralCode(code).then((result) => {
        if (cancelled) return;
        setReferralStatus(
          result.valid
            ? { state: "valid", name: result.referrerName ?? null }
            : { state: "invalid" },
        );
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mode, formData.referralCode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await signIn(formData.email, formData.password);
    setIsLoading(false);

    if (error) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Welcome back!", description: "You have been signed in." });
    onAuthenticated();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agreedToTerms) {
      toast({
        title: "Terms Required",
        description: "Please agree to the Terms & Privacy Policy to continue.",
        variant: "destructive",
      });
      return;
    }

    if (referralStatus.state === "invalid") {
      toast({
        title: "Invalid Referral Code",
        description: "That referral code was not recognised. Please check it and try again.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const signUpMetadata: Record<string, unknown> = {
        full_name: formData.fullName,
        user_type: "individual",
      };
      const referralCode = normalizeReferralCode(formData.referralCode);
      // Carried in signup metadata so handle_new_user() can attribute the
      // referral server-side even when email confirmation is enabled.
      if (referralCode) signUpMetadata.referral_code = referralCode;

      const { error } = await signUp(formData.email, formData.password, signUpMetadata);
      if (error) {
        toast({ title: "Signup Failed", description: error.message, variant: "destructive" });
        setIsLoading(false);
        return;
      }

      // Wait for the profile row created by the database trigger.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        await supabase
          .from("profiles")
          .update({
            full_name: formData.fullName,
            phone: formData.phone,
            country: formData.country,
            gender: formData.gender || null,
            disability: formData.disability || null,
            user_type: "individual",
            account_type: formData.accountType,
            email_opt_in: emailOptIn,
          })
          .eq("id", user.id);

        if (referralCode) {
          const { error: refError } = await supabase.rpc("apply_referral_code", {
            p_referral_code: referralCode,
          });
          if (refError) console.error("Failed to apply referral code:", refError);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      // The code has now been handed to the server; don't reuse it later.
      clearReferralCode();

      if (session) {
        supabase.functions
          .invoke("send-notification", { body: { type: "welcome", email: formData.email } })
          .catch(() => {});
        toast({
          title: "Account Created!",
          description: "Welcome to Investours. You can continue where you left off.",
        });
        onAuthenticated();
      } else {
        // Email confirmation is on, so there is no session to resume with yet.
        toast({
          title: "Verify Your Email",
          description: `We've sent a confirmation link to ${formData.email}. Confirm it, then sign in to continue.`,
          duration: 8000,
        });
        setMode("login");
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center">
          <img src={investoursLogo} alt="Investours" className="w-12 h-12 mx-auto mb-1" />
          <DialogTitle className="text-xl">
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </DialogTitle>
          <DialogDescription>
            {mode === "login"
              ? "Access your account to vote, love and comment."
              : "Register in a moment, then continue right where you left off."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode switch */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "login" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="community-auth-email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="community-auth-email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-auth-password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="community-auth-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  className="pl-10 pr-10"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="community-auth-remember"
                checked={emailOptIn}
                onCheckedChange={(checked) => setEmailOptIn(checked === true)}
              />
              <label
                htmlFor="community-auth-remember"
                className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              >
                Remember me
              </label>
            </div>

            <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2"
                  />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="community-signup-name">Full Name *</Label>
              <Input
                id="community-signup-name"
                placeholder="Enter your full name"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-signup-account">I am registering as *</Label>
              <Select
                value={formData.accountType}
                onValueChange={(v) => setFormData({ ...formData, accountType: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="community-signup-phone">Phone Number *</Label>
                <Input
                  id="community-signup-phone"
                  type="tel"
                  placeholder="+234..."
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="community-signup-gender">Gender</Label>
                <Select
                  value={formData.gender}
                  onValueChange={(v) => setFormData({ ...formData, gender: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="prefer-not">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="community-signup-disability">Do you have a disability?</Label>
                <Select
                  value={formData.disability}
                  onValueChange={(v) => setFormData({ ...formData, disability: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="visual">Visual</SelectItem>
                    <SelectItem value="hearing">Hearing</SelectItem>
                    <SelectItem value="mobility">Mobility</SelectItem>
                    <SelectItem value="cognitive">Cognitive</SelectItem>
                    <SelectItem value="speech">Speech</SelectItem>
                    <SelectItem value="multiple">Multiple</SelectItem>
                    <SelectItem value="prefer-not">Prefer not to say</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-signup-email">Email *</Label>
              <Input
                id="community-signup-email"
                type="email"
                placeholder="Enter email address"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-signup-password">Create Password *</Label>
              <div className="relative">
                <Input
                  id="community-signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-signup-country">Country of Residence *</Label>
              <Select
                value={formData.country}
                onValueChange={(v) => setFormData({ ...formData, country: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ng">Nigeria</SelectItem>
                  <SelectItem value="gh">Ghana</SelectItem>
                  <SelectItem value="ke">Kenya</SelectItem>
                  <SelectItem value="za">South Africa</SelectItem>
                  <SelectItem value="uk">United Kingdom</SelectItem>
                  <SelectItem value="us">United States</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="community-signup-referral">Referral Code (Optional)</Label>
              <Input
                id="community-signup-referral"
                placeholder="Enter referral code"
                value={formData.referralCode}
                onChange={(e) => setFormData({ ...formData, referralCode: e.target.value })}
              />
              {referralStatus.state === "valid" && (
                <p className="flex items-center gap-1.5 text-xs text-green-600">
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  Referral code applied
                  {referralStatus.name ? ` — invited by ${referralStatus.name}` : ""}.
                </p>
              )}
              {referralStatus.state === "invalid" && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  We could not find that referral code. Please double-check it.
                </p>
              )}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="community-signup-optin"
                checked={emailOptIn}
                onCheckedChange={(checked) => setEmailOptIn(checked as boolean)}
              />
              <Label htmlFor="community-signup-optin" className="text-sm text-muted-foreground leading-tight">
                I want to receive updates, newsletters, and promotional emails from Investours
              </Label>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="community-signup-terms"
                checked={agreedToTerms}
                onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
              />
              <Label htmlFor="community-signup-terms" className="text-sm text-muted-foreground leading-tight">
                I agree to the{" "}
                <a href="#" className="text-primary hover:underline">Terms of Service</a>
                {" "}and{" "}
                <a href="#" className="text-primary hover:underline">Privacy Policy</a>
              </Label>
            </div>

            <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                  />
                  Creating Account...
                </span>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CommunityAuthDialog;
