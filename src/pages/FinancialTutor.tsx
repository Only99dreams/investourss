import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, ArrowLeft, Loader2, LogIn, Sparkles, ArrowUp, RotateCcw, Award, Crown, Lock, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Footer } from "@/components/ui/Footer";
import investoursLogo from "@/assets/investours-logo.png";
import TutorPostSurvey from "@/components/TutorPostSurvey";
import FinancialTutorOnboarding from "@/components/onboarding/FinancialTutorOnboarding";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const vettingKeywords = [
  "scam", "fraud", "legitimate", "legit", "real", "fake", "trust", "safe to invest",
  "is this company", "should i invest", "check this", "verify", "analyze investment",
  "is it safe", "ponzi", "pyramid", "mlm", "returns guaranteed", "too good to be true",
  "red flags", "warning signs", "due diligence"
];

const isVettingQuery = (query: string): boolean => {
  const lowerQuery = query.toLowerCase();
  return vettingKeywords.some(keyword => lowerQuery.includes(keyword));
};

const beginnerLabels = [
  "What is budgeting?",
  "How do I save money?",
  "Emergency funds explained",
  "Needs vs wants",
  "How do banks work?",
  "What is compound interest?",
];

const intermediateLabels = [
  "What are stocks?",
  "How do ETFs work?",
  "How do credit scores work?",
  "Inflation explained",
  "Side hustles",
  "Investment risk",
];

const advancedLabels = [
  "Portfolio diversification",
  "Dividend investing",
  "Retirement planning",
  "Tax strategies",
  "Real estate investing",
  "Market cycles",
];

type UserLevel = "beginner" | "intermediate" | "advanced" | null;

