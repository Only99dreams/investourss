// Auth.tsx - FIXED VERSION for password reset redirect
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowLeft, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import investoursLogo from "@/assets/investours-logo.png";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, signOut, user, isLoading: authLoading } = useAuth();
  
  const initialMode = searchParams.get("mode") === "forgot" ? "forgot" : "login";
  const [mode, setMode] = useState<"login" | "forgot">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(true);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // Redirect if already logged in
  useEffect(() => {
    if (user && !authLoading) {
      navigate("/dashboard");
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (mode === "login") {
      const { error } = await signIn(formData.email, formData.password);
      setIsLoading(false);
      
      if (error) {
        toast({
          title: "Login Failed",
          description: error.message || "Invalid email or password",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Welcome back!",
          description: "You have successfully logged in.",
        });
        navigate("/dashboard");
      }
    } else if (mode === "forgot") {
      setIsLoading(false);
      navigate(`/reset-password?email=${encodeURIComponent(formData.email)}`);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full"
        />
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
        <Link 
          to="/home" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <Card variant="elevated" className="border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <Link to="/" className="inline-block mx-auto mb-4">
              <img 
                src={investoursLogo} 
                alt="INVESTOURS" 
                className="w-16 h-16"
              />
            </Link>
            <CardTitle className="text-2xl">
              {mode === "login" ? "Login" : "Reset Password"}
            </CardTitle>
            <CardDescription>
              {mode === "login" 
                ? "Access your account to continue"
                : "Enter your email to receive a reset link"}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
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

              {mode === "login" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
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
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="remember"
                      checked={emailOptIn}
                      onCheckedChange={(checked) => setEmailOptIn(checked === true)}
                    />
                    <label
                      htmlFor="remember"
                      className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    >
                      Remember me
                    </label>
                  </div>

                  <p className="text-sm text-muted-foreground mt-2">
                    If your account existed before the migration, use "Forgot password?" to recover access.
                  </p>
                </>
              )}

              {mode === "forgot" && (
                <p className="text-sm text-muted-foreground">
                  We'll send you an email with a link to reset your password.
                </p>
              )}

              <Button 
                type="submit" 
                variant="hero"
                className="w-full" 
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full mr-2"
                    />
                    {mode === "login" ? "Signing in..." : "Sending..."}
                  </>
                ) : (
                  mode === "login" ? "Sign In" : "Send Reset Link"
                )}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              {mode === "login" ? (
                <>
                  <p className="text-muted-foreground">
                    Don't have an account?{" "}
                    <Link 
                      to="/signup" 
                      className="text-primary hover:underline font-semibold"
                    >
                      Sign up
                    </Link>
                  </p>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-primary hover:underline font-semibold mt-2"
                  >
                    Forgot password?
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-primary hover:underline font-semibold"
                >
                  Back to login
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Auth;