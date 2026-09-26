import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { 
  Users, 
  MessageSquare, 
  Heart, 
  Share2, 
  PlusCircle,
  Filter,
  Loader2,
  Send,
  FileText,
  Facebook,
  Twitter,
  Linkedin,
  MessageCircle,
  Copy,
  Mail,
  Play,
  X,
  Trash2,
  Banknote,
  Briefcase,
  Handshake,
  Rocket,
  GraduationCap,
  Calendar,
  Megaphone,
  Tag,
  Search,
  AlertTriangle,
  RefreshCw,
  Leaf,
  TrendingUp
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateVideoThumbnail, updateShareOGTags } from "@/lib/utils";
import { postShareText, isAiwcCategory } from "@/lib/share";
import { parseVideoLink, attachmentThumbnail } from "@/lib/video";
import { attachThumbnailToUpload, backfillVideoThumbnail, storedThumbnailFor } from "@/lib/videoThumbnail";
import {
  DEFAULT_CATEGORIES,
  LEGACY_ENUM_CATEGORIES,
  ENUM_SAFE_CATEGORY,
  isCategoryValueError,
  isCategoryColumnStillEnum,
  loadPostCategories,
  pickStorableCategory,
  reconcileCategory,
  type Category,
} from "@/lib/categories";
import { LinkifiedText } from "@/lib/LinkifiedText";

const sendNotification = (payload: Record<string, unknown>) => {
  supabase.functions.invoke('send-notification', { body: payload }).catch(() => {});
};

/** navigator.clipboard needs a secure context; fall back to execCommand. */
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Banknote, Briefcase, Handshake, Rocket, GraduationCap, Calendar, Megaphone, MessageSquare, Tag, Search,
  Users, Heart, Share2, Filter, Leaf, TrendingUp, AlertTriangle
};