const FinancialTutor = () => {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialPath = searchParams.get("path") || "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showVettingPrompt, setShowVettingPrompt] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user, profile, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?mode=login", { replace: true });
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [showPostSurvey, setShowPostSurvey] = useState(false);
  const [postSurveyDismissed, setPostSurveyDismissed] = useState(false);

  const [userLevel, setUserLevel] = useState<UserLevel>(null);
  const [userXp, setUserXp] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(!initialQuery && !initialPath && !localStorage.getItem("tutor_onboarding"));
  const logoImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { logoImageRef.current = img; };
    img.src = investoursLogo;
  }, []);

  useEffect(() => {
    const savedOnboarding = localStorage.getItem("tutor_onboarding");
    if (savedOnboarding) {
      const data = JSON.parse(savedOnboarding);
      setUserLevel(data.level);
    }
  }, []);

  useEffect(() => {
    if (initialQuery && messages.length === 0) {
      handleSend(initialQuery);
      setShowOnboarding(false);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (initialPath) {
      setShowOnboarding(false);
    }
  }, [initialPath]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadUserProgress = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("tutor_user_levels")
        .select("xp_total, level")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setUserXp(data.xp_total || 0);
        if (data.level) setUserLevel(data.level as UserLevel);
      }
    } catch (err) {
      console.error("Failed to load user progress:", err);
    }
  };

  useEffect(() => {
    loadUserProgress();
  }, [user?.id]);

  const findLessonByTitle = async (query: string): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from("tutor_lessons")
        .select("id, title")
        .ilike("title", `%${query.split(" ").slice(0, 3).join(" ")}%`)
        .limit(1)
        .maybeSingle();

      return data?.id || null;
    } catch {
      return null;
    }
  };

  const awardXP = async (lessonTitle: string) => {
    if (!user) return;

    try {
      const lessonId = await findLessonByTitle(lessonTitle) || crypto.randomUUID();

      const { error: progressError } = await supabase
        .from("tutor_user_progress")
        .upsert(
          {
            user_id: user.id,
            lesson_id: lessonId,
            completed: true,
            xp_earned: 10,
            completed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,lesson_id" }
        );

      if (progressError) console.error("tutor_user_progress upsert error:", progressError);

      const xpDelta = 10;
      setUserXp((prev) => {
        const newXp = prev + xpDelta;
        supabase
          .from("tutor_user_levels")
          .upsert(
            {
              user_id: user.id,
              xp_total: newXp,
              level: userLevel || "beginner",
              last_active_date: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          )
          .then(({ error }) => {
            if (error) console.error("tutor_user_levels upsert error:", error);
          });
        return newXp;
      });
    } catch (err) {
      console.error("Failed to award XP:", err);
    }
  };

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText) return;

    if (isVettingQuery(messageText)) {
      if (!user) {
        setShowVettingPrompt(true);
        setInput("");
        return;
      } else {
        navigate(`/vetting?q=${encodeURIComponent(messageText)}`);
        return;
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('financial-tutor', {
        body: {
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          userId: user?.id || null,
          userLevel: userLevel
        }
      });

      if (error) throw error;

      const assistantResponse = data.response || "I apologize, but I couldn't generate a response. Please try again.";

      const nextLessonPrompt = userLevel
        ? "\n\n---\n**Ready for a quick quiz?** Test your knowledge, then I'll suggest your next lesson!"
        : "";

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantResponse + nextLessonPrompt
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (user && !text?.includes("quiz")) {
        await awardXP(messageText);
      }

      if (!postSurveyDismissed) {
        setShowPostSurvey(true);
      }
    } catch (error) {
      console.error('Tutor error:', error);
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOnboardingComplete = (level: UserLevel) => {
    setUserLevel(level);
    setShowOnboarding(false);
  };

  const getSuggestedQuestions = () => {
    if (!userLevel) return beginnerLabels;
    if (userLevel === "beginner") return beginnerLabels;
    if (userLevel === "intermediate") return intermediateLabels;
    return advancedLabels;
  };

  const levelLabels: Record<string, string> = {
    beginner: "Financial Foundations",
    intermediate: "Wealth Builder",
    advanced: "Portfolio Mastery",
  };

  const nextLevel: Record<string, string | null> = {
    beginner: "intermediate",
    intermediate: "advanced",
    advanced: null,
  };

  const levelXPRequirements: Record<string, number> = {
    beginner: 100,
    intermediate: 250,
    advanced: 500,
  };

  const handleStageUpgrade = async (targetLevel: string) => {
    const currentLevel = userLevel;
    if (!currentLevel || targetLevel === currentLevel) return;

    // Check premium gating for intermediate and advanced
    if ((targetLevel === "intermediate" || targetLevel === "advanced") && profile?.user_tier === "free") {
      toast({
        title: "Premium Required",
        description: "Upgrade to a Premium plan to access Intermediate and Advanced stages.",
        variant: "destructive",
      });
      navigate("/subscribe");
      return;
    }

    // Check if current stage XP requirement met
    const requiredXP = levelXPRequirements[currentLevel] || 100;
    if (userXp < requiredXP) {
      toast({
        title: "Keep Learning!",
        description: `You need ${requiredXP} XP to advance. You currently have ${userXp} XP.`,
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("tutor_user_levels")
        .upsert({
          user_id: user!.id,
          level: targetLevel,
          xp_total: userXp,
          last_active_date: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (error) throw error;

      setUserLevel(targetLevel as UserLevel);
      toast({
        title: "Stage Upgraded!",
        description: `You've advanced to ${levelLabels[targetLevel]}!`,
      });
    } catch (err) {
      console.error("Stage upgrade failed:", err);
      toast({
        title: "Error",
        description: "Failed to upgrade stage. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleResetStage = async () => {
    if (!user || !userLevel) return;

    const confirmed = window.confirm(
      `Are you sure you want to reset your "${levelLabels[userLevel]}" stage? Your XP for this stage will be reset to 0 and you'll start over from Beginner.`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("tutor_user_levels")
        .upsert({
          user_id: user.id,
          level: "beginner",
          xp_total: 0,
          last_active_date: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (error) throw error;

      // Also clear progress for lessons in this stage
      await supabase
        .from("tutor_user_progress")
        .delete()
        .eq("user_id", user.id);

      setUserLevel("beginner");
      setUserXp(0);
      toast({
        title: "Stage Reset",
        description: "Your progress has been reset. You're now back at Beginner stage.",
      });
    } catch (err) {
      console.error("Stage reset failed:", err);
      toast({
        title: "Error",
        description: "Failed to reset stage. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadCertificate = () => {
    if (!user || !userLevel) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1000, 720);

    // Outer border - thick purple
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 8;
    ctx.strokeRect(30, 30, 940, 660);

    // Inner border - thin purple
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(50, 50, 900, 620);

    // Corner ornaments
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 2;
    const corners = [
      [50, 50], [950, 50], [950, 670], [50, 670]
    ];
    corners.forEach(([x, y], i) => {
      ctx.beginPath();
      if (i === 0) { ctx.moveTo(x + 20, y); ctx.lineTo(x + 20, y + 20); ctx.lineTo(x, y + 20); }
      if (i === 1) { ctx.moveTo(x - 20, y); ctx.lineTo(x - 20, y + 20); ctx.lineTo(x, y + 20); }
      if (i === 2) { ctx.moveTo(x, y - 20); ctx.lineTo(x - 20, y - 20); ctx.lineTo(x - 20, y); }
      if (i === 3) { ctx.moveTo(x + 20, y); ctx.lineTo(x + 20, y - 20); ctx.lineTo(x, y - 20); }
      ctx.stroke();
    });

    // Logo
    if (logoImageRef.current) {
      ctx.drawImage(logoImageRef.current, 410, 68, 180, 55);
    }

    // Top decorative separator
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(250, 150);
    ctx.lineTo(750, 150);
    ctx.stroke();

    // Certificate title
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "bold 52px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.fillText("Certificate of Completion", 500, 215);

    // Decorative diamond separator
    ctx.fillStyle = "#7c3aed";
    ctx.beginPath();
    ctx.moveTo(500, 232);
    ctx.lineTo(508, 240);
    ctx.lineTo(500, 248);
    ctx.lineTo(492, 240);
    ctx.closePath();
    ctx.fill();

    // Subtitle
    ctx.fillStyle = "#555555";
    ctx.font = "20px Georgia, 'Times New Roman', serif";
    ctx.fillText("This certifies that", 500, 290);

    // User name
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "bold 40px Georgia, 'Times New Roman', serif";
    ctx.fillText(profile?.full_name || "User", 500, 350);

    // Completion text
    ctx.fillStyle = "#555555";
    ctx.font = "18px Georgia, 'Times New Roman', serif";
    ctx.fillText("has successfully completed the", 500, 400);

    // Stage name
    ctx.fillStyle = "#7c3aed";
    ctx.font = "bold 32px Georgia, 'Times New Roman', serif";
    ctx.fillText(`${levelLabels[userLevel]} Stage`, 500, 455);

    // XP and date
    ctx.fillStyle = "#888888";
    ctx.font = "15px Arial, sans-serif";
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    ctx.fillText(`Total XP Earned: ${userXp}  |  Issued: ${date}`, 500, 505);

    // Bottom decorative separator
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(300, 550);
    ctx.lineTo(700, 550);
    ctx.stroke();

    // Signature line
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(360, 600);
    ctx.lineTo(640, 600);
    ctx.stroke();

    // Signature name
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "italic 24px Georgia, 'Times New Roman', serif";
    ctx.fillText("Olusegun Emmanuel", 500, 593);

    // Title
    ctx.fillStyle = "#888888";
    ctx.font = "13px Arial, sans-serif";
    ctx.fillText("Founder & CEO, Investours", 500, 630);

    // Certificate ID
    const certId = `INV-${userLevel.toUpperCase().slice(0, 4)}-${Date.now().toString(36).toUpperCase()}`;
    ctx.fillStyle = "#aaaaaa";
    ctx.font = "10px Arial, sans-serif";
    ctx.fillText(`Certificate ID: ${certId}`, 500, 670);

    // Download
    const link = document.createElement("a");
    link.download = `Investours-${levelLabels[userLevel]}-Certificate.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    // Save certificate record to database
    supabase.from("user_certificates").insert({
      user_id: user.id,
      level: userLevel,
      level_label: levelLabels[userLevel],
      xp_earned: userXp,
      certificate_id: certId,
      issued_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) {
        console.error("Failed to save certificate record:", error);
      }
    });

    toast({
      title: "Certificate Downloaded!",
      description: `Your ${levelLabels[userLevel]} certificate has been downloaded.`,
    });
  };

  if (showOnboarding) {
    return <FinancialTutorOnboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/home"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="flex items-center gap-2">
              <img src={investoursLogo} alt="Investours" className="w-8 h-8" />
              <div>
                <h1 className="font-semibold text-foreground text-sm sm:text-base">AI Financial Tutor</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  {userLevel ? levelLabels[userLevel] : "Your personal finance educator"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/vetting">
              <Button variant="outline" size="sm">
                AI Vetting
              </Button>
            </Link>
            {!user && (
              <Link to="/auth?mode=login">
                <Button variant="outline" size="sm">
                  <LogIn className="w-4 h-4 mr-2" />
                  Login
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        <ScrollArea ref={scrollRef} className="flex-1 p-4">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-4"
            >
              {/* Progress Section */}
              {userLevel && (
                <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl p-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-foreground">Your Learning Path</h3>
                      <p className="text-xs text-muted-foreground">{levelLabels[userLevel]}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-primary font-bold text-sm">{userXp} XP</div>
                    </div>
                  </div>
                  <div className="w-full bg-border rounded-full h-2 mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all"
                      style={{ width: `${Math.min((userXp / 100) * 100, 100)}%` }}
                    />
                  </div>
                  {/* Stage Progression Buttons */}
                  <div className="flex flex-wrap gap-2">
                    {/* Beginner Stage */}
                    <div className="flex items-center gap-1 text-xs bg-background/50 rounded-full px-3 py-1">
                      {userLevel === "beginner" ? (
                        <Sparkles className="w-3 h-3 text-primary" />
                      ) : (
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                      )}
                      <span>Beginner</span>
                    </div>
                    <span className="text-muted-foreground text-xs self-center">→</span>
                    {/* Intermediate Stage */}
                    <button
                      onClick={() => handleStageUpgrade("intermediate")}
                      disabled={userLevel === "intermediate" || userLevel === "advanced" || profile?.user_tier === "free"}
                      className={`flex items-center gap-1 text-xs rounded-full px-3 py-1 transition-colors ${
                        userLevel === "intermediate" || userLevel === "advanced"
                          ? "bg-emerald-500/20 text-emerald-600 cursor-default"
                          : profile?.user_tier === "free"
                          ? "bg-background/50 text-muted-foreground cursor-not-allowed opacity-60"
                          : "bg-background/50 hover:bg-primary/20 text-muted-foreground hover:text-primary cursor-pointer"
                      }`}
                      title={profile?.user_tier === "free" ? "Premium required" : "Upgrade to Intermediate"}
                    >
                      {userLevel === "intermediate" || userLevel === "advanced" ? (
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                      ) : profile?.user_tier === "free" ? (
                        <Lock className="w-3 h-3" />
                      ) : (
                        <ArrowUp className="w-3 h-3" />
                      )}
                      <span>Intermediate</span>
                      {profile?.user_tier === "free" && <Crown className="w-3 h-3 text-amber-500" />}
                    </button>
                    <span className="text-muted-foreground text-xs self-center">→</span>
                    {/* Advanced Stage */}
                    <button
                      onClick={() => handleStageUpgrade("advanced")}
                      disabled={userLevel === "advanced" || profile?.user_tier === "free"}
                      className={`flex items-center gap-1 text-xs rounded-full px-3 py-1 transition-colors ${
                        userLevel === "advanced"
                          ? "bg-emerald-500/20 text-emerald-600 cursor-default"
                          : profile?.user_tier === "free"
                          ? "bg-background/50 text-muted-foreground cursor-not-allowed opacity-60"
                          : "bg-background/50 hover:bg-primary/20 text-muted-foreground hover:text-primary cursor-pointer"
                      }`}
                      title={profile?.user_tier === "free" ? "Premium required" : "Upgrade to Advanced"}
                    >
                      {userLevel === "advanced" ? (
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                      ) : profile?.user_tier === "free" ? (
                        <Lock className="w-3 h-3" />
                      ) : (
                        <ArrowUp className="w-3 h-3" />
                      )}
                      <span>Advanced</span>
                      {profile?.user_tier === "free" && <Crown className="w-3 h-3 text-amber-500" />}
                    </button>
                    {/* Reset Stage */}
                    <button
                      onClick={handleResetStage}
                      className="flex items-center gap-1 text-xs bg-background/50 rounded-full px-3 py-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
                      title="Reset stage and start over"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>
                  {/* Certificate Button */}
                  <button
                    onClick={handleDownloadCertificate}
                    className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    title="Download stage certificate"
                  >
                    <Award className="w-3 h-3" />
                    <span>Download {levelLabels[userLevel]} Certificate</span>
                  </button>
                </div>
              )}

              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
                Welcome to AI Financial Tutor
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto text-center">
                Ask me anything about personal finance, investing basics, budgeting, and more!
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {getSuggestedQuestions().map((question, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="text-left justify-start h-auto py-3 px-4"
                    onClick={() => handleSend(question)}
                  >
                    <span className="line-clamp-2 text-sm">{question}</span>
                  </Button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-4 pb-4">
              <AnimatePresence mode="popLayout">
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <Card className={`max-w-[80%] p-4 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-card"}`}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </Card>
                    {message.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-accent" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <Card className="p-4 bg-card">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </Card>
                </motion.div>
              )}

              {showPostSurvey && !isLoading && (
                <TutorPostSurvey
                  sessionId={sessionId}
                  userId={user?.id}
                  onDismiss={() => {
                    setShowPostSurvey(false);
                    setPostSurveyDismissed(true);
                  }}
                />
              )}
            </div>
          )}
        </ScrollArea>

        {/* Vetting Prompt Modal */}
        <AnimatePresence>
          {showVettingPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowVettingPrompt(false)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Card className="p-6 max-w-md">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                      <LogIn className="w-8 h-8 text-accent" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">Login Required</h3>
                    <p className="text-muted-foreground mb-6">
                      To analyze investments and check for scams, please login to access our AI Vetting tool.
                    </p>
                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" onClick={() => setShowVettingPrompt(false)}>
                        Cancel
                      </Button>
                      <Link to="/auth?mode=login">
                        <Button variant="default">
                          Login Now
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Area */}
        <div className="border-t border-border p-4 bg-card/50 backdrop-blur-sm">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about personal finance, budgeting, investing basics..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              size="icon"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            For investment analysis & scam detection, use our{" "}
            <Link to="/vetting" className="text-primary hover:underline">AI Vetting tool</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default FinancialTutor;