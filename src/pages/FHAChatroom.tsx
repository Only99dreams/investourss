import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  MessageSquare,
  Heart,
  PlusCircle,
  Loader2,
  Send,
  FileText,
  Play,
  X,
  Crown,
  Shield,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateVideoThumbnail } from "@/lib/utils";
import { LinkifiedText } from "@/lib/LinkifiedText";

const sendNotification = (payload: Record<string, unknown>) => {
  supabase.functions.invoke('send-notification', { body: payload }).catch(() => {});
};

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
  author?: {
    full_name: string | null;
    avatar_url: string | null;
    country: string | null;
  };
  user_liked?: boolean;
}

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
const MAX_VIDEO_SIZE = 5 * 1024 * 1024;

const FHAChatroom = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPostContent, setNewPostContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const [commentsMap, setCommentsMap] = useState<Record<string, Comment[]>>({});
  const [newCommentMap, setNewCommentMap] = useState<Record<string, string>>({});
  const [chatroomStats, setChatroomStats] = useState({
    totalMembers: 0,
    totalPosts: 0,
  });
  const { toast } = useToast();
  const { user, profile, refreshProfile } = useAuth();

  const isEligible = (profile?.has_active_subscription === true) || (profile?.audit_credits ?? 0) > 0;

  const fetchPosts = async () => {
    try {
      setIsLoading(true);
      const { data: postsData, error } = await supabase
        .from('fha_chatroom_posts')
        .select('*')
        .eq('is_hidden', false)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (!postsData) {
        setPosts([]);
        setIsLoading(false);
        return;
      }

      const authorIds = [...new Set(postsData.map(p => p.author_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, country')
        .in('id', authorIds);

      let userLikes: string[] = [];
      if (user) {
        const { data: likes } = await supabase
          .from('fha_chatroom_likes')
          .select('post_id')
          .eq('user_id', user.id);
        userLikes = likes?.map(l => l.post_id) || [];
      }

      const enrichedPosts = postsData.map(post => ({
        ...post,
        author: profiles?.find(p => p.id === post.author_id),
        user_liked: userLikes.includes(post.id)
      }));

      setPosts(enrichedPosts);
    } catch (error) {
      console.error('Error fetching chatroom posts:', error);
      toast({
        title: "Error loading posts",
        description: "Failed to load chatroom posts. Please refresh.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { count: membersCount } = await supabase
        .from('ambassadors')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      const { count: postsCount } = await supabase
        .from('fha_chatroom_posts')
        .select('*', { count: 'exact', head: true });

      setChatroomStats({
        totalMembers: membersCount || 0,
        totalPosts: postsCount || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  useEffect(() => {
    if (!isEligible) {
      setIsLoading(false);
      return;
    }
    fetchPosts();
    fetchStats();

    const channel = supabase
      .channel('fha-chatroom-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'fha_chatroom_posts'
      }, () => {
        fetchPosts();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'fha_chatroom_comments'
      }, () => {
        fetchPosts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isEligible]);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const maxSize = isVideo ? MAX_VIDEO_SIZE : isImage ? MAX_IMAGE_SIZE : 10 * 1024 * 1024;

      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `${isVideo ? 'Videos' : isImage ? 'Images' : 'Files'} must be under ${(maxSize / 1024 / 1024).toFixed(0)}MB`,
          variant: "destructive"
        });
        return;
      }
      setSelectedFile(file);
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (ev) => setFilePreview(ev.target?.result as string);
        reader.readAsDataURL(file);
      } else if (isVideo) {
        const objectUrl = URL.createObjectURL(file);
        const thumb = await generateVideoThumbnail(objectUrl);
        setFilePreview(thumb);
        URL.revokeObjectURL(objectUrl);
      } else {
        setFilePreview(null);
      }
    }
  };

  const handleCreatePost = async () => {
    if (!user || !isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can post.", variant: "destructive" });
      return;
    }

    if (!newPostContent.trim()) {
      toast({ title: "Content Required", description: "Please enter some content for your post.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      let attachmentUrl = null;
      let attachmentType = null;

      if (selectedFile) {
        try {
          const fileExt = selectedFile.name.split('.').pop();
          const fileName = `${user.id}/${Date.now()}.${fileExt}`;
          const filePath = `fha-chatroom-attachments/${fileName}`;

          if (selectedFile.type.startsWith('image/')) attachmentType = 'image';
          else if (selectedFile.type.startsWith('video/')) attachmentType = 'video';
          else attachmentType = 'document';

          const { data, error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(filePath, selectedFile, { cacheControl: '3600', upsert: false });

          if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

          if (data) {
            const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
            attachmentUrl = publicUrl;
          }
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          toast({ title: "Upload Failed", description: "Failed to upload file. You can still post without it.", variant: "destructive" });
          attachmentUrl = null;
          attachmentType = null;
        }
      }

      const { error } = await supabase.from('fha_chatroom_posts').insert({
        author_id: user.id,
        content: newPostContent,
        attachment_url: attachmentUrl,
        attachment_type: attachmentType,
        is_pinned: false,
      });

      if (error) throw error;

      toast({ title: "Success!", description: "Your message has been posted to the FHA Chatroom." });

      setNewPostContent("");
      setSelectedFile(null);
      setFilePreview(null);
      setIsCreateOpen(false);
      fetchPosts();
    } catch (error) {
      console.error('Error creating post:', error);
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to create post. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (postId: string, isLiked: boolean) => {
    if (!user || !isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can interact.", variant: "destructive" });
      return;
    }

    try {
      if (isLiked) {
        await supabase.from('fha_chatroom_likes').delete().eq('post_id', postId).eq('user_id', user.id);
        setPosts(prev => prev.map(p =>
          p.id === postId ? { ...p, likes_count: Math.max(0, (p.likes_count || 1) - 1), user_liked: false } : p
        ));
      } else {
        await supabase.from('fha_chatroom_likes').insert({ post_id: postId, user_id: user.id });
        setPosts(prev => prev.map(p =>
          p.id === postId ? { ...p, likes_count: (p.likes_count || 0) + 1, user_liked: true } : p
        ));
        const post = posts.find(p => p.id === postId);
        if (post && post.author_id !== user.id) {
          sendNotification({
            type: 'post_liked',
            recipient_id: post.author_id,
            actor_name: profile?.full_name || 'Someone',
            post_id: postId,
            post_preview: post.content,
          });
        }
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const fetchComments = async (postId: string) => {
    try {
      const { data, error } = await supabase
        .from('fha_chatroom_comments')
        .select('*')
        .eq('post_id', postId)
        .eq('is_hidden', false)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const authorIds = [...new Set(data?.map(c => c.author_id) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', authorIds);

      const enrichedComments = data?.map(comment => ({
        ...comment,
        author: profiles?.find(p => p.id === comment.author_id)
      })) || [];

      setCommentsMap(prev => ({ ...prev, [postId]: enrichedComments }));
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const handleAddComment = async (postId: string) => {
    if (!user || !isEligible) {
      toast({ title: "Access Required", description: "Only active Financial Health Ambassadors can comment.", variant: "destructive" });
      return;
    }

    const newComment = newCommentMap[postId] || "";
    if (!newComment.trim()) return;

    try {
      await supabase.from('fha_chatroom_comments').insert({ post_id: postId, author_id: user.id, content: newComment });
      setNewCommentMap(prev => ({ ...prev, [postId]: "" }));
      fetchComments(postId);
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p));
      const post = posts.find(p => p.id === postId);
      if (post && post.author_id !== user.id) {
        sendNotification({
          type: 'post_commented',
          recipient_id: post.author_id,
          actor_name: profile?.full_name || 'Someone',
          post_id: postId,
          post_preview: post.content,
          comment_preview: newComment,
        });
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (!isEligible) {
    return (
      <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <Header />
        <main className="container mx-auto px-4 pt-24 md:pt-28 pb-16 relative z-10 flex-1">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-4">FHA Chatroom</h1>
            <p className="text-lg text-muted-foreground mb-6">
              This chatroom is exclusive to active Financial Health Ambassadors.
            </p>
            <Card className="mb-8 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 justify-center">
                  <Crown className="w-5 h-5 text-primary" />
                  Become a Financial Health Ambassador
                </CardTitle>
                <CardDescription>
                  Maintain an active subscription or an audit credit pack to access the FHA Chatroom.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="hero">
                  <Link to="/ambassador">Apply Now</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <Header />

      <main className="container mx-auto px-4 pt-24 md:pt-28 pb-8 relative z-10 flex-1">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                FHA Chatroom
              </h1>
              <p className="text-muted-foreground">
                Connect with fellow Financial Health Ambassadors. Share insights, ask questions, and grow together.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!user || !isEligible}>
                    <PlusCircle className="w-4 h-4 mr-2" />
                    New Message
                  </Button>
                </DialogTrigger>
                {user && isEligible && (
                  <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>New Message</DialogTitle>
                      <DialogDescription>Share an update with the FHA community</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="content">Message</Label>
                        <Textarea id="content" value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)} placeholder="What's on your mind?" className="min-h-[150px]" />
                      </div>
                      <div>
                        <Label htmlFor="file">Attachment (Optional)</Label>
                        <p className="text-xs text-muted-foreground mb-1">Images max 3MB, Videos max 5MB</p>
                        <Input id="file" type="file" accept="image/*,video/*,.pdf" onChange={handleFileSelect} disabled={isSubmitting} />
                        {selectedFile && (
                          <div className="mt-2">
                            {filePreview && (
                              <div className="relative mb-2 rounded-lg overflow-hidden border">
                                {selectedFile.type.startsWith("image/") ? (
                                  <img src={filePreview} alt="Preview" className="w-full max-h-48 object-cover" />
                                ) : selectedFile.type.startsWith("video/") ? (
                                  <div className="relative">
                                    <img src={filePreview} alt="Video preview" className="w-full max-h-48 object-cover" />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                        <Play className="w-6 h-6 text-foreground ml-0.5" />
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                                <button onClick={() => { setSelectedFile(null); setFilePreview(null); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors">
                                  <X className="w-3 h-3 text-white" />
                                </button>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <FileText className="w-4 h-4" />
                              {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button onClick={handleCreatePost} disabled={isSubmitting || !newPostContent.trim()}>
                          {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Posting...</> : 'Post'}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                )}
              </Dialog>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{chatroomStats.totalMembers.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">Ambassadors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{chatroomStats.totalPosts.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">Messages</div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Posts Feed */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="py-12 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </CardContent>
              </Card>
            ) : posts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No messages yet</h3>
                  <p className="text-muted-foreground mb-4">Be the first to share something with the community!</p>
                  {user && isEligible && (
                    <Button onClick={() => setIsCreateOpen(true)}>
                      <PlusCircle className="w-4 h-4 mr-2" />
                      New Message
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              posts.map((post) => (
                <motion.div
                  key={post.id}
                  id={`post-${post.id}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardContent className="pt-6">
                      {/* Post Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={post.author?.avatar_url || undefined} />
                            <AvatarFallback>
                              {post.author?.full_name?.charAt(0) || "U"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-foreground">
                              {post.author?.full_name || "Anonymous"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {post.author?.country || "Ambassador"} • {formatTimeAgo(post.created_at)}
                            </p>
                          </div>
                        </div>
                        {post.is_pinned && (
                          <Badge variant="secondary">Pinned</Badge>
                        )}
                      </div>

                      {/* Post Content */}
                      <div className="mb-4">
                        <LinkifiedText text={post.content} />
                      </div>

                      {/* Attachment */}
                      {post.attachment_url && (
                        <div className="mb-4 rounded-lg overflow-hidden border">
                          {post.attachment_type === "image" && (
                            <img src={post.attachment_url} alt="Attachment" className="w-full max-h-96 object-cover" />
                          )}
                          {post.attachment_type === "video" && (
                            <div className="relative">
                              <img src={videoThumbnails[post.id] || post.attachment_url} alt="Video preview" className="w-full max-h-96 object-cover" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <Play className="w-6 h-6 text-foreground ml-0.5" />
                                </div>
                              </div>
                            </div>
                          )}
                          {post.attachment_type === "document" && (
                            <a href={post.attachment_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-4 text-primary hover:underline">
                              <FileText className="w-5 h-5" />
                              View Document
                            </a>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-6 pt-3 border-t">
                        <button
                          onClick={() => handleLike(post.id, post.user_liked || false)}
                          className={`flex items-center gap-2 text-sm transition-colors ${post.user_liked ? 'text-red-500' : 'text-muted-foreground hover:text-red-500'}`}
                        >
                          <Heart className={`w-5 h-5 ${post.user_liked ? 'fill-current' : ''}`} />
                          {post.likes_count || 0}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPost(selectedPost === post.id ? null : post.id);
                            if (selectedPost !== post.id) {
                              fetchComments(post.id);
                            }
                          }}
                          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          <MessageSquare className="w-5 h-5" />
                          {post.comments_count || 0}
                        </button>
                      </div>

                      {/* Comments Section */}
                      {selectedPost === post.id && (
                        <div className="mt-4 pt-4 border-t space-y-4">
                          {/* Existing Comments */}
                          {commentsMap[post.id]?.map((comment) => (
                            <div key={comment.id} className="flex gap-3">
                              <Avatar className="w-8 h-8">
                                <AvatarImage src={comment.author?.avatar_url || undefined} />
                                <AvatarFallback className="text-xs">
                                  {comment.author?.full_name?.charAt(0) || "U"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 bg-muted/50 rounded-lg p-3">
                                <p className="font-semibold text-sm text-foreground">
                                  {comment.author?.full_name || "Anonymous"}
                                </p>
                                <p className="text-sm text-muted-foreground">{comment.content}</p>
                                <p className="text-xs text-muted-foreground mt-1">{formatTimeAgo(comment.created_at)}</p>
                              </div>
                            </div>
                          ))}

                          {/* Add Comment */}
                          {user && isEligible && (
                            <div className="flex gap-3">
                              <Avatar className="w-8 h-8">
                                <AvatarFallback className="text-xs">
                                  {profile?.full_name?.charAt(0) || "U"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 flex gap-2">
                                <Input
                                  value={newCommentMap[post.id] || ""}
                                  onChange={(e) => setNewCommentMap(prev => ({ ...prev, [post.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleAddComment(post.id);
                                    }
                                  }}
                                  placeholder="Write a comment..."
                                  className="flex-1"
                                />
                                <Button
                                  size="sm"
                                  onClick={() => handleAddComment(post.id)}
                                  disabled={!newCommentMap[post.id]?.trim()}
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  Ambassador Chatroom
                </CardTitle>
                <CardDescription>
                  Exclusive space for active Financial Health Ambassadors to connect, share, and grow together.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span>Active subscription or Audit Credits required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <span>Connect with fellow ambassadors</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <span>Share insights and ask questions</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default FHAChatroom;
