import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Heart, MessageCircle, Share2, Lock, Send, Image, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface Post {
  id: string;
  content: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  author_id: string;
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

const CommunitySection = () => {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [postComments, setPostComments] = useState<Record<string, Comment[]>>({});
  const [newComments, setNewComments] = useState<Record<string, string>>({});
  const [loadingComments, setLoadingComments] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    fetchPosts();
    if (user) {
      fetchUserLikes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchPosts = async () => {
    try {
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id, content, created_at, likes_count, comments_count, shares_count, author_id')
        .eq('is_approved', true)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false })
        .limit(5);

      if (postsError) throw postsError;
      
      const authorIds = [...new Set(postsData?.map(p => p.author_id) || [])];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', authorIds);
      
      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      
      const postsWithProfiles = (postsData || []).map(post => ({
        ...post,
        profiles: profilesMap.get(post.author_id) || null
      })) as Post[];
      
      setPosts(postsWithProfiles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching posts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserLikes = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('post_likes')
        .select('post_id')
        .eq('user_id', user.id);
      
      setUserLikes(new Set(data?.map(l => l.post_id) || []));
    } catch (error) {
      console.error("Error fetching likes:", error);
    }
  };

  const fetchComments = async (postId: string) => {
    setLoadingComments(prev => new Set([...prev, postId]));
    try {
      const { data: commentsData, error } = await supabase
        .from('post_comments')
        .select('id, content, created_at, author_id')
        .eq('post_id', postId)
        .eq('is_hidden', false)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) throw error;

      const authorIds = [...new Set(commentsData?.map(c => c.author_id) || [])];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', authorIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      const commentsWithProfiles = (commentsData || []).map(comment => ({
        ...comment,
        profiles: profilesMap.get(comment.author_id) || null
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

  const handlePost = async () => {
    if (!newPost.trim() || !user) return;

    setIsPosting(true);
    try {
      const { error } = await supabase
        .from('posts')
        .insert({
          content: newPost.trim(),
          author_id: user.id,
          category: 'finance',
          is_approved: true
        });

      if (error) throw error;

      toast({
        title: "Posted!",
        description: "Your post has been shared with the community."
      });
      setNewPost("");
      fetchPosts();
    } catch (error) {
      console.error("Error posting:", error);
      toast({
        title: "Error",
        description: "Failed to post. Please try again.",
        variant: "destructive"
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
        variant: "destructive"
      });
      return;
    }

    const isLiked = userLikes.has(postId);

    try {
      if (isLiked) {
        await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);
        
        setUserLikes(prev => {
          const newSet = new Set(prev);
          newSet.delete(postId);
          return newSet;
        });

        await supabase
          .from('posts')
          .update({ likes_count: Math.max(0, (posts.find(p => p.id === postId)?.likes_count || 1) - 1) })
          .eq('id', postId);
      } else {
        await supabase
          .from('post_likes')
          .insert({ post_id: postId, user_id: user.id });
        
        setUserLikes(prev => new Set([...prev, postId]));

        await supabase
          .from('posts')
          .update({ likes_count: (posts.find(p => p.id === postId)?.likes_count || 0) + 1 })
          .eq('id', postId);
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

    try {
      const { error } = await supabase
        .from('post_comments')
        .insert({
          post_id: postId,
          author_id: user.id,
          content
        });

      if (error) throw error;

      await supabase
        .from('posts')
        .update({ comments_count: (posts.find(p => p.id === postId)?.comments_count || 0) + 1 })
        .eq('id', postId);

      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, comments_count: post.comments_count + 1 }
          : post
      ));

      setNewComments(prev => ({ ...prev, [postId]: "" }));
      fetchComments(postId);

      toast({
        title: "Comment added!",
        description: "Your comment has been posted."
      });
    } catch (error) {
      console.error("Error adding comment:", error);
      toast({
        title: "Error",
        description: "Failed to add comment.",
        variant: "destructive"
      });
    }
  };

  const handleShare = async (postId: string) => {
    const referralCode = profile?.referral_code || "";
    const shareUrl = `${window.location.origin}/community?post=${postId}${referralCode ? `&ref=${referralCode}` : ""}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      
      if (user) {
        await supabase
          .from('post_shares')
          .insert({ post_id: postId, user_id: user.id, platform: 'copy' });
        
        await supabase
          .from('posts')
          .update({ shares_count: (posts.find(p => p.id === postId)?.shares_count || 0) + 1 })
          .eq('id', postId);

        setPosts(prev => prev.map(post => 
          post.id === postId 
            ? { ...post, shares_count: post.shares_count + 1 }
            : post
        ));
      }

      toast({
        title: "Link Copied!",
        description: "Post link with your referral code copied to clipboard."
      });
    } catch (error) {
      console.error("Error sharing:", error);
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
            Community Feed
          </h2>
          <p className="text-muted-foreground">
            Connect, share insights, and learn from other members
          </p>
        </motion.div>

        <div className="max-w-2xl mx-auto space-y-4">
          {/* Post Composer */}
          {user ? (
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
                        placeholder="Share your thoughts, ask questions, or share investment insights..."
                        className="resize-none min-h-[80px]"
                      />
                      <div className="flex justify-between items-center">
                        <Button variant="ghost" size="sm" disabled>
                          <Image className="w-4 h-4 mr-2" />
                          Photo
                        </Button>
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
                <Lock className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-muted-foreground mb-3">Login to post and engage with the community</p>
                <Link to="/auth?mode=login">
                  <Button variant="default" size="sm">Login to Post</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Posts Feed */}
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
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No posts yet. Be the first to share!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {posts.map((post, index) => (
                <motion.div
                  key={post.id}
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
                          <p className="text-sm text-foreground mb-3 whitespace-pre-wrap">
                            {post.content}
                          </p>
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
                            <button 
                              onClick={() => handleShare(post.id)}
                              className="flex items-center gap-1 text-xs hover:text-primary transition-colors"
                            >
                              <Share2 className="w-4 h-4" />
                              {post.shares_count || 0}
                            </button>
                          </div>

                          {/* Comments Section */}
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
                                        <p className="text-sm">{comment.content}</p>
                                      </div>
                                    </div>
                                  ))
                                )}

                                {/* Add Comment */}
                                {user ? (
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

          {/* View All Link */}
          <div className="text-center pt-4">
            <Link to="/community">
              <Button variant="outline">
                View All Posts
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CommunitySection;
