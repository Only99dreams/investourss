import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, User, Users, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import investoursLogo from "@/assets/investours-logo.png";
import { Footer } from "@/components/ui/Footer";

const SignupForm = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { signUp } = useAuth();
  
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(true);

  // Get referral code from URL params or sessionStorage
  const getInitialReferralCode = () => {
    const urlRef = searchParams.get("ref");
    if (urlRef) return urlRef;
    const storedRef = sessionStorage.getItem("referral_code");
    if (storedRef) {
      sessionStorage.removeItem("referral_code"); // Clear after use
      return storedRef;
    }
    return "";
  };

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    gender: "",
    country: "",
    referralCode: getInitialReferralCode(),
    // Group fields
    groupName: "",
    groupType: "",
    contactName: "",
    contactPhone: "",
    // Firm fields
    firmName: "",
    sector: "",
    contactTitle: "",
    confirmLicensed: false,
    confirmAuthorized: false
  });

  const typeConfig = {
    individual: {
      title: "Individual Account",
      icon: User,
      description: "Create your personal investment account"
    },
    group: {
      title: "Group Account",
      icon: Users,
      description: "Register your organization or cooperative"
    },
    firm: {
      title: "Investment Partner Account",
      icon: Building2,
      description: "Register your licensed investment firm"
    }
  };

  const config = typeConfig[type as keyof typeof typeConfig] || typeConfig.individual;
  const IconComponent = config.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!agreedToTerms) {
      toast({
        title: "Terms Required",
        description: "Please agree to the Terms & Privacy Policy to continue.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      // Sign up the user
      const { error } = await signUp(formData.email, formData.password, {
        full_name: type === 'individual' ? formData.fullName : formData.contactName,
        user_type: type
      });

      if (error) {
        toast({
          title: "Signup Failed",
          description: error.message,
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      // Wait for the profile to be created by the trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get the current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Update profile with additional info
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profileUpdate: any = {
          full_name: type === 'individual' ? formData.fullName : formData.contactName,
          phone: type === 'individual' ? formData.phone : formData.contactPhone,
          country: formData.country,
          gender: formData.gender || null,
          user_type: type as 'individual' | 'group' | 'firm',
          email_opt_in: emailOptIn
        };

        await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

        // Create group or firm record if applicable
        if (type === 'group') {
          await supabase.from('groups').insert({
            owner_id: user.id,
            group_name: formData.groupName,
            group_type: formData.groupType,
            contact_person_name: formData.contactName,
            contact_person_phone: formData.contactPhone,
            country: formData.country
          });
        } else if (type === 'firm') {
          await supabase.from('firms').insert({
            owner_id: user.id,
            firm_name: formData.firmName,
            sector: formData.sector,
            contact_person_name: formData.contactName,
            contact_person_title: formData.contactTitle,
            contact_phone: formData.contactPhone,
            contact_email: formData.email,
            country: formData.country
          });
        }

        // Handle referral code
        if (formData.referralCode) {
          const { data: referrer } = await supabase
            .from('profiles')
            .select('id')
            .eq('referral_code', formData.referralCode)
            .maybeSingle();

          if (referrer) {
            await supabase.from('profiles').update({ referred_by: referrer.id }).eq('id', user.id);
          }
        }
      }

      toast({
        title: "Account Created!",
        description: "Welcome to Investours. Please complete your profile.",
      });
      navigate("/complete-profile");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="flex-1 container mx-auto max-w-lg relative z-10 py-8 px-4">
        <Link 
          to="/signup" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Change account type
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card variant="elevated" className="border-0 shadow-xl">
            <CardHeader className="text-center pb-2">
              <Link to="/" className="inline-block mx-auto mb-2">
                <img src={investoursLogo} alt="Investours" className="w-12 h-12" />
              </Link>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <IconComponent className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-xl">{config.title}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Individual Fields */}
                {type === "individual" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full Name *</Label>
                      <Input 
                        id="fullName" 
                        placeholder="Enter your full name" 
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number *</Label>
                        <Input 
                          id="phone" 
                          type="tel" 
                          placeholder="+234..."
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          required 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gender">Gender</Label>
                        <Select value={formData.gender} onValueChange={(v) => setFormData({ ...formData, gender: v })}>
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
                    </div>
                  </>
                )}

                {/* Group Fields */}
                {type === "group" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="groupName">Group Name *</Label>
                      <Input 
                        id="groupName" 
                        placeholder="Enter organization name"
                        value={formData.groupName}
                        onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
                        required 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="groupType">Type of Group *</Label>
                      <Select value={formData.groupType} onValueChange={(v) => setFormData({ ...formData, groupType: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="coop">Cooperative</SelectItem>
                          <SelectItem value="ngo">NGO</SelectItem>
                          <SelectItem value="school">School</SelectItem>
                          <SelectItem value="religious">Religious Organization</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contactName">Contact Person Name *</Label>
                      <Input 
                        id="contactName" 
                        placeholder="Full name of contact"
                        value={formData.contactName}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        required 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contactPhone">Contact Phone *</Label>
                      <Input 
                        id="contactPhone" 
                        type="tel" 
                        placeholder="+234..."
                        value={formData.contactPhone}
                        onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                        required 
                      />
                    </div>
                  </>
                )}

                {/* Firm Fields */}
                {type === "firm" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="firmName">Firm/Company Name *</Label>
                      <Input 
                        id="firmName" 
                        placeholder="Enter company name"
                        value={formData.firmName}
                        onChange={(e) => setFormData({ ...formData, firmName: e.target.value })}
                        required 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sector">Sector *</Label>
                      <Select value={formData.sector} onValueChange={(v) => setFormData({ ...formData, sector: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select sector" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="agriculture">Agriculture</SelectItem>
                          <SelectItem value="energy">Renewable Energy</SelectItem>
                          <SelectItem value="realestate">Real Estate</SelectItem>
                          <SelectItem value="finance">Finance</SelectItem>
                          <SelectItem value="tech">Technology</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="contactName">Contact Name *</Label>
                        <Input 
                          id="contactName" 
                          placeholder="Full name"
                          value={formData.contactName}
                          onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                          required 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="contactTitle">Title/Position *</Label>
                        <Input 
                          id="contactTitle" 
                          placeholder="e.g. CEO"
                          value={formData.contactTitle}
                          onChange={(e) => setFormData({ ...formData, contactTitle: e.target.value })}
                          required 
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contactPhone">Contact Phone *</Label>
                      <Input 
                        id="contactPhone" 
                        type="tel" 
                        placeholder="+234..."
                        value={formData.contactPhone}
                        onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                        required 
                      />
                    </div>
                  </>
                )}

                {/* Common Fields */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="Enter email address"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Create Password *</Label>
                  <div className="relative">
                    <Input
                      id="password"
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
                  <Label htmlFor="country">Country of Residence *</Label>
                  <Select value={formData.country} onValueChange={(v) => setFormData({ ...formData, country: v })}>
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
                  <Label htmlFor="referral">Referral Code (Optional)</Label>
                  <Input 
                    id="referral" 
                    placeholder="Enter referral code"
                    value={formData.referralCode}
                    onChange={(e) => setFormData({ ...formData, referralCode: e.target.value })}
                  />
                </div>

                {type === "firm" && (
                  <div className="flex items-start gap-2">
                    <Checkbox 
                      id="confirmLicensed" 
                      checked={formData.confirmLicensed}
                      onCheckedChange={(checked) => setFormData({ ...formData, confirmLicensed: checked as boolean })}
                      required 
                    />
                    <Label htmlFor="confirmLicensed" className="text-sm text-muted-foreground leading-tight">
                      I confirm I represent a licensed investment firm
                    </Label>
                  </div>
                )}

                {type === "group" && (
                  <div className="flex items-start gap-2">
                    <Checkbox 
                      id="confirmAuthorized"
                      checked={formData.confirmAuthorized}
                      onCheckedChange={(checked) => setFormData({ ...formData, confirmAuthorized: checked as boolean })}
                      required 
                    />
                    <Label htmlFor="confirmAuthorized" className="text-sm text-muted-foreground leading-tight">
                      I confirm I'm authorized to register this group
                    </Label>
                  </div>
                )}

                <div className="flex items-start gap-2">
                  <Checkbox 
                    id="emailOptIn" 
                    checked={emailOptIn}
                    onCheckedChange={(checked) => setEmailOptIn(checked as boolean)}
                  />
                  <Label htmlFor="emailOptIn" className="text-sm text-muted-foreground leading-tight">
                    I want to receive updates, newsletters, and promotional emails from Investours
                  </Label>
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox 
                    id="terms" 
                    checked={agreedToTerms}
                    onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                  />
                  <Label htmlFor="terms" className="text-sm text-muted-foreground leading-tight">
                    I agree to the{" "}
                    <a href="#" className="text-primary hover:underline">Terms of Service</a>
                    {" "}and{" "}
                    <a href="#" className="text-primary hover:underline">Privacy Policy</a>
                  </Label>
                </div>

                <Button 
                  type="submit" 
                  variant="hero" 
                  className="w-full" 
                  size="lg"
                  disabled={isLoading}
                >
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
            </CardContent>
          </Card>
        </motion.div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link to="/auth?mode=login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
      <Footer />
    </div>
  );
};

export default SignupForm;
