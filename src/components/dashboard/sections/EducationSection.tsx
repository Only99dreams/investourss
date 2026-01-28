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
import { GraduationCap, Play, CheckCircle, Lock, Clock, Trophy, Share2, Copy, Twitter, Facebook, Linkedin, Link as LinkIcon, Shield, Sparkles, Instagram, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSearchParams, Link } from "react-router-dom";

interface ContentCategory {
  id: string;
  name: string;
  is_bde_only: boolean;
}

interface EducationModuleCategory {
  content_categories: ContentCategory;
}

interface Module {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  tier_required: string;
  education_module_categories?: EducationModuleCategory[];
}

interface UserProgress {
  user_id: string;
  module_id: string;
  completed: boolean;
  completed_at?: string;
}

export function EducationSection() {
  const { user, profile, isAdmin } = useAuth();
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
      try {
        console.log("Starting data fetch...");
        console.log("User:", user);
        console.log("Profile:", profile);
        // First try a simple query to check if table exists and has data
        const { data: simpleCheck, error: simpleError } = await supabase
          .from("education_modules")
          .select("*")
          .limit(10);

        console.log("Simple query result:", simpleCheck);
        console.log("Simple query error:", simpleError);

        // Try alternative table names that might exist
        const { data: altCheck1, error: altError1 } = await supabase
          .from("modules")
          .select("*")
          .limit(10);

        console.log("Alternative table 'modules' result:", altCheck1);
        console.log("Alternative table 'modules' error:", altError1);

        const { data: altCheck2, error: altError2 } = await supabase
          .from("educational_modules")
          .select("*")
          .limit(10);

        console.log("Alternative table 'educational_modules' result:", altCheck2);
        console.log("Alternative table 'educational_modules' error:", altError2);

        // If simple query works, try the complex one
        let query = supabase
          .from("education_modules")
          .select(`
            *,
            education_module_categories(
              content_categories(*)
            )
          `);
          // Temporarily remove is_published filter to see all data
          // .eq("is_published", true);

        // Temporarily disable BDE filtering to see existing data
        // if (!profile?.is_bde || profile?.bde_status !== 'active' || profile?.user_tier !== 'premium' || profile?.subscription_type !== 'annual') {
        //   query = query.or('education_module_categories.content_categories.is_bde_only.is.null,education_module_categories.content_categories.is_bde_only.eq.false');
        // }

        const { data: modulesData, error: modulesError } = await query.order("order_index");

        if (modulesError) {
          console.error("Error fetching modules:", modulesError);
          toast.error("Failed to load education modules");
          setModules([]);
        } else {
          console.log("Raw modules data from database:", modulesData);
          console.log("Number of modules found:", modulesData?.length || 0);
          setModules(modulesData || []);
        }

        if (user) {
          const { data: progressData, error: progressError } = await supabase
            .from("user_progress")
            .select("*")
            .eq("user_id", user.id);

          if (progressError) {
            console.error("Error fetching progress:", progressError);
          } else {
            setProgress(progressData || []);
          }
        }

        // Handle deep link to specific module
        const moduleId = searchParams.get("module");
        if (moduleId && modulesData) {
          const targetModule = modulesData.find(m => m.id === moduleId);
          if (targetModule) {
            setSelectedModule(targetModule);
            setIsVideoOpen(true);
          }
        }
      } catch (error) {
        console.error("Unexpected error fetching data:", error);
        toast.error("An unexpected error occurred while loading content");
        setModules([]);
        setProgress([]);
      }
    };

    fetchData();
  }, [user, searchParams, profile]);

  const completedCount = progress.filter(p => p.completed).length;
  const totalModules = modules.length;
  const progressPercent = totalModules > 0 ? (completedCount / totalModules) * 100 : 0;

  const isModuleLocked = (module: Module) => {
    // Check tier requirements
    const tierOrder = ["free", "premium", "exclusive"];
    const userTierIndex = tierOrder.indexOf(profile?.user_tier || "free");
    const requiredIndex = tierOrder.indexOf(module.tier_required);
    if (requiredIndex > userTierIndex) return true;

    // Check BDE requirements
    const hasBdeCategories = module.education_module_categories?.some(
      (emc: EducationModuleCategory) => emc.content_categories?.is_bde_only
    );
    if (hasBdeCategories) {
      return !(
        profile?.is_bde &&
        profile?.bde_status === 'active' &&
        profile?.user_tier === 'premium' &&
        profile?.subscription_type === 'annual'
      );
    }

    return false;
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

  const addSampleData = async () => {
    try {
      // Sample modules data
      const sampleModules = [
        {
          id: 'module-1',
          title: 'Introduction to Financial Literacy',
          description: 'Learn the basics of financial literacy and why it matters for your future.',
          content: 'Financial literacy is the ability to understand and effectively use various financial skills, including personal financial management, budgeting, and investing.',
          video_url: 'https://www.youtube.com/watch?v=example1',
          thumbnail_url: 'https://img.youtube.com/vi/example1/maxresdefault.jpg',
          category: 'Finance Basics',
          tier_required: 'free',
          is_published: true,
          order_index: 1
        },
        {
          id: 'module-2',
          title: 'Understanding Investment Options',
          description: 'Explore different types of investments and how they work.',
          content: 'Investments come in many forms: stocks, bonds, mutual funds, real estate, and more.',
          video_url: 'https://www.youtube.com/watch?v=example2',
          thumbnail_url: 'https://img.youtube.com/vi/example2/maxresdefault.jpg',
          category: 'Investments',
          tier_required: 'free',
          is_published: true,
          order_index: 2
        },
        {
          id: 'module-3',
          title: 'Budgeting and Saving Strategies',
          description: 'Master the art of creating and maintaining a personal budget.',
          content: 'A budget is a financial plan that helps you track income and expenses.',
          video_url: 'https://www.youtube.com/watch?v=example3',
          thumbnail_url: 'https://img.youtube.com/vi/example3/maxresdefault.jpg',
          category: 'Budgeting',
          tier_required: 'free',
          is_published: true,
          order_index: 3
        }
      ];

      for (const module of sampleModules) {
        const { error } = await supabase
          .from('education_modules')
          .upsert(module, { onConflict: 'id' });

        if (error) {
          console.error('Error adding module:', module.title, error);
        } else {
          console.log('Added module:', module.title);
        }
      }

      // Add content categories
      const categories = [
        { id: 'cat-1', name: 'BDE Exclusive Content', is_bde_only: true },
        { id: 'cat-2', name: 'Premium Content', is_bde_only: false },
        { id: 'cat-3', name: 'Free Content', is_bde_only: false }
      ];

      for (const category of categories) {
        const { error } = await supabase
          .from('content_categories')
          .upsert(category, { onConflict: 'id' });

        if (error) {
          console.error('Error adding category:', category.name, error);
        }
      }

      // Link modules to categories
      const moduleCategories = [
        { id: 'emc-1', module_id: 'module-1', category_id: 'cat-3' },
        { id: 'emc-2', module_id: 'module-2', category_id: 'cat-3' },
        { id: 'emc-3', module_id: 'module-3', category_id: 'cat-3' }
      ];

      for (const mc of moduleCategories) {
        const { error } = await supabase
          .from('education_module_categories')
          .upsert(mc, { onConflict: 'id' });

        if (error) {
          console.error('Error linking module to category:', mc, error);
        }
      }

      toast.success("Sample data added successfully! Refreshing...");
      // Refresh the data
      window.location.reload();
    } catch (error) {
      console.error("Error adding sample data:", error);
      toast.error("Failed to add sample data");
    }
  };

  const handleShare = async (module: Module, platform: "copy" | "twitter" | "facebook" | "linkedin" | "instagram" | "whatsapp") => {
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
      case "instagram":
        // Instagram doesn't support direct URL sharing, so copy to clipboard
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
        toast.success("Content copied! Paste into Instagram.");
        break;
      case "whatsapp":
        window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`, "_blank");
        break;
    }
  };

  const handleStartModule = async (module: Module) => {
    if (isModuleLocked(module)) {
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
        <DropdownMenuItem onClick={() => handleShare(module, "instagram")}>
          <Instagram className="w-4 h-4 mr-2" />
          Share on Instagram
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleShare(module, "whatsapp")}>
          <MessageCircle className="w-4 h-4 mr-2" />
          Share on WhatsApp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderModuleCard = (module: Module, index: number) => {
    const locked = isModuleLocked(module);
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
            {module.thumbnail_url && (
              <div className="aspect-video w-full rounded-lg overflow-hidden bg-muted mb-3">
                <img
                  src={module.thumbnail_url}
                  alt={module.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
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
              <div className="flex flex-col gap-3 flex-1 max-w-md">
                <div className="flex justify-between text-sm">
                  <span>{Math.round(progressPercent)}% Complete</span>
                  <span>{completedCount}/{totalModules}</span>
                </div>
                <Progress value={progressPercent} className="h-3" />
                <div className="flex gap-2">
                  <Link to="/tutor" className="flex-1">
                    <Button className="w-full" size="sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Use AI Tutor
                    </Button>
                  </Link>
                  <Link to="/vetting" className="flex-1">
                    <Button className="w-full" size="sm">
                      <Shield className="w-4 h-4 mr-2" />
                      Use Scam Detector
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Admin Controls - Only show if no modules exist */}
      {modules.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">No Education Modules Found</h3>
                <p className="text-muted-foreground mb-4">
                  It looks like there are no education modules in the database yet.
                </p>
                {isAdmin && (
                  <Button onClick={addSampleData} className="bg-primary hover:bg-primary/90">
                    Add Sample Education Modules
                  </Button>
                )}
                {!isAdmin && (
                  <p className="text-sm text-muted-foreground">
                    Contact an administrator to add education modules.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

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
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "instagram")}>
                    <Instagram className="w-4 h-4 mr-2" />
                    Share on Instagram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleShare(selectedModule, "whatsapp")}>
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Share on WhatsApp
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
