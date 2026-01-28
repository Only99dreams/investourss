import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User, Mail, Phone, MapPin, Calendar, Briefcase, 
  Copy, Check, Edit2, Save, Globe, Shield, X
} from "lucide-react";
import { cn } from "@/lib/utils";

export function ProfileSection() {
  const { profile, refreshProfile, user } = useAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState({
    full_name: "",
    phone: "",
    country: "",
    preferred_language: "",
    occupation: "",
    sector: "",
    institution: "",
    gender: "",
    residential_address: "",
    date_of_birth: ""
  });

  useEffect(() => {
    if (profile && !isEditing) {
      setEditData({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
        country: profile.country || "",
        preferred_language: profile.preferred_language || "en",
        occupation: profile.occupation || "",
        sector: profile.sector || "",
        institution: profile.institution || "",
        gender: profile.gender || "",
        residential_address: profile.residential_address || "",
        date_of_birth: profile.date_of_birth || ""
      });
    }
  }, [profile, isEditing]);

  const copyReferralLink = () => {
    const link = `${window.location.origin}/signup/individual?ref=${profile?.referral_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!user) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editData.full_name,
          phone: editData.phone,
          country: editData.country,
          preferred_language: editData.preferred_language,
          occupation: editData.occupation,
          sector: editData.sector,
          institution: editData.institution,
          gender: editData.gender || null,
          residential_address: editData.residential_address,
          date_of_birth: editData.date_of_birth || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) throw error;

      await refreshProfile();
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been updated successfully.",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const tierColors = {
    free: "bg-muted text-muted-foreground",
    premium: "bg-gold/20 text-gold border-gold/30",
    exclusive: "bg-primary/20 text-primary border-primary/30"
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Profile Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-3xl font-bold">
                {profile?.full_name?.charAt(0) || "U"}
              </div>
              
              <div className="flex-1">
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <Label>Full Name</Label>
                      <Input
                        value={editData.full_name}
                        onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                        placeholder="Enter your full name"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setIsEditing(false)}
                        disabled={isSaving}
                      >
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                      </Button>
                      <Button 
                        variant="default" 
                        size="sm" 
                        onClick={handleSave}
                        disabled={isSaving}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {isSaving ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold">{profile?.full_name || "User"}</h2>
                      <Badge className={cn("capitalize", tierColors[profile?.user_tier || "free"])}>
                        {profile?.user_tier || "Free"} Tier
                      </Badge>
                      {profile?.is_gfe && (
                        <Badge variant="outline" className="border-accent text-accent">
                          GFE
                        </Badge>
                      )}
                    </div>
                    
                    <p className="text-muted-foreground mb-4">
                      {profile?.occupation || "Member"} • Joined {new Date(profile?.created_at || Date.now()).toLocaleDateString()}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={copyReferralLink}>
                        {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        {profile?.referral_code || "REF CODE"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit Profile
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="text-right">
                <p className="text-sm text-muted-foreground">Assigned as</p>
                <p className="font-medium">{profile?.assigned_role || "Member"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* GFE Section - Moved to top */}
      {!profile?.is_gfe && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Become a Grassroots Financial Educator (GFE)</h3>
                  <p className="text-muted-foreground mb-2">
                    Earn commissions by educating your community about financial literacy and investments.
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Share education videos and earn from referrals</li>
                    <li>• Access exclusive BDE content (Annual Premium required)</li>
                    <li>• Lower withdrawal fees on earnings</li>
                  </ul>
                </div>
                <Button variant="hero" size="lg">Become a GFE</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Contact Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-primary" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Email</p>
                  {isEditing ? (
                    <Input
                      value={profile?.email || ""}
                      disabled
                      className="mt-1"
                    />
                  ) : (
                    <p className="font-medium">{profile?.email || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Phone</Label>
                  {isEditing ? (
                    <Input
                      value={editData.phone}
                      onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                      placeholder="+234..."
                      className="mt-1"
                    />
                  ) : (
                    <p className="font-medium">{profile?.phone || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Country</Label>
                  {isEditing ? (
                    <Select value={editData.country} onValueChange={(v) => setEditData({ ...editData, country: v })}>
                      <SelectTrigger className="mt-1">
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
                  ) : (
                    <p className="font-medium">{profile?.country || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Preferred Language</Label>
                  {isEditing ? (
                    <Select value={editData.preferred_language} onValueChange={(v) => setEditData({ ...editData, preferred_language: v })}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                        <SelectItem value="sw">Swahili</SelectItem>
                        <SelectItem value="yo">Yoruba</SelectItem>
                        <SelectItem value="ig">Igbo</SelectItem>
                        <SelectItem value="ha">Hausa</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium">{profile?.preferred_language || "English"}</p>
                  )}
                </div>
              </div>
              {isEditing && (
                <>
                  <Separator />
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-2" />
                    <div className="flex-1">
                      <Label className="text-sm text-muted-foreground">Residential Address</Label>
                      <Textarea
                        value={editData.residential_address}
                        onChange={(e) => setEditData({ ...editData, residential_address: e.target.value })}
                        placeholder="Enter your address"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Professional Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                Professional Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Briefcase className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Occupation</Label>
                  {isEditing ? (
                    <Input
                      value={editData.occupation}
                      onChange={(e) => setEditData({ ...editData, occupation: e.target.value })}
                      placeholder="e.g. Engineer, Teacher"
                      className="mt-1"
                    />
                  ) : (
                    <p className="font-medium">{profile?.occupation || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Sector</Label>
                  {isEditing ? (
                    <Input
                      value={editData.sector}
                      onChange={(e) => setEditData({ ...editData, sector: e.target.value })}
                      placeholder="e.g. Technology, Finance"
                      className="mt-1"
                    />
                  ) : (
                    <p className="font-medium">{profile?.sector || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Institution</Label>
                  {isEditing ? (
                    <Input
                      value={editData.institution}
                      onChange={(e) => setEditData({ ...editData, institution: e.target.value })}
                      placeholder="Company or organization"
                      className="mt-1"
                    />
                  ) : (
                    <p className="font-medium">{profile?.institution || "Not set"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground">Gender</Label>
                  {isEditing ? (
                    <Select value={editData.gender} onValueChange={(v) => setEditData({ ...editData, gender: v })}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                        <SelectItem value="prefer-not">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium capitalize">{profile?.gender || "Not set"}</p>
                  )}
                </div>
              </div>
              {isEditing && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <div className="flex-1">
                      <Label className="text-sm text-muted-foreground">Date of Birth</Label>
                      <Input
                        type="date"
                        value={editData.date_of_birth}
                        onChange={(e) => setEditData({ ...editData, date_of_birth: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
