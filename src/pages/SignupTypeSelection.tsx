import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, User, Users, ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import investoursLogo from "@/assets/investours-logo.png";
import { Footer } from "@/components/ui/Footer";

const userTypes = [
  {
    id: "individual",
    title: "Individual & Business",
    icon: User,
    description: "For individuals, entrepreneurs, and businesses that want to understand, protect and improve their financial health and build stronger financial futures.",
    features: [
      "🩺 AI Financial Auditor & Financial Health Guidance",
      "🎓 AI Financial Education & Guidance",
      "🛡️ Investment Scam Detection & Protection",
      "📊 AI Business Planning & Income-Building Tools",
      "📈 Financial & Business Growth Tools",
      "🎯 Access to Vetted Opportunities (where available)",
    ],
    color: "primary",
    buttonLabel: "Sign up Now"
  },
  {
    id: "b2b",
    title: "B2B Partners",
    icon: Users,
    description: "For training centers, cooperatives, NGOs, communities and other organizations that want to improve the financial health and economic capacity of the people they serve.",
    features: [
      "🩺 AI Financial Health & Auditing Tools",
      "🎓 Financial Education & AI Learning Modules",
      "📊 Collective Financial & Income Planning",
      "📈 Community Growth & Financial Health Dashboard",
      "👥 Admin & Member Management Tools",
      "🛡️ Scam Awareness & Protection",
    ],
    color: "accent",
    buttonLabel: "Sign up Now"
  }
];

const SignupTypeSelection = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { signUp } = useAuth();

