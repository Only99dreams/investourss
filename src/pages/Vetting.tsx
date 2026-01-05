import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Shield, HelpCircle, ArrowRight, AlertTriangle, CheckCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import Header from "@/components/Header";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Footer } from "@/components/ui/Footer";

interface QuickSearchResult {
  riskLevel: "safe" | "warning" | "danger";
  summary: string;
  keyFindings: string[];
  recommendation: string;
}

interface DeepAnalysisResult {
  riskScore: number;
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  summary: string;
  companyAnalysis: string;
  redFlags: string[];
  greenFlags: string[];
  regulatoryStatus: string;
  similarScams: string[];
  recommendations: string[];
  confidence: "low" | "medium" | "high";
}

const Vetting = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [analyzeQuery, setAnalyzeQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [quickResult, setQuickResult] = useState<QuickSearchResult | null>(null);
  const [deepResult, setDeepResult] = useState<DeepAnalysisResult | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleQuickSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setQuickResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('scam-detection', {
        body: { 
          query: searchQuery, 
          analysisType: 'quick',
          userId: user?.id || null
        }
      });

      if (error) throw error;

      if (data.success && data.analysis) {
        setQuickResult(data.analysis);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Search error:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeepAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!analyzeQuery.trim()) return;

    if (!user) {
      toast({
        title: "Login Required",
        description: "Please login to use deep analysis.",
      });
      navigate('/auth?mode=login');
      return;
    }

    setIsAnalyzing(true);
    setDeepResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('scam-detection', {
        body: { 
          query: analyzeQuery, 
          analysisType: 'deep',
          userId: user.id
        }
      });

      if (error) throw error;

      if (data.success && data.analysis) {
        setDeepResult(data.analysis);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSupport = () => {
    toast({
      title: "Premium Feature",
      description: "Upgrade to Premium to access personalized support.",
    });
  };

  const getRiskColor = (level: string) => {
    const colors: Record<string, string> = {
      safe: "bg-accent/10 border-accent/30 text-accent",
      low: "bg-accent/10 border-accent/30 text-accent",
      warning: "bg-investours-gold/10 border-investours-gold/30 text-investours-gold",
      medium: "bg-investours-gold/10 border-investours-gold/30 text-investours-gold",
      danger: "bg-destructive/10 border-destructive/30 text-destructive",
      high: "bg-destructive/10 border-destructive/30 text-destructive",
      critical: "bg-destructive/10 border-destructive/30 text-destructive",
    };
    return colors[level] || colors.warning;
  };

  const getRiskIcon = (level: string) => {
    if (level === "safe" || level === "low") return <CheckCircle className="w-5 h-5 text-accent" />;
    if (level === "warning" || level === "medium") return <Info className="w-5 h-5 text-investours-gold" />;
    return <AlertTriangle className="w-5 h-5 text-destructive" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 md:pt-32 pb-16">
        <div className="container mx-auto px-4">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-2xl mx-auto mb-12"
          >
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-6">
              <Shield className="w-8 h-8 text-accent" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              AI-Powered Scam Detector
            </h1>
            <p className="text-lg text-muted-foreground">
              Identify potential scam risks in investment and financial offers using our AI-powered tools. Log in to start checking offers.
            </p>
          </motion.div>

          {/* Vetting Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-3xl mx-auto"
          >
            <Tabs defaultValue="search" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-8">
                <TabsTrigger value="search" className="flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Search
                </TabsTrigger>
                <TabsTrigger value="analyze" className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Analyze
                </TabsTrigger>
                <TabsTrigger value="support" className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Support
                </TabsTrigger>
              </TabsList>

              <TabsContent value="search">
                <Card variant="elevated">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Search className="w-5 h-5 text-accent" />
                      Quick Search
                    </CardTitle>
                    <CardDescription>
                      Search any investment, company, or opportunity. No login required.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleQuickSearch} className="space-y-4">
                      <div className="relative">
                        <Input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Enter company name, investment scheme, or website URL..."
                          className="pr-12 h-12 text-base"
                          disabled={isSearching}
                        />
                        <Button 
                          type="submit" 
                          size="icon"
                          variant="ghost"
                          className="absolute right-1 top-1/2 -translate-y-1/2"
                          disabled={isSearching || !searchQuery.trim()}
                        >
                          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                        </Button>
                      </div>

                      {isSearching && (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-8 h-8 animate-spin text-accent" />
                          <span className="ml-3 text-muted-foreground">Analyzing with AI...</span>
                        </div>
                      )}

                      {quickResult && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`p-4 rounded-xl border ${getRiskColor(quickResult.riskLevel)}`}
                        >
                          <div className="flex items-start gap-3 mb-4">
                            {getRiskIcon(quickResult.riskLevel)}
                            <div>
                              <p className="font-medium text-foreground mb-1 capitalize">
                                {quickResult.riskLevel === "safe" && "Appears Legitimate"}
                                {quickResult.riskLevel === "warning" && "Proceed with Caution"}
                                {quickResult.riskLevel === "danger" && "Potential Scam Detected"}
                              </p>
                              <p className="text-sm text-muted-foreground">{quickResult.summary}</p>
                            </div>
                          </div>
                          
                          {quickResult.keyFindings?.length > 0 && (
                            <div className="mb-4">
                              <p className="text-sm font-medium text-foreground mb-2">Key Findings:</p>
                              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                {quickResult.keyFindings.map((finding, i) => (
                                  <li key={i}>{finding}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          <p className="text-sm text-foreground font-medium">
                            💡 {quickResult.recommendation}
                          </p>
                        </motion.div>
                      )}
                    </form>

                    <div className="mt-6 pt-6 border-t border-border">
                   <p className="text-sm text-muted-foreground text-center">
                       ⚠️ Warning: A low-risk result does not guarantee safety. Always verify official sources and regulatory status.
                      </p> 
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="analyze">
                <Card variant="elevated">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      Deep Analysis
                    </CardTitle>
                    <CardDescription>
                      Get comprehensive AI analysis of any investment opportunity.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!user ? (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                          <Shield className="w-8 h-8 text-primary" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground mb-2">Login Required</h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                          To analyze investments in depth, please login to your account.
                        </p>
                        <Button onClick={() => navigate('/auth?mode=login')} variant="default">
                          Login to Analyze
                          <ArrowRight className="ml-2 w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleDeepAnalysis} className="space-y-4">
                        <div className="relative">
                          <Input
                            value={analyzeQuery}
                            onChange={(e) => setAnalyzeQuery(e.target.value)}
                            placeholder="Enter company name, investment scheme, or website URL..."
                            className="pr-12 h-12 text-base"
                            disabled={isAnalyzing}
                          />
                          <Button 
                            type="submit" 
                            size="icon"
                            variant="ghost"
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                            disabled={isAnalyzing || !analyzeQuery.trim()}
                          >
                            {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                          </Button>
                        </div>

                        {isAnalyzing && (
                          <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                            <span className="text-muted-foreground">Performing deep AI analysis...</span>
                            <span className="text-sm text-muted-foreground/70">This may take a moment</span>
                          </div>
                        )}

                        {deepResult && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4"
                          >
                            {/* Risk Score Header */}
                            <div className={`p-6 rounded-xl border ${getRiskColor(deepResult.riskLevel)}`}>
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  {getRiskIcon(deepResult.riskLevel)}
                                  <div>
                                    <p className="font-semibold text-foreground text-lg capitalize">
                                      Risk Level: {deepResult.riskLevel}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      Confidence: {deepResult.confidence}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-3xl font-bold text-foreground">{deepResult.riskScore}</div>
                                  <div className="text-sm text-muted-foreground">Risk Score</div>
                                </div>
                              </div>
                              <Progress value={deepResult.riskScore} className="h-2" />
                              <p className="mt-4 text-sm text-foreground">{deepResult.summary}</p>
                            </div>

                            {/* Company Analysis */}
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base">Company Analysis</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm text-muted-foreground">{deepResult.companyAnalysis}</p>
                              </CardContent>
                            </Card>

                            {/* Red Flags & Green Flags */}
                            <div className="grid md:grid-cols-2 gap-4">
                              {deepResult.redFlags?.length > 0 && (
                                <Card className="border-destructive/30">
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base text-destructive flex items-center gap-2">
                                      <AlertTriangle className="w-4 h-4" /> Red Flags
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                      {deepResult.redFlags.map((flag, i) => (
                                        <li key={i}>{flag}</li>
                                      ))}
                                    </ul>
                                  </CardContent>
                                </Card>
                              )}
                              {deepResult.greenFlags?.length > 0 && (
                                <Card className="border-accent/30">
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base text-accent flex items-center gap-2">
                                      <CheckCircle className="w-4 h-4" /> Green Flags
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent>
                                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                      {deepResult.greenFlags.map((flag, i) => (
                                        <li key={i}>{flag}</li>
                                      ))}
                                    </ul>
                                  </CardContent>
                                </Card>
                              )}
                            </div>

                            {/* Regulatory Status */}
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base">Regulatory Status</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm text-muted-foreground">{deepResult.regulatoryStatus}</p>
                              </CardContent>
                            </Card>

                            {/* Recommendations */}
                          {/*  {deepResult.recommendations?.length > 0 && (
                              <Card className="border-primary/30">
                                <CardHeader className="pb-2">
                                  <CardTitle className="text-base text-primary">Recommendations</CardTitle>
                                </CardHeader>
                               <CardContent>
                                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                    {deepResult.recommendations.map((rec, i) => (
                                      <li key={i}>{rec}</li>
                                    ))}
                                  </ul>
                                </CardContent> 
                              </Card>
                            )}   */}
                          </motion.div>
                        )}
                      </form>
                      
                    )}
                     <div className="mt-6 pt-6 border-t border-border">
                   <p className="text-sm text-muted-foreground text-center">
                       ⚠️ Warning: A low-risk result does not guarantee safety. Always verify official sources and regulatory status.
                      </p> 
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="support">
                <Card variant="elevated">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-investours-gold" />
                      Personal Support
                    </CardTitle>
                    <CardDescription>
                     One-on-one help with learning, tools, and risk awareness.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-investours-gold/10 flex items-center justify-center mx-auto mb-4">
                      <HelpCircle className="w-8 h-8 text-investours-gold" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">Premium Feature</h3>
                    <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                      Upgrade to Premium for enhanced guidance on using our AI tools, deeper learning resources, and advanced risk-awareness insights.
                    </p>
                    <Button onClick={handleSupport} variant="default">
                      Upgrade to Premium
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>

          {/* Info Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto"
          >
            <Card variant="accent" className="text-center">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-primary mb-1">₦1T+</div>
                <p className="text-sm text-muted-foreground">Nigerian victims in recent years</p>
              </CardContent>
            </Card>
            <Card variant="accent" className="text-center">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-destructive mb-1">$16B+</div>
                <p className="text-sm text-muted-foreground">Reported scam losses in the U.S. (2024)</p>
              </CardContent>
            </Card>
            <Card variant="accent" className="text-center">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-accent mb-1">Billions</div>
                <p className="text-sm text-muted-foreground">Global annual losses to financial fraud</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Vetting;
