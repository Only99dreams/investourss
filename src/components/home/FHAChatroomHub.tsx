import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Heart,
  MessageCircle,
  Lock,
  Send,
  Image,
  ChevronDown,
  ChevronUp,
  FileText,
  Play,
  X,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn, generateVideoThumbnail } from "@/lib/utils";
import { LinkifiedText } from "@/lib/LinkifiedText";
import { isActiveSubscriber, isPremiumTier } from "@/lib/subscription";

interface Post {
  id: string;
  author_id: string;
  content: string;
  attachment_url: string | null;
  attachment_type: string | null;
  likes_count: number;
  comments_count: number;
  is_pinned: boolean;
  created_at: string;
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
    country: string | null;
  };
}

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

const FHAChatroomHub = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [postComments, setPostComments] = useState<Record<string, Comment[]>>({});
  const [newComments, setNewComments] = useState<Record<string, string>>({});
  const [loadingComments, setLoadingComments] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  const [playingVideos, setPlayingVideos] = useState<Set<string>>(new Set());

  const isEligible =
    isActiveSubscriber(profile) ||
    isPremiumTier(profile) ||
    (profile?.audit_credits ?? 0) > 0;

  const fetchPosts = async () => {
    try {
      const { data: postsData, error } = await supabase
        .from("fha_chatroom_posts")
        .select("id, author_id, content, attachment_url, attachment_type, likes_count, comments_count, is_pinned, created_at")
        .eq("is_hidden", false)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;

      const authorIds = [...new Set(postsData?.map(p => p.author_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, country")
        .in("id", authorIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      const postsWithProfiles = (postsData || []).map(post => ({
        ...post,
        profiles: profilesMap.get(post.author_id) || null,
      })) as Post[];

      setPosts(postsWithProfiles);
    } catch (error) {
      console.error("Error fetching chatroom posts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserLikes = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("fha_chatroom_likes")
        .select("post_id")
        .eq("user_id", user.id);

      setUserLikes(new Set(data?.map(l => l.post_id) || []));
    } catch (error) {
      console.error("Error fetching likes:", error);
    }
  };

  useEffect(() => {
    fetchPosts();
    if (user) {
      fetchUserLikes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    posts.forEach((post) => {
      if (post.attachment_type === "video" && post.attachment_url && !videoThumbnails[post.id]) {
        generateVideoThumbnail(post.attachment_url).then((thumb) => {
          if (thumb) {
            setVideoThumbnails((prev) => ({ ...prev, [post.id]: thumb }));
          }
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  useEffect(() => {
    if (!user || !isEligible) return;
    const channel = supabase
      .channel("fha-chatroom-hub-realtime")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "fha_chatroom_posts",
      }, () => {
        fetchPosts();
        if (user) fetchUserLikes();
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "fha_chatroom_comments",
      }, () => {
        fetchPosts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isEligible]);

  const fetchComments = async (postId: string) => {
    setLoadingComments(prev => new Set([...prev, postId]));
    try {
      const { data: commentsData, error } = await supabase
        .from("fha_chatroom_comments")
        .select("id, post_id, author_id, content, created_at")
        .eq("post_id", postId)
        .eq("is_hidden", false)
        .order("created_at", { ascending: true })
        .limit(10);

      if (error) throw error;

      const authorIds = [...new Set(commentsData?.map(c => c.author_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", authorIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      const commentsWithProfiles = (commentsData || []).map(comment => ({
        ...comment,
        profiles: profilesMap.get(comment.author_id) || null,
      })) as Comment[];

      setPostComments(prev => ({ ...prev, [postId]: commentsWithProfiles }));
    } catch (error) {
      console.error("Error fetching comments:", error);
    } finally {
      setLoadingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(postId);
        return newSet;
      });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const maxSize = isVideo ? 5 * 1024 * 1024 : isImage ? 3 * 1024 * 1024 : 10 * 1024 * 1024;
    const label = isVideo ? "Videos" : isImage ? "Images" : "Files";
    if (file.size > maxSize) {
      toast({ title: "File too large", description: `${label} must be under ${(maxSize / 1024 / 1024).toFixed(0)}MB`, variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setFilePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else if (file.type.startsWith("video/")) {
      const objectUrl = URL.createObjectURL(file);
      const thumb = await generateVideoThumbnail(objectUrl);
      setFilePreview(thumb);
      URL.revokeObjectURL(objectUrl);
    } else {
      setFilePreview(null);
    }
  };

  const handlePost = async () => {
    if (!newPost.trim() || !user) return;

    if (!isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can post.", variant: "destructive" });
      return;
    }

    setIsPosting(true);
    try {
      let attachmentUrl = null;
      let attachmentType = null;

      if (selectedFile) {
        const fileExt = selectedFile.name.split(".").pop();
        const filePath = `fha-chatroom-attachments/${user.id}/${Date.now()}.${fileExt}`;
        if (selectedFile.type.startsWith("image/")) attachmentType = "image";
        else if (selectedFile.type.startsWith("video/")) attachmentType = "video";
        else attachmentType = "document";

        const { data, error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(filePath, selectedFile, { cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;
        if (data) {
          const { data: { publicUrl } } = supabase.storage.from("attachments").getPublicUrl(filePath);
          attachmentUrl = publicUrl;
        }
      }

      const { error } = await supabase
        .from("fha_chatroom_posts")
        .insert({
          content: newPost.trim(),
          author_id: user.id,
          attachment_url: attachmentUrl,
          attachment_type: attachmentType,
          is_pinned: false,
        });

      if (error) throw error;

      toast({
        title: "Posted!",
        description: "Your message has been shared with the FHA Chatroom.",
      });
      setNewPost("");
      setSelectedFile(null);
      setFilePreview(null);
      fetchPosts();
    } catch (error) {
      console.error("Error posting:", error);
      toast({
        title: "Error",
        description: "Failed to post. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPosting(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please login to like posts.",
        variant: "destructive",
      });
      return;
    }

    if (!isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can interact.", variant: "destructive" });
      return;
    }

    const isLiked = userLikes.has(postId);

    try {
      if (isLiked) {
        await supabase
          .from("fha_chatroom_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);

        setUserLikes(prev => {
          const newSet = new Set(prev);
          newSet.delete(postId);
          return newSet;
        });

        await supabase
          .from("fha_chatroom_posts")
          .update({ likes_count: Math.max(0, (posts.find(p => p.id === postId)?.likes_count || 1) - 1) })
          .eq("id", postId);
      } else {
        await supabase
          .from("fha_chatroom_likes")
          .insert({ post_id: postId, user_id: user.id });

        setUserLikes(prev => new Set([...prev, postId]));

        await supabase
          .from("fha_chatroom_posts")
          .update({ likes_count: (posts.find(p => p.id === postId)?.likes_count || 0) + 1 })
          .eq("id", postId);
      }

      setPosts(prev => prev.map(post =>
        post.id === postId
          ? { ...post, likes_count: isLiked ? Math.max(0, post.likes_count - 1) : post.likes_count + 1 }
          : post
      ));
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const handleComment = async (postId: string) => {
    const content = newComments[postId]?.trim();
    if (!content || !user) return;

    if (!isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can comment.", variant: "destructive" });
      return;
    }

    try {
      const { error } = await supabase
        .from("fha_chatroom_comments")
        .insert({
          post_id: postId,
          author_id: user.id,
          content,
        });

      if (error) throw error;

      await supabase
        .from("fha_chatroom_posts")
        .update({ comments_count: (posts.find(p => p.id === postId)?.comments_count || 0) + 1 })
        .eq("id", postId);

      setPosts(prev => prev.map(post =>
        post.id === postId
          ? { ...post, comments_count: post.comments_count + 1 }
          : post
      ));

      setNewComments(prev => ({ ...prev, [postId]: "" }));
      fetchComments(postId);

      toast({
        title: "Comment added!",
        description: "Your comment has been posted.",
      });
    } catch (error) {
      console.error("Error adding comment:", error);
      toast({
        title: "Error",
        description: "Failed to add comment.",
        variant: "destructive",
      });
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(postId)) {
        newSet.delete(postId);
      } else {
        newSet.add(postId);
        if (!postComments[postId]) {
          fetchComments(postId);
        }
      }
      return newSet;
    });
  };

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <section className="py-16 bg-secondary/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-2xl mx-auto mb-8"
        >
          <div className="w-14 h-14 rounded-2xl bg-investours-coral/10 flex items-center justify-center mx-auto mb-4">
            <Users className="w-7 h-7 text-investours-coral" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            FHA Chatroom
          </h2>
          <p className="text-muted-foreground">
            Exclusive Chatroom for Financial Health Ambassadors — share insights, ask questions, and grow together.
          </p>
        </motion.div>

        <div className="max-w-2xl mx-auto space-y-4">
          {user ? (
            isEligible ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={profile?.avatar_url || undefined} />
                        <AvatarFallback>{getInitials(profile?.full_name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-3">
                        <Textarea
                          value={newPost}
                          onChange={(e) => setNewPost(e.target.value)}
                          placeholder="Share an update with the FHA community..."
                          className="resize-none min-h-[80px]"
                        />
                        {filePreview && (
                          <div className="relative rounded-lg overflow-hidden border">
                            {selectedFile?.type.startsWith("image/") ? (
                              <img src={filePreview} alt="Preview" className="w-full max-h-40 object-cover" />
                            ) : (
                              <div className="relative">
                                <img src={filePreview} alt="Video preview" className="w-full max-h-40 object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                    <Play className="w-5 h-5 text-foreground ml-0.5" />
                                  </div>
                                </div>
                              </div>
                            )}
                            <button
                              onClick={() => { setSelectedFile(null); setFilePreview(null); }}
                              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*,video/*"
                              className="hidden"
                              onChange={handleFileSelect}
                              disabled={isPosting}
                            />
                            <Button variant="ghost" size="sm" asChild>
                              <span>
                                <Image className="w-4 h-4 mr-2" />
                                Photo/Video
                              </span>
                            </Button>
                          </label>
                          <Button
                            onClick={handlePost}
                            disabled={!newPost.trim() || isPosting}
                            size="sm"
                          >
                            {isPosting ? "Posting..." : "Post"}
                            <Send className="w-4 h-4 ml-2" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="py-6 text-center">
                  <Crown className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-muted-foreground mb-3">Become a Financial Health Ambassador to post in the FHA Chatroom.</p>
                  <Link to="/ambassador">
                    <Button variant="default" size="sm">Become an Ambassador</Button>
                  </Link>
                </CardContent>
              </Card>
            )
          ) : (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-6 text-center">
                <Lock className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-muted-foreground mb-3">Login to post and engage with the FHA community</p>
                <Link to="/auth?mode=login">
                  <Button variant="default" size="sm">Login to Post</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="py-4">
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-1/4" />
                        <div className="h-4 bg-muted rounded w-3/4" />
                        <div className="h-4 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <MessageCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No messages yet. Be the first to share!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {posts.map((post, index) => (
                <motion.div
                  key={post.id}
                  id={`chatroom-post-${post.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="py-4">
                      <div className="flex gap-3">
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={post.profiles?.avatar_url || undefined} />
                          <AvatarFallback>
                            {getInitials(post.profiles?.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground text-sm">
                              {post.profiles?.full_name || "Anonymous"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <div className="text-sm text-foreground mb-3 whitespace-pre-wrap">
                            <LinkifiedText text={post.content || ""} />
                          </div>
                          {post.attachment_url && post.attachment_type === "image" && (
                            <div className="mb-3 rounded-lg overflow-hidden">
                              <img src={post.attachment_url} alt="Post" className="w-full object-cover max-h-64" />
                            </div>
                          )}
                          {post.attachment_url && post.attachment_type === "video" && (
                            <div className="mb-3 rounded-lg overflow-hidden bg-black relative">
                              {videoThumbnails[post.id] && !playingVideos.has(post.id) && (
                                <div
                                  className="relative cursor-pointer"
                                  onClick={() => setPlayingVideos(prev => new Set([...prev, post.id]))}
                                >
                                  <img src={videoThumbnails[post.id]} alt="Video" className="w-full object-cover max-h-64" />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors">
                                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center hover:scale-110 transition-transform">
                                      <Play className="w-6 h-6 text-foreground ml-0.5" />
                                    </div>
                                  </div>
                                </div>
                              )}
                              <video
                                src={post.attachment_url}
                                controls
                                autoPlay={playingVideos.has(post.id)}
                                className={`w-full max-h-64 ${!playingVideos.has(post.id) && videoThumbnails[post.id] ? "hidden" : ""}`}
                              />
                            </div>
                          )}
                          {post.attachment_url && post.attachment_type === "document" && (
                            <div className="mb-3 p-2 bg-muted rounded-lg flex items-center gap-2">
                              <FileText className="w-5 h-5 text-primary" />
                              <a href={post.attachment_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                                Download Document
                              </a>
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-muted-foreground">
                            <button
                              onClick={() => handleLike(post.id)}
                              className={cn(
                                "flex items-center gap-1 text-xs hover:text-destructive transition-colors",
                                userLikes.has(post.id) && "text-destructive"
                              )}
                            >
                              <Heart className={cn(
                                "w-4 h-4",
                                userLikes.has(post.id) && "fill-current"
                              )} />
                              {post.likes_count || 0}
                            </button>
                            <button
                              onClick={() => toggleComments(post.id)}
                              className={cn(
                                "flex items-center gap-1 text-xs hover:text-primary transition-colors",
                                expandedComments.has(post.id) && "text-primary"
                              )}
                            >
                              <MessageCircle className="w-4 h-4" />
                              {post.comments_count || 0}
                              {expandedComments.has(post.id) ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          <AnimatePresence>
                            {expandedComments.has(post.id) && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mt-4 pt-4 border-t space-y-3"
                              >
                                {loadingComments.has(post.id) ? (
                                  <div className="text-sm text-muted-foreground">Loading comments...</div>
                                ) : postComments[post.id]?.length === 0 ? (
                                  <div className="text-sm text-muted-foreground">No comments yet</div>
                                ) : (
                                  postComments[post.id]?.map(comment => (
                                    <div key={comment.id} className="flex gap-2">
                                      <Avatar className="w-7 h-7">
                                        <AvatarImage src={comment.profiles?.avatar_url || undefined} />
                                        <AvatarFallback className="text-xs">
                                          {getInitials(comment.profiles?.full_name)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 bg-muted/50 rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-medium">
                                            {comment.profiles?.full_name || "Anonymous"}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                                          </span>
                                        </div>
                                        <p className="text-sm"><LinkifiedText text={comment.content} /></p>
                                      </div>
                                    </div>
                                  ))
                                )}

                                {user ? (
                                  isEligible ? (
                                    <div className="flex gap-2">
                                      <Avatar className="w-7 h-7">
                                        <AvatarImage src={profile?.avatar_url || undefined} />
                                        <AvatarFallback className="text-xs">
                                          {getInitials(profile?.full_name)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 flex gap-2">
                                        <Input
                                          value={newComments[post.id] || ""}
                                          onChange={(e) => setNewComments(prev => ({ ...prev, [post.id]: e.target.value }))}
                                          placeholder="Write a comment..."
                                          className="h-8 text-sm"
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                              e.preventDefault();
                                              handleComment(post.id);
                                            }
                                          }}
                                        />
                                        <Button
                                          size="sm"
                                          className="h-8"
                                          onClick={() => handleComment(post.id)}
                                          disabled={!newComments[post.id]?.trim()}
                                        >
                                          <Send className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">
                                      <Link to="/ambassador" className="text-primary hover:underline">Become an Ambassador</Link> to comment
                                    </p>
                                  )
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    <Link to="/auth?mode=login" className="text-primary hover:underline">Login</Link> to comment
                                  </p>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          <div className="text-center pt-4">
            <Link to="/fha-chatroom">
              <Button variant="outline">
                View All Messages
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FHAChatroomHub;