interface Post {
  id: string;
  author_id: string;
  content: string;
  category: string;
  attachment_url: string | null;
  attachment_type: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
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

const Community = () => {
  const [searchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostCategory, setNewPostCategory] = useState<string>("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [videoLink, setVideoLink] = useState("");
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  // One poster lookup per post, ever. Without this the effect re-runs whenever
  // thumbnails change and re-issues a HEAD for every video on the page.
  const posterChecks = useRef<Set<string>>(new Set());
  const [playingVideos, setPlayingVideos] = useState<Set<string>>(new Set());
  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const [commentsMap, setCommentsMap] = useState<Record<string, Comment[]>>({});
  const [newCommentMap, setNewCommentMap] = useState<Record<string, string>>({});
  const [sharePostId, setSharePostId] = useState<string | null>(null);
  const [changeCategoryPostId, setChangeCategoryPostId] = useState<string | null>(null);
  const [newCategoryValue, setNewCategoryValue] = useState<string>("");
  const [communityStats, setCommunityStats] = useState({
    totalMembers: 0,
    totalPosts: 0,
    activeToday: 0,
  });
  const { toast } = useToast();
  const { user, profile, roles } = useAuth();

  const isAdmin = roles?.includes('admin') || profile?.assigned_role === 'admin';

  // Set when a post had to be filed under a legacy enum value because
  // posts.category has not been converted to TEXT yet (migration
  // 20260911000000). Treated as a hint only - `categoryStillEnum` is the
  // source of truth, so the banner disappears as soon as the database is
  // fixed rather than lingering until the next successful post.
  const [categoryStillEnum, setCategoryStillEnum] = useState(false);
  const [needsCategoryMigration, setNeedsCategoryMigration] = useState(false);

  const markCategoryMigrationNeeded = useCallback((value: boolean) => {
    setNeedsCategoryMigration(value);
    if (value) setCategoryStillEnum(true);
    try {
      if (value) localStorage.setItem("investours_category_migration_pending", "1");
      else localStorage.removeItem("investours_category_migration_pending");
    } catch {
      /* private mode - warning just won't persist */
    }
  }, []);

  /**
   * The category list the UI actually offers and filters by.
   *
   * While `posts.category` is still the enum this falls back to the seven
   * values the database will accept, so a chosen category is always storable
   * and existing posts remain reachable through a filter. Once the migration
   * lands the admin-managed list takes over automatically.
   */
  const activeCategories = categoryStillEnum ? LEGACY_ENUM_CATEGORIES : categories;

  const fetchCategories = async () => {
    const loaded = await loadPostCategories();
    setCategories(loaded);
    // "general" is the traditional default but is admin-defined and often
    // absent, so the remembered value is reconciled against what loaded. This
    // also covers an admin renaming or deactivating it while the page is open.
    setNewPostCategory((prev) => reconcileCategory(prev, loaded));
  };

  /**
   * Is posts.category still the old post_category enum?
   *
   * Filtering on a real admin category name is a cheap, read-only way to ask:
   * Postgres binds the value to the column type before RLS or row filtering,
   * so an enum column rejects 'funding_grants' with 22P02 while a TEXT column
   * simply returns no rows. That makes the warning self-verifying instead of
   * depending on someone posting again after the migration.
   */
  const checkCategoryColumn = useCallback(async () => {
    const stillEnum = await isCategoryColumnStillEnum(categories);
    setCategoryStillEnum(stillEnum);
    if (!stillEnum) markCategoryMigrationNeeded(false);
  }, [categories, markCategoryMigrationNeeded]);

  const fetchPosts = async () => {
    try {
      setIsLoading(true);
      const { data: postsData, error } = await supabase
        .from('posts')
        .select('*')
        .eq('is_approved', true)
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
          .from('post_likes')
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
      console.error('Error fetching posts:', error);
      toast({
        title: "Error loading posts",
        description: "Failed to load community posts. Please refresh.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { count: membersCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      const { count: postsCount } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true });

      setCommunityStats({
        totalMembers: membersCount || 0,
        totalPosts: postsCount || 0,
        activeToday: Math.floor((membersCount || 0) * 0.1),
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  useEffect(() => {
    fetchPosts();
    fetchStats();
    fetchCategories();
    // Verifies whether posts.category is still an enum, so the warning banner
    // reflects the real database state rather than a remembered flag.
    void checkCategoryColumn();

    const channel = supabase
      .channel('posts-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'posts'
      }, () => {
        fetchPosts();
      })
      // Reorder / rename / activate categories from the admin dashboard and
      // have the filter row follow along without a reload.
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'post_categories'
      }, () => {
        fetchCategories();
      })
      .subscribe();

    // Realtime needs post_categories in the supabase_realtime publication
    // (migration 20260911000000). Refetching whenever the tab becomes visible
    // covers the case where it isn't published yet, and also catches admin
    // edits made from another device.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchCategories();
        fetchPosts();
        // Re-check on focus: catches the migration being applied while the tab
        // was in the background, so the banner clears without a hard reload.
        void checkCategoryColumn();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const postId = searchParams.get("post");
    if (postId && posts.length > 0) {
      const post = posts.find((p) => p.id === postId);
      if (post) {
        const shareUrl = `${window.location.origin}/community?post=${postId}`;
        updateShareOGTags({
          title: `${post.author?.full_name || "Investours Member"} shared a post`,
          description: post.content.substring(0, 200),
          image: post.attachment_type === "image" ? post.attachment_url : undefined,
          url: shareUrl,
        });

        // Scroll to the exact post after a short delay for rendering
        setTimeout(() => {
          const el = document.getElementById(`post-${postId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // Brief highlight effect
            el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
            setTimeout(() => {
              el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
            }, 3000);
          }
        }, 500);
      }
    }
  }, [searchParams, posts]);

  useEffect(() => {
    posts.forEach((post) => {
      if (post.attachment_type !== "video" || !post.attachment_url) return;
      if (videoThumbnails[post.id] || posterChecks.current.has(post.id)) return;
      posterChecks.current.add(post.id);

      // Link-based videos already have a poster derived from their URL, so
      // there is nothing to grab from the browser here.
      if (parseVideoLink(post.attachment_url)?.thumbnailUrl) return;

      void (async () => {
        // Prefer the stored frame: it is the same image the share preview
        // will use, and it costs one HEAD instead of a decode.
        const stored = await storedThumbnailFor(post.attachment_url!);
        if (stored) {
          setVideoThumbnails((prev) => ({ ...prev, [post.id]: stored }));
          return;
        }

        // Videos uploaded before frames were stored have none. The author can
        // generate one for themselves on sight; anyone else only gets a frame
        // in-browser for the card, never a write to storage.
        if (user && post.author_id === user.id) {
          const backfilled = await backfillVideoThumbnail(post.attachment_url!);
          if (backfilled) {
            setVideoThumbnails((prev) => ({ ...prev, [post.id]: backfilled }));
            fetchPosts();
            return;
          }
        }

        const frame = await generateVideoThumbnail(post.attachment_url!);
        if (frame) setVideoThumbnails((prev) => ({ ...prev, [post.id]: frame }));
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, user]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const maxSize = isVideo ? MAX_VIDEO_SIZE : isImage ? MAX_IMAGE_SIZE : 10 * 1024 * 1024;
      const label = isVideo ? "Videos" : isImage ? "Images" : "Files";

      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `${label} must be under ${(maxSize / 1024 / 1024).toFixed(0)}MB`,
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
    if (!user) {
      toast({ title: "Login Required", description: "Please login to create a post." });
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

      // A pasted video link wins over an uploaded file: it is what the
      // creator asked for, and a poster frame can still be derived from it.
      const linkedVideo = videoLink.trim() ? parseVideoLink(videoLink.trim()) : null;
      const linkRejected = Boolean(videoLink.trim()) && !linkedVideo;

      if (linkRejected) {
        toast({
          title: "Unrecognised video link",
          description: "Paste a YouTube, Vimeo or direct video-file link (https://...).",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (linkedVideo) {
        attachmentUrl = linkedVideo.url;
        attachmentType = 'video';
      } else if (selectedFile) {
        try {
          const fileExt = selectedFile.name.split('.').pop();
          const filePath = `${user.id}/post-attachments/${Date.now()}.${fileExt}`;

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

            // An uploaded file has no poster frame the way a YouTube link does.
            // Capture one now and store it beside the video, otherwise this post
            // shares with a generic image forever.
            if (attachmentType === 'video') {
              await attachThumbnailToUpload(selectedFile, filePath);
            }
          }
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          toast({ title: "Upload Failed", description: "Failed to upload file. You can still post without it.", variant: "destructive" });
          attachmentUrl = null;
          attachmentType = null;
        }
      }

      // An admin can deactivate the category the composer last used, which
      // would silently post under a category that isn't in the filter list.
      const category = pickStorableCategory(newPostCategory, activeCategories);

      const insertPost = async (postCategory: string, url: string | null, type: string | null) =>
        supabase.from('posts').insert({
          author_id: user.id,
          content: newPostContent.trim(),
          category: postCategory,
          attachment_url: url,
          attachment_type: type,
          is_approved: true
        });

      let usedCategory = category;
      let result = await insertPost(category, attachmentUrl, attachmentType);

      if (result.error) {
        console.error('Post insert failed:', result.error);

        // posts.category was originally the post_category enum, which only
        // accepts ('education','finance','climate','investment','advert',
        // 'scam_alert','announcement'). Until the column is converted to TEXT,
        // the admin category names are rejected outright. Retry with a value
        // that is valid under both the old enum and the new TEXT column so the
        // post still goes through.
        if (isCategoryValueError(result.error) && category !== ENUM_SAFE_CATEGORY) {
          const retry = await insertPost(ENUM_SAFE_CATEGORY, attachmentUrl, attachmentType);
          if (!retry.error) {
            usedCategory = ENUM_SAFE_CATEGORY;
            result = retry;
            // Remember it, so a persistent warning shows instead of every post
            // quietly disappearing into the wrong category.
            markCategoryMigrationNeeded(true);
            toast({
              title: "Posted under Finance",
              description: "Categories need a database update before your chosen one can be used.",
            });
          }
        }
      }

      if (result.error) {
        // Surface the real reason (RLS, invalid column, enum, FK...) instead of
        // a bare "posting error".
        throw new Error(`${result.error.message} (${result.error.code ?? 'no code'})`);
      }

      // A post went through under its chosen category, so the enum conversion
      // has clearly been applied - retire the warning.
      if (usedCategory === category) {
        markCategoryMigrationNeeded(false);
      }

      toast({ title: "Success!", description: "Your post has been published." });

      setNewPostContent("");
      setNewPostCategory(usedCategory);
      setSelectedFile(null);
      setFilePreview(null);
      setVideoLink("");
      setIsCreateOpen(false);
      fetchPosts();
    } catch (error) {
      console.error('Error creating post:', error);
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to create post. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!isAdmin) return;
    if (!confirm("Are you sure you want to delete this post?")) return;

    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      toast({ title: "Deleted", description: "Post has been deleted." });
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (error) {
      console.error('Error deleting post:', error);
      toast({ title: "Error", description: "Failed to delete post.", variant: "destructive" });
    }
  };

  const handleChangeCategory = async (postId: string, category: string) => {
    try {
      const { error } = await supabase.from('posts').update({ category }).eq('id', postId);
      if (error) throw error;
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, category } : p));
      toast({ title: "Category Updated" });
      setChangeCategoryPostId(null);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update category.", variant: "destructive" });
    }
  };

  const handleLike = async (postId: string, isLiked: boolean) => {
    if (!user) {
      toast({ title: "Login Required", description: "Please login to like posts.", variant: "destructive" });
      return;
    }

    const post = posts.find(p => p.id === postId);
    const nextLiked = !isLiked;

    // Optimistic update for a snappy UI. posts.likes_count is owned by a
    // database trigger (20260910000000), so the next fetch is the truth.
    setPosts(prev => prev.map(p =>
      p.id === postId
        ? {
            ...p,
            user_liked: nextLiked,
            likes_count: Math.max(0, (p.likes_count || 0) + (nextLiked ? 1 : -1)),
          }
        : p
    ));

    try {
      // Supabase resolves with { error } rather than throwing, so the error
      // has to be inspected explicitly or a rejected write looks successful.
      const { error } = nextLiked
        ? await supabase.from('post_likes').insert({ post_id: postId, user_id: user.id })
        : await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);

      if (error) throw error;

      // Notify post author (fire-and-forget, skip if liking own post)
      if (nextLiked && post && post.author_id !== user.id) {
        sendNotification({
          type: 'post_liked',
          recipient_id: post.author_id,
          actor_name: profile?.full_name || 'Someone',
          post_id: postId,
          post_preview: post.content,
        });
      }
    } catch (error) {
      console.error('Error toggling like:', error);
      // Roll the optimistic change back so the UI matches the database.
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? {
              ...p,
              user_liked: isLiked,
              likes_count: Math.max(0, (p.likes_count || 0) + (nextLiked ? -1 : 1)),
            }
          : p
      ));
      toast({
        title: "Couldn't update like",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleShare = async (postId: string, platform: string) => {
    const post = posts.find(p => p.id === postId);
    const ref = profile?.referral_code ? `&ref=${profile.referral_code}` : "";
    // shareUrl hits the OG-image endpoint for rich previews; pageUrl is the
    // plain in-app link, used wherever an API route can't be relied on.
    const shareUrl = `${window.location.origin}/api/share?post=${postId}${ref}`;
    const pageUrl = `${window.location.origin}/community?post=${postId}${ref}`;
    // AIWC competition entries carry the full pitch; other posts keep the
    // short "check this out" summary. The label is checked too, so an entry is
    // recognised whichever way the admin named the category.
    const isAiwc =
      isAiwcCategory(post?.category) || isAiwcCategory(getCategoryLabel(post?.category));
    const shareText = postShareText(post, pageUrl, getCategoryLabel(post?.category));

    try {
      // Record the share before opening the window: a popup blocker must not
      // cost us the metric, and the insert is fire-and-forget either way.
      if (user) {
        const { error: shareError } = await supabase
          .from('post_shares')
          .insert({ post_id: postId, user_id: user.id, platform });
        if (shareError) console.error('Failed to record share:', shareError);
      }

      switch (platform) {
        case 'facebook':
          // `quote` is what puts the pitch into the composed post; passing only
          // the URL would show nothing but the link preview.
          window.open(
            `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`,
            'facebook-share', 'width=600,height=400'
          );
          break;
        case 'twitter':
          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, 'twitter-share', 'width=600,height=400');
          break;
        case 'linkedin':
          // LinkedIn's share endpoint accepts no prefilled text, so put the
          // message on the clipboard first and explain the paste.
          if (isAiwc) {
            await copyToClipboard(shareText);
            window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, 'linkedin-share', 'width=600,height=400');
            toast({
              title: "Copied for LinkedIn",
              description: "Paste it into your post — LinkedIn accepts no prefilled text.",
            });
          } else {
            window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, 'linkedin-share', 'width=600,height=400');
          }
          break;
        case 'whatsapp':
          window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, 'whatsapp-share');
          break;
        case 'email':
          window.location.href = `mailto:?subject=Check this out from Investours&body=${encodeURIComponent(shareText)}`;
          break;
        case 'native':
          // Mobile share sheet; must be called directly from the click handler.
          if (navigator.share) {
            await navigator.share({ title: "Investours Opportunity Hub", text: shareText, url: shareUrl });
          } else {
            await copyToClipboard(shareText);
            toast({ title: "Copied!", description: "Post and link copied to clipboard." });
          }
          break;
        case 'copy':
        default:
          // A competition entry has to leave with the pitch, so copy the whole
          // message rather than a bare URL. Other posts stay link-only.
          await copyToClipboard(isAiwc ? shareText : pageUrl);
          toast({
            title: "Copied!",
            description: isAiwc
              ? "The competition pitch and link are on your clipboard."
              : "Link copied to clipboard.",
          });
          break;
      }

      setSharePostId(null);
    } catch (error) {
      // A cancelled native share sheet throws AbortError; that is not a fault.
      if (error instanceof DOMException && error.name === "AbortError") {
        setSharePostId(null);
        return;
      }
      console.error('Error sharing:', error);
      toast({ title: "Error", description: "Failed to share post.", variant: "destructive" });
    }
  };

  const fetchComments = async (postId: string) => {
    try {
      const { data, error } = await supabase
        .from('post_comments')
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
    if (!user) {
      toast({ title: "Login Required", description: "Please login to comment.", variant: "destructive" });
      return;
    }

    const newComment = (newCommentMap[postId] || "").trim();
    if (!newComment) return;

    try {
      const { error } = await supabase
        .from('post_comments')
        .insert({ post_id: postId, author_id: user.id, content: newComment });
      if (error) throw error;

      setNewCommentMap(prev => ({ ...prev, [postId]: "" }));
      fetchComments(postId);
      // posts.comments_count is owned by a database trigger; just reflect it.
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p));
      // Notify post author (skip if commenting on own post)
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
      toast({
        title: "Couldn't post comment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive"
      });
    }
  };

  const filteredPosts = activeCategory === "all" 
    ? posts 
    : posts.filter(post => post.category === activeCategory);

  const getCategoryColor = (category: string) => {
    const cat = activeCategories.find(c => c.name === category);
    return cat?.color || "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";
  };

  const getCategoryLabel = (category: string) => {
    const cat = activeCategories.find(c => c.name === category);
    return cat?.label || category.replace(/_/g, " ");
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 md:pt-32 pb-16">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                  Investours Opportunity Hub
                </h1>
                <p className="text-muted-foreground">
                  Growth Community for Opportunities, Grants, Funding, Partnerships, Mentorship, Jobs & Gigs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={!user}>
                      <PlusCircle className="w-4 h-4 mr-2" />
                      Create Post
                    </Button>
                  </DialogTrigger>
                  {user && (
                    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Create a Post</DialogTitle>
                        <DialogDescription>Share your thoughts with the community</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="category">Category</Label>
                          <Select value={newPostCategory} onValueChange={setNewPostCategory}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {activeCategories.filter(c => c.name !== 'all').map(cat => (
                                <SelectItem key={cat.name} value={cat.name}>{cat.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="content">Content</Label>
                          <Textarea id="content" value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)} placeholder="What's on your mind?" className="min-h-[150px]" />
                        </div>
                        <div>
                          <Label htmlFor="video-link">
                            Video link <span className="font-normal text-muted-foreground">(optional)</span>
                          </Label>
                          <p className="text-xs text-muted-foreground mb-1">
                            YouTube, Vimeo or a direct video file URL. Takes priority over the upload below.
                          </p>
                          <Input
                            id="video-link"
                            type="url"
                            inputMode="url"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={videoLink}
                            onChange={(e) => {
                              const value = e.target.value;
                              setVideoLink(value);
                              // A link and an upload are mutually exclusive, and
                              // the poster frame is derived from the URL.
                              setLinkPreview(parseVideoLink(value.trim())?.thumbnailUrl ?? null);
                              if (value.trim()) {
                                setSelectedFile(null);
                                setFilePreview(null);
                              }
                            }}
                            disabled={isSubmitting}
                          />
                          {videoLink.trim() && !parseVideoLink(videoLink.trim()) && (
                            <p className="mt-1 text-xs text-destructive">
                              That does not look like a video link yet.
                            </p>
                          )}
                          {linkPreview && (
                            <div className="relative mt-2 rounded-lg overflow-hidden border">
                              <img
                                src={linkPreview}
                                alt="Video preview"
                                className="w-full max-h-48 object-cover"
                                onError={() => setLinkPreview(null)}
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <Play className="w-6 h-6 text-foreground ml-0.5" />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div>
                          <Label htmlFor="file">
                            Attachment <span className="font-normal text-muted-foreground">(optional)</span>
                          </Label>
                          <p className="text-xs text-muted-foreground mb-1">Images max 3MB, Videos max 5MB</p>
                          <Input id="file" type="file" accept="image/*,video/*,.pdf" onChange={handleFileSelect} disabled={isSubmitting || Boolean(videoLink.trim())} />
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
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{communityStats.totalMembers.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Members</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{communityStats.totalPosts.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Posts</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Category setup warning. Driven by the live probe result, not by a
                remembered flag, so it disappears as soon as the DB is fixed. */}
            {categoryStillEnum && (
              <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="flex-1">
                  <strong>Confirmed:</strong> <code className="font-mono">posts.category</code> is
                  still the old <code className="font-mono">post_category</code> enum, so only its
                  original categories can be used. Posting and filtering are working with those now.
                  Run{" "}
                  <code className="font-mono">20260911000000_fix_posts_category_enum.sql</code> to
                  switch to your own categories from the admin dashboard.
                  {isAdmin && " You can run it from the Supabase SQL editor."}
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkCategoryColumn()}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Re-check
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markCategoryMigrationNeeded(false)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            {/* Category Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              {activeCategories.map((cat) => {
                const IconComponent = ICON_MAP[cat.icon] || Tag;
                return (
                  <Button
                    key={cat.id}
                    variant={activeCategory === cat.name ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveCategory(cat.name)}
                    className="flex-shrink-0"
                  >
                    <IconComponent className="w-4 h-4 mr-1" />
                    {cat.label}
                  </Button>
                );
              })}
            </div>
          </motion.div>

          {/* Posts Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main Feed */}
            <div className="lg:col-span-2 space-y-4">
              {isLoading ? (
                <Card>
                  <CardContent className="py-12 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </CardContent>
                </Card>
              ) : filteredPosts.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No posts yet</h3>
                    <p className="text-muted-foreground mb-4">Be the first to share something!</p>
                    {user && (
                      <Button onClick={() => setIsCreateOpen(true)}>
                        <PlusCircle className="w-4 h-4 mr-2" />
                        Create Post
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                filteredPosts.map((post) => (
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
                                {post.author?.country || "Member"} • {formatTimeAgo(post.created_at)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isAdmin && changeCategoryPostId === post.id ? (
                              <div className="flex items-center gap-1">
                                <Select value={newCategoryValue || post.category} onValueChange={setNewCategoryValue}>
                                  <SelectTrigger className="h-7 text-xs w-28 max-w-[9rem] min-w-0"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {activeCategories.filter(c => c.name !== 'all').map(cat => (
                                      <SelectItem key={cat.name} value={cat.name}>{cat.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleChangeCategory(post.id, newCategoryValue || post.category)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setChangeCategoryPostId(null)}>✕</Button>
                              </div>
                            ) : (
                              <Badge
                                className={`${getCategoryColor(post.category)} ${isAdmin ? 'cursor-pointer hover:opacity-80' : ''}`}
                                onClick={() => { if (isAdmin) { setChangeCategoryPostId(post.id); setNewCategoryValue(post.category); } }}
                                title={isAdmin ? 'Click to change category' : undefined}
                              >
                                {getCategoryLabel(post.category).toUpperCase()}
                              </Badge>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeletePost(post.id)}
                                title="Delete post"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Post Content */}
                        <div className="text-foreground mb-4 leading-relaxed whitespace-pre-wrap">
                          <LinkifiedText text={post.content || ""} />
                        </div>

                        {/* Attachment */}
                        {post.attachment_url && post.attachment_type === 'image' && (
                          <div className="mb-4 rounded-lg overflow-hidden">
                            <img 
                              src={post.attachment_url} 
                              alt="Post" 
                              className="w-full object-cover max-h-96"
                            />
                          </div>
                        )}

                        {post.attachment_url && post.attachment_type === 'video' && (() => {
                          // A pasted link renders as an embedded player behind its
                          // poster frame; an uploaded file uses a <video> element.
                          const linked = parseVideoLink(post.attachment_url);
                          const poster = linked?.thumbnailUrl ?? videoThumbnails[post.id];
                          const isPlaying = playingVideos.has(post.id);

                          if (linked && linked.provider !== 'file') {
                            return (
                              <div className="mb-4 aspect-video w-full overflow-hidden rounded-lg bg-black">
                                {isPlaying ? (
                                  <iframe
                                    src={linked.embedUrl}
                                    title="Embedded video"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                    className="h-full w-full border-0"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPlayingVideos(prev => new Set([...prev, post.id]))}
                                    className="group relative block h-full w-full"
                                  >
                                    {poster && (
                                      <img
                                        src={poster}
                                        alt="Video thumbnail"
                                        className="h-full w-full object-cover"
                                      />
                                    )}
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
                                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 transition-transform group-hover:scale-110">
                                        <Play className="ml-1 h-7 w-7 text-foreground" />
                                      </span>
                                    </span>
                                  </button>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div className="mb-4 rounded-lg overflow-hidden bg-black relative">
                              {poster && !isPlaying && (
                                <div
                                  className="relative cursor-pointer"
                                  onClick={() => setPlayingVideos(prev => new Set([...prev, post.id]))}
                                >
                                  <img
                                    src={poster}
                                    alt="Video thumbnail"
                                    className="w-full object-cover max-h-96"
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors">
                                    <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center hover:scale-110 transition-transform">
                                      <Play className="w-8 h-8 text-foreground ml-1" />
                                    </div>
                                  </div>
                                </div>
                              )}
                              <video
                                src={post.attachment_url}
                                controls
                                autoPlay={isPlaying}
                                className={`w-full max-h-96 ${!isPlaying && poster ? 'hidden' : ''}`}
                              />
                            </div>
                          );
                        })()}

                        {post.attachment_url && post.attachment_type === 'document' && (
                          <div className="mb-4 p-3 bg-secondary rounded-lg flex items-center gap-2">
                            <FileText className="w-6 h-6 text-primary" />
                            <a 
                              href={post.attachment_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline flex-1"
                            >
                              Download Document
                            </a>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-4 border-t border-border">
                          <div className="flex items-center gap-4 text-sm">
                            <button 
                              onClick={() => {
                                if (!user) { toast({ title: "Login Required", description: "Please sign up or login to love posts.", action: undefined }); return; }
                                handleLike(post.id, post.user_liked || false);
                              }}
                              className={`flex items-center gap-1 transition-colors ${
                                post.user_liked ? 'text-red-500' : 'text-muted-foreground hover:text-red-500'
                              }`}
                            >
                              <Heart className={`w-4 h-4 ${post.user_liked ? 'fill-current' : ''}`} />
                              {post.likes_count || 0}
                            </button>
                            <button 
                              onClick={() => {
                                if (!user) { toast({ title: "Login Required", description: "Please sign up or login to comment.", action: undefined }); return; }
                                setSelectedPost(selectedPost === post.id ? null : post.id);
                                if (selectedPost !== post.id) fetchComments(post.id);
                              }}
                              className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <MessageSquare className="w-4 h-4" />
                              {post.comments_count || 0}
                            </button>
                            
                            {/* Share Button with Dialog */}
                            <Dialog open={sharePostId === post.id} onOpenChange={(open) => setSharePostId(open ? post.id : null)}>
                              <DialogTrigger asChild>
                                <button 
                                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                >
                                  <Share2 className="w-4 h-4" />
                                  Share
                                </button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Share This Post</DialogTitle>
                                  <DialogDescription>
                                    Share on your favorite platform
                                  </DialogDescription>
                                </DialogHeader>
                                {(() => {
                                  const sharePost = posts.find((p) => p.id === post.id);
                                  if (!sharePost) return null;
                                  // Image posts use their own picture. Video posts
                                  // use a poster derived from the link, or the frame
                                  // grabbed in-browser for an uploaded file.
                                  const isVideo = sharePost.attachment_type === "video";
                                  const preview = attachmentThumbnail(
                                    sharePost.attachment_url,
                                    sharePost.attachment_type,
                                  ) ?? (isVideo ? videoThumbnails[sharePost.id] ?? null : null);
                                  if (!preview) return null;
                                  return (
                                    <div className="relative rounded-lg overflow-hidden mb-2 border">
                                      <img src={preview} alt={isVideo ? "Video" : "Post"} className="w-full max-h-32 object-cover" />
                                      {isVideo && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                          <Play className="w-6 h-6 text-white" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                <div className="grid grid-cols-2 gap-3 py-4">
                                  {typeof navigator !== "undefined" && "share" in navigator && (
                                    <Button variant="outline" className="col-span-2 flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'native')}>
                                      <Share2 className="w-5 h-5" /><span>Share via device</span>
                                    </Button>
                                  )}
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'facebook')}>
                                    <Facebook className="w-5 h-5" /><span>Facebook</span>
                                  </Button>
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'twitter')}>
                                    <Twitter className="w-5 h-5" /><span>Twitter</span>
                                  </Button>
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'linkedin')}>
                                    <Linkedin className="w-5 h-5" /><span>LinkedIn</span>
                                  </Button>
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'whatsapp')}>
                                    <MessageCircle className="w-5 h-5" /><span>WhatsApp</span>
                                  </Button>
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'email')}>
                                    <Mail className="w-5 h-5" /><span>Email</span>
                                  </Button>
                                  <Button variant="outline" className="flex items-center justify-center gap-2" onClick={() => handleShare(post.id, 'copy')}>
                                    <Copy className="w-5 h-5" />
                                    <span>
                                      {isAiwcCategory(post.category) ||
                                      isAiwcCategory(getCategoryLabel(post.category))
                                        ? "Copy pitch + link"
                                        : "Copy Link"}
                                    </span>
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </div>

                        {/* Comments */}
                        {selectedPost === post.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-4 pt-4 border-t space-y-3"
                          >
                            {(commentsMap[post.id] || []).map(comment => (
                              <div key={comment.id} className="flex gap-2">
                                <Avatar className="w-7 h-7">
                                  <AvatarImage src={comment.author?.avatar_url || undefined} />
                                  <AvatarFallback className="text-xs">
                                    {comment.author?.full_name?.charAt(0) || "U"}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 bg-secondary/50 rounded p-2">
                                  <p className="text-xs font-medium text-foreground">
                                    {comment.author?.full_name || "Anonymous"}
                                    <span className="text-muted-foreground ml-2">{formatTimeAgo(comment.created_at)}</span>
                                  </p>
                                  <p className="text-sm text-foreground"><LinkifiedText text={comment.content} /></p>
                                </div>
                              </div>
                            ))}
                            
                            {user && (
                              <div className="flex gap-2 mt-2">
                                <Input
                                  value={newCommentMap[post.id] || ""}
                                  onChange={(e) => setNewCommentMap(prev => ({ ...prev, [post.id]: e.target.value }))}
                                  placeholder="Add a comment..."
                                  className="text-sm"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddComment(post.id);
                                    }
                                  }}
                                />
                                <Button 
                                  size="sm"
                                  onClick={() => handleAddComment(post.id)}
                                  disabled={!(newCommentMap[post.id] || "").trim()}
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Stats
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Today</span>
                    <span className="font-semibold">{communityStats.activeToday}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Posts</span>
                    <span className="font-semibold">{communityStats.totalPosts}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Join CTA */}
              {!user && (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <h3 className="font-semibold mb-2">Join the Opportunity Hub</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Sign up to create posts and engage with other members.
                    </p>
                    <Link to="/signup">
                      <Button className="w-full">Sign Up</Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Community;
