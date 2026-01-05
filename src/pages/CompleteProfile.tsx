import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { User, Calendar, MapPin, Briefcase, Languages, Target, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Footer } from "@/components/ui/Footer";
import investoursLogo from "@/assets/investours-logo.png";

const signupReasons = [
  { id: "learn", label: "To learn about money and investing" },
  { id: "scams", label: "To protect myself from scams" },
  { id: "invest", label: "To access safe investment opportunities" },
  { id: "climate", label: "To learn about climate resilience" },
  { id: "gfe", label: "To learn and make money as a Grassroots Financial Educator - GFE" }
];

const CompleteProfile = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, refreshProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showGFETerms, setShowGFETerms] = useState(false);

  const [formData, setFormData] = useState({
    dateOfBirth: "",
    residentialAddress: "",
    occupation: "",
    sector: "",
    institution: "",
    languagesSpoken: [] as string[],
    signupReasons: [] as string[],
    agreeGFETerms: false
  });

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    }
  }, [user, navigate]);

  useEffect(() => {
    setShowGFETerms(formData.signupReasons.includes("gfe"));
  }, [formData.signupReasons]);

  const handleReasonChange = (reasonId: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      signupReasons: checked 
        ? [...prev.signupReasons, reasonId]
        : prev.signupReasons.filter(r => r !== reasonId)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.signupReasons.includes("gfe") && !formData.agreeGFETerms) {
      toast({
        title: "GFE Terms Required",
        description: "Please agree to the GFE Terms to become a Grassroots Financial Educator.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      const updateData: Record<string, unknown> = {
        date_of_birth: formData.dateOfBirth || null,
        residential_address: formData.residentialAddress,
        occupation: formData.occupation,
        sector: formData.sector,
        institution: formData.institution,
        languages_spoken: formData.languagesSpoken.length > 0 ? formData.languagesSpoken : null,
        signup_reasons: formData.signupReasons,
        profile_completed: true,
        onboarding_completed: true
      };

      if (formData.signupReasons.includes("gfe") && formData.agreeGFETerms) {
        updateData.is_gfe = true;
        updateData.gfe_terms_agreed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", user?.id);

      if (error) throw error;

      await refreshProfile();
      
      toast({
        title: "Profile Completed!",
        description: "Welcome to Investours. You now have full access.",
      });
      
      navigate("/dashboard");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update profile",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      <div className="flex-1 container mx-auto max-w-2xl py-8 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card variant="elevated" className="border-0 shadow-xl">
            <CardHeader className="text-center">
              <img src={investoursLogo} alt="Investours" className="w-12 h-12 mx-auto mb-4" />
              <CardTitle className="text-2xl">Welcome, {profile?.full_name || "User"}!</CardTitle>
              <CardDescription className="text-base">
                Your account is restricted. Please complete your profile to gain full access to your free packages from Investours.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dob" className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Date of Birth
                    </Label>
                    <Input 
                      id="dob" 
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="occupation" className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4" /> Occupation
                    </Label>
                    <Select value={formData.occupation} onValueChange={(v) => setFormData({ ...formData, occupation: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select occupation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="teacher">Teacher</SelectItem>
                        <SelectItem value="community_leader">Community Leader</SelectItem>
                        <SelectItem value="trader">Trader</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="entrepreneur">Entrepreneur</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sector">Sector</Label>
                    <Select value={formData.sector} onValueChange={(v) => setFormData({ ...formData, sector: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select sector" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agriculture">Agriculture</SelectItem>
                        <SelectItem value="education">Education</SelectItem>
                        <SelectItem value="finance">Finance</SelectItem>
                        <SelectItem value="health">Healthcare</SelectItem>
                        <SelectItem value="technology">Technology</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="institution">Name of Institution</Label>
                    <Input 
                      id="institution" 
                      placeholder="Your school, company, etc."
                      value={formData.institution}
                      onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address" className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Residential Address
                  </Label>
                  <Textarea 
                    id="address" 
                    placeholder="Enter your full address"
                    value={formData.residentialAddress}
                    onChange={(e) => setFormData({ ...formData, residentialAddress: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Languages className="w-4 h-4" /> Languages Spoken
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {["English", "Yoruba", "Hausa", "Igbo", "Pidgin", "French", "Other"].map((lang) => (
                      <Button
                        key={lang}
                        type="button"
                        variant={formData.languagesSpoken.includes(lang) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            languagesSpoken: prev.languagesSpoken.includes(lang)
                              ? prev.languagesSpoken.filter(l => l !== lang)
                              : [...prev.languagesSpoken, lang]
                          }));
                        }}
                      >
                        {formData.languagesSpoken.includes(lang) && <Check className="w-3 h-3 mr-1" />}
                        {lang}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <Target className="w-4 h-4" /> Why are you signing up? (choose one or more)
                  </Label>
                  <div className="space-y-2">
                    {signupReasons.map((reason) => (
                      <div key={reason.id} className="flex items-start gap-2">
                        <Checkbox 
                          id={reason.id}
                          checked={formData.signupReasons.includes(reason.id)}
                          onCheckedChange={(checked) => handleReasonChange(reason.id, checked as boolean)}
                        />
                        <Label htmlFor={reason.id} className="text-sm leading-tight cursor-pointer">
                          {reason.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {showGFETerms && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="p-4 rounded-lg bg-primary/5 border border-primary/20"
                  >
                    <h4 className="font-semibold mb-2">GFE Terms & Conditions</h4>
                    <p className="text-sm text-muted-foreground mb-3">
                      As a Grassroots Financial Educator (GFE), you agree to promote financial literacy, 
                      share accurate investment information, and adhere to Investours' ethical guidelines.
                    </p>
                    <div className="flex items-start gap-2">
                      <Checkbox 
                        id="gfeTerms"
                        checked={formData.agreeGFETerms}
                        onCheckedChange={(checked) => setFormData({ ...formData, agreeGFETerms: checked as boolean })}
                      />
                      <Label htmlFor="gfeTerms" className="text-sm leading-tight cursor-pointer">
                        I agree to the GFE Terms & Conditions
                      </Label>
                    </div>
                  </motion.div>
                )}

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
                      Saving...
                    </span>
                  ) : (
                    "Complete Profile"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
      <Footer />
    </div>
  );
};

export default CompleteProfile;
