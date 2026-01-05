import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GraduationCap, Play, CheckCircle, Lock, Clock, Trophy, Share2, Copy, Twitter, Facebook, Linkedin, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

interface Module {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  video_url: string | null;
  category: string | null;
  tier_required: string;
}

interface UserProgress {
  user_id: string;
  module_id: string;
  completed: boolean;
  completed_at?: string;
}

export function EducationSection() {
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const [modules, setModules] = useState<Module[]>([]);
  const [progress, setProgress] = useState<UserProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    if (isVideoOpen) {
      setShowDetails(false);
    }
  }, [isVideoOpen]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: modulesData } = await supabase
        .from("education_modules")
        .select("*")
        .eq("is_published", true)
        .order("order_index");

      setModules(modulesData || []);

      if (user) {
        const { data: progressData } = await supabase
          .from("user_progress")
          .select("*")
          .eq("user_id", user.id);

        setProgress(progressData || []);
      }
      setIsLoading(false);

      // Handle deep link to specific module
      const moduleId = searchParams.get("module");
      if (moduleId && modulesData) {
        const targetModule = modulesData.find(m => m.id === moduleId);
        if (targetModule) {
          setSelectedModule(targetModule);
          setIsVideoOpen(true);
        }
      }
    };

    fetchData();
  }, [user, searchParams]);

  const completedCount = progress.filter(p => p.completed).length;
  const totalModules = modules.length;
  const progressPercent = totalModules > 0 ? (completedCount / totalModules) * 100 : 0;

  const isModuleLocked = (tierRequired: string) => {
    const tierOrder = ["free", "premium", "exclusive"];
    const userTierIndex = tierOrder.indexOf(profile?.user_tier || "free");
    const requiredIndex = tierOrder.indexOf(tierRequired);
    return requiredIndex > userTierIndex;
  };

  const getModuleProgress = (moduleId: string) => {
    return progress.find(p => p.module_id === moduleId);
  };

  const getEmbedUrl = (url: string) => {
    if (url.includes("youtube.com/watch")) {
      const videoId = url.split("v=")[1]?.split("&")[0];
      return `https://www.youtube.com/embed/${videoId}?rel=0&controls=1`;
    }
    if (url.includes("youtu.be/")) {
      const videoId = url.split("youtu.be/")[1]?.split("?")[0];
      return `https://www.youtube.com/embed/${videoId}?rel=0&controls=1`;
    }
    if (url.includes("vimeo.com/")) {
      const videoId = url.split("vimeo.com/")[1]?.split("?")[0];
      return `https://player.vimeo.com/video/${videoId}?dnt=1`;
    }
    return url;
  };

  const generateShareUrl = (moduleId: string) => {
    const referralCode = profile?.referral_code || "";
    return `${window.location.origin}/dashboard/education?module=${moduleId}${referralCode ? `&ref=${referralCode}` : ""}`;
  };

  const handleShare = async (module: Module, platform: "copy" | "twitter" | "facebook" | "linkedin") => {
    const shareUrl = generateShareUrl(module.id);
    const shareText = `Check out this learning module: "${module.title}" on Investours!`;

    switch (platform) {
      case "copy":
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied with your referral code!");
        break;
      case "twitter":
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank");
        break;
      case "facebook":
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`, "_blank");
        break;
      case "linkedin":
        window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, "_blank");
        break;
    }
  };

  const handleStartModule = async (module: Module) => {
    if (isModuleLocked(module.tier_required)) {
      toast.error("Upgrade your tier to access this module");
      return;
    }

    setSelectedModule(module);
    setIsVideoOpen(true);

    if (user) {
      const existingProgress = getModuleProgress(module.id);
      if (!existingProgress) {
        await supabase.from("user_progress").insert({
          user_id: user.id,
          module_id: module.id,
          completed: false,
        });
      }
    }
  };

  const handleCompleteModule = async () => {
    if (!user || !selectedModule) return;

    const { error } = await supabase
      .from("user_progress")
      .upsert({
        user_id: user.id,
        module_id: selectedModule.id,
        completed: true,
        completed_at: new Date().toISOString(),
      }, { onConflict: "user_id,module_id" });

    if (!error) {
      toast.success("Module completed!");
      const { data } = await supabase
        .from("user_progress")
        .select("*")
        .eq("user_id", user.id);
      setProgress(data || []);
    }
    setIsVideoOpen(false);
    setSelectedModule(null);
  };

  const inProgressModules = modules.filter(m => {
    const prog = getModuleProgress(m.id);
    return prog && !prog.completed;
  });

  const completedModules = modules.filter(m => {
    const prog = getModuleProgress(m.id);
    return prog?.completed;
  });

  const ShareButton = ({ module }: { module: Module }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
          <Share2 className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => handleShare(module, "copy")}>
          <Copy className="w-4 h-4 mr-2" />
          Copy Link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleShare(module, "twitter")}>
          <Twitter className="w-4 h-4 mr-2" />
          Share on X
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleShare(module, "facebook")}>
          <Facebook className="w-4 h-4 mr-2" />
          Share on Facebook
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleShare(module, "linkedin")}>
          <Linkedin className="w-4 h-4 mr-2" />
          Share on LinkedIn
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderModuleCard = (module: Module, index: number) => {
    const locked = isModuleLocked(module.tier_required);
    const moduleProgress = getModuleProgress(module.id);
    const completed = moduleProgress?.completed;

    return (
      <motion.div
        key={module.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05 }}
      >
        <Card className={cn(
          "h-full transition-all hover:shadow-lg cursor-pointer",
          locked && "opacity-60",
          completed && "border-emerald-500/50"
        )}
        onClick={() => handleStartModule(module)}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <Badge variant={
                module.tier_required === "exclusive" ? "default" :
                module.tier_required === "premium" ? "secondary" :
                "outline"
              }>
                {module.tier_required.toUpperCase()}
              </Badge>
              <div className="flex items-center gap-1">
                {!locked && <ShareButton module={module} />}
                {completed && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                {locked && <Lock className="w-5 h-5 text-muted-foreground" />}
              </div>
            </div>
            <CardTitle className="text-base mt-2">{module.title}</CardTitle>
            <CardDescription className="line-clamp-2">
              {module.description || "No description available"}
            </CardDescription>
            {module.category && (
              <Badge variant="outline" className="mt-2 text-xs">
                {module.category}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {module.video_url && <Play className="w-4 h-4 text-primary" />}
                <Clock className="w-4 h-4" />
                <span>~10 min</span>
              </div>
              <Button 
                size="sm" 
                variant={completed ? "outline" : "default"}
                disabled={locked}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartModule(module);
                }}
              >
                {locked ? "Locked" : completed ? "Review" : "Start"}
                {!locked && !completed && <Play className="w-3 h-3 ml-1" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Progress Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Your Learning Progress</h3>
                  <p className="text-muted-foreground">
                    {completedCount} of {totalModules} modules completed
                  </p>
                </div>
              </div>
              <div className="flex-1 max-w-md">
                <div className="flex justify-between text-sm mb-2">
                  <span>{Math.round(progressPercent)}% Complete</span>
                  <span>{completedCount}/{totalModules}</span>
                </div>
                <Progress value={progressPercent} className="h-3" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Module Tabs */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Modules ({modules.length})</TabsTrigger>
          <TabsTrigger value="in-progress">In Progress ({inProgressModules.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedModules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          {modules.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {modules.map((module, index) => renderModuleCard(module, index))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <GraduationCap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Modules Available Yet</h3>
                <p className="text-muted-foreground">
                  Check back soon for new learning content!
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="in-progress" className="mt-6">
          {inProgressModules.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inProgressModules.map((module, index) => renderModuleCard(module, index))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                No modules in progress
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {completedModules.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {completedModules.map((module, index) => renderModuleCard(module, index))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <Trophy className="w-12 h-12 mx-auto mb-4 opacity-50" />
                Complete modules to see them here
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Video Dialog */}
      <Dialog open={isVideoOpen} onOpenChange={setIsVideoOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedModule?.video_url && (
            <div className="aspect-video w-full rounded-lg overflow-hidden bg-black mb-12">
              <iframe
                src={getEmbedUrl(selectedModule.video_url)}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {showDetails && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedModule?.title}</DialogTitle>
              </DialogHeader>

              {selectedModule?.description && (
                <div className="mt-4">
                  <h4 className="font-semibold mb-2">Description</h4>
                  <p className="text-muted-foreground">{selectedModule.description}</p>
                </div>
              )}

              {selectedModule?.content && (
                <div className="mt-4">
                  <h4 className="font-semibold mb-2">Notes</h4>
                  <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                    {selectedModule.content}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-10 flex flex-wrap justify-end gap-2">
            <Button 
              variant="ghost" 
              onClick={() => setShowDetails(!showDetails)}
              className="mr-auto text-muted-foreground"
            >
              {showDetails ? "Hide Details" : "Show Details"}
            </Button>
            {selectedModule && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "copy")}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "twitter")}>
                    <Twitter className="w-4 h-4 mr-2" />
                    Share on X
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "facebook")}>
                    <Facebook className="w-4 h-4 mr-2" />
                    Share on Facebook
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "linkedin")}>
                    <Linkedin className="w-4 h-4 mr-2" />
                    Share on LinkedIn
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" onClick={() => setIsVideoOpen(false)}>
              Close
            </Button>
            <Button onClick={handleCompleteModule}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark as Complete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