const typeParam = searchParams.get("type");
  const [selectedType, setSelectedType] = useState<string | null>(
    typeParam && userTypes.some((t) => t.id === typeParam) ? typeParam : null
  );
  
  // Update local state if URL param changes
  useEffect(() => {
    setSelectedType(typeParam && userTypes.some((t) => t.id === typeParam) ? typeParam : null);
  }, [typeParam]);

  // Record a referral click once when the page loads with a ?ref= code
  useEffect(() => {
    const urlRef = searchParams.get("ref");
    if (urlRef) {
      supabase.rpc("record_referral_click", { p_code: urlRef }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Form states
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
    disability: "",
    // B2B fields
    b2bName: "",
    b2bType: "",
    contactName: "",
    contactPhone: "",
    // Firm fields
    firmName: "",
    sector: "",
    contactTitle: "",
    confirmLicensed: false,
    confirmAuthorized: false
  });

  const handleSelectType = (typeId: string) => {
    setSearchParams({ type: typeId });
    setSelectedType(typeId);
  };

  const handleBackToSelection = () => {
    setSearchParams({});
    setSelectedType(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedType) return;

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
        full_name: selectedType === 'individual' ? formData.fullName : formData.contactName,
        user_type: selectedType
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
          full_name: selectedType === 'individual' ? formData.fullName : formData.contactName,
          phone: selectedType === 'individual' ? formData.phone : formData.contactPhone,
          country: formData.country,
          gender: formData.gender || null,
          disability: formData.disability || null,
          user_type: selectedType as 'individual' | 'b2b' | 'firm',
          email_opt_in: emailOptIn
        };

        await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

        // Create group or firm record if applicable
        if (selectedType === 'b2b') {
          await supabase.from('groups').insert({
            owner_id: user.id,
            group_name: formData.b2bName,
            group_type: formData.b2bType,
            contact_person_name: formData.contactName,
            contact_person_phone: formData.contactPhone,
            country: formData.country
          });
        } else if (selectedType === 'firm') {
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

        // Handle referral code (SECURITY DEFINER RPC so the link can't silently fail)
        if (formData.referralCode) {
          const { error: refError } = await supabase.rpc('apply_referral_code', {
            p_referral_code: formData.referralCode.trim(),
          });
          if (refError) console.error('Failed to apply referral code:', refError);
        }
      }

      // Check if user session exists (email confirmation off) or needs to confirm email
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Send welcome email (fire-and-forget)
        supabase.functions.invoke('send-notification', {
          body: { type: 'welcome', email: formData.email }
        }).catch(() => {});

        toast({
          title: "Verify Your Email",
          description: `Account created! A verification email has been sent to ${formData.email}. Please check your inbox and click the confirm link to secure your account.`,
          duration: 8000,
        });
        navigate("/complete-profile");
      } else {
        toast({
          title: "Verify Your Email",
          description: `We've sent a confirmation link to ${formData.email}. Please check your inbox (and spam folder) and click it to complete your verification before signing in.`,
          duration: 8000,
        });
        navigate("/auth?mode=login");
      }
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

  // If a type is selected, show the form
  if (selectedType) {
    const config = userTypes.find(t => t.id === selectedType) || userTypes[0];
    const IconComponent = config.icon;

    return (
      <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <div className="flex-1 container mx-auto max-w-lg relative z-10 py-6 md:py-8 px-4">
          <button 
            onClick={handleBackToSelection}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 md:mb-6 transition-colors text-sm md:text-base"
          >
            <ArrowLeft className="w-4 h-4" />
            Change account type
          </button>

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
                <CardTitle className="text-lg md:text-xl">{config.title}</CardTitle>
                <CardDescription className="text-sm md:text-base">{config.description}</CardDescription>
              </CardHeader>

              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Individual Fields */}
                  {selectedType === "individual" && (
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
                      <div className="grid xs:grid-cols-2 gap-3">
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
                        <div className="space-y-2">
                          <Label htmlFor="disability">Do you have a disability?</Label>
                          <Select value={formData.disability} onValueChange={(v) => setFormData({ ...formData, disability: v })}>
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
                    </>
                  )}

                  {/* B2B Fields */}
                  {selectedType === "b2b" && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="b2bName">Organization Name *</Label>
                        <Input 
                          id="b2bName" 
                          placeholder="Enter organization name"
                          value={formData.b2bName}
                          onChange={(e) => setFormData({ ...formData, b2bName: e.target.value })}
                          required 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="b2bType">Type of Organization *</Label>
                        <Select value={formData.b2bType} onValueChange={(v) => setFormData({ ...formData, b2bType: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="coop">Cooperative</SelectItem>
                            <SelectItem value="ngo">NGO</SelectItem>
                            <SelectItem value="school">Training Center</SelectItem>
                            <SelectItem value="religious">Religious Organization</SelectItem>
                            <SelectItem value="community">Community Group</SelectItem>
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
                  {selectedType === "firm" && (
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
                      <div className="grid xs:grid-cols-2 gap-3">
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

                  {selectedType === "firm" && (
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

                  {selectedType === "b2b" && (
                    <div className="flex items-start gap-2">
                      <Checkbox 
                        id="confirmAuthorized"
                        checked={formData.confirmAuthorized}
                        onCheckedChange={(checked) => setFormData({ ...formData, confirmAuthorized: checked as boolean })}
                        required 
                      />
                      <Label htmlFor="confirmAuthorized" className="text-sm text-muted-foreground leading-tight">
                        I confirm I'm authorized to register this organization
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

          <p className="text-center text-sm text-muted-foreground mt-4 md:mt-6">
            Already have an account?{" "}
            <Link to="/auth?mode=login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  // Default view: Type Selection
  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="flex-1 container mx-auto max-w-5xl relative z-10 py-8 px-4">
        {/* Back button */}
        <Link 
          to="/auth" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8 md:mb-12"
        >
          <Link to="/" className="inline-block mb-4 md:mb-6">
            <img 
              src={investoursLogo} 
              alt="Investours" 
              className="w-12 h-12 md:w-16 md:h-16 mx-auto"
            />
          </Link>
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-3 md:mb-4">
            Let's get you started
          </h1>
          <p className="text-base md:text-lg text-muted-foreground">
            Tell us who you are so we can personalize your experience and guide your financial progress.
          </p>
        </motion.div>

        {/* User Type Cards */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid sm:grid-cols-2 gap-4 md:gap-6 max-w-4xl mx-auto"
        >
          {userTypes.map((type, index) => {
            const IconComponent = type.icon;
            const colorClasses = {
              primary: "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
              accent: "bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground",
              "investours-gold": "bg-investours-gold/10 text-investours-gold group-hover:bg-investours-gold group-hover:text-foreground"
            };
            const borderClasses = {
              primary: "hover:border-primary/50",
              accent: "hover:border-accent/50",
              "investours-gold": "hover:border-investours-gold/50"
            };

            return (
              <motion.div
                key={type.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
              >
                <Card 
                  variant="feature"
                  className={`h-full group cursor-pointer ${borderClasses[type.color as keyof typeof borderClasses]}`}
                  onClick={() => handleSelectType(type.id)}
                >
                  <CardHeader>
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-colors ${colorClasses[type.color as keyof typeof colorClasses]}`}>
                      <IconComponent className="w-8 h-8" />
                    </div>
                    <CardTitle className="text-lg md:text-xl">{type.title}</CardTitle>
                    <CardDescription className="text-sm md:text-base">
                      {type.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 md:space-y-2 mb-4 md:mb-6">
                      {type.features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="w-4 h-4 text-accent flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button 
                      variant="outline" 
                      className="w-full whitespace-normal group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors"
                    >
                      {type.buttonLabel || `Select ${type.title}`}
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="text-center text-sm text-muted-foreground mt-8 md:mt-12"
        >
          Already have an account?{" "}
          <Link to="/auth?mode=login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </motion.p>
      </div>
      <Footer />
    </div>
  );
};

export default SignupTypeSelection;
