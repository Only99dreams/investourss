import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Heart, MessageCircle, Share2, Lock, Send, Image, ChevronDown, ChevronUp, FileText, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn, generateVideoThumbnail, updateShareOGTags } from "@/lib/utils";
import { postShareText, isAiwcCategory } from "@/lib/share";
import { parseVideoLink, isHttpUrl, isPdfUrl, attachmentThumbnail } from "@/lib/video";
import { attachThumbnailToUpload, backfillVideoThumbnail, storedThumbnailFor } from "@/lib/videoThumbnail";
import {
  attachPdfThumbnailToUpload,
  backfillPdfThumbnail,
  generatePdfThumbnail,
  storedPdfThumbnailFor,
} from "@/lib/pdfThumbnail";
import {
  buildShareUrl,
  castVote,
  fetchMyVotes,
  fetchVotingPower,
  type VotingPower,
} from "@/lib/voting";
import { VoteButton } from "@/components/community/VoteButton";
import { VoteCheckoutDialog } from "@/components/community/VoteCheckoutDialog";
import { PostAsMemberPicker, type PostAsMember } from "@/components/community/PostAsMemberPicker";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LinkifiedText } from "@/lib/LinkifiedText";

interface Post {
  id: string;
  content: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  votes_count: number;
  author_id: string;
  category: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
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

const MAX_PDF_SIZE = 20 * 1024 * 1024;

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const CommunitySection = () => {
  const { user, profile, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  // Admins can publish on behalf of another member. Null means "post as me".
  const [postingAs, setPostingAs] = useState<PostAsMember | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [postComments, setPostComments] = useState<Record<string, Comment[]>>({});
  const [newComments, setNewComments] = useState<Record<string, string>>({});
  const [loadingComments, setLoadingComments] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [videoLink, setVideoLink] = useState("");
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
  // Ebook Track entries use the post's single attachment slot. These mirror the
  // community page so a competition entry looks the same wherever it is filed.
  const [ebookFile, setEbookFile] = useState<File | null>(null);
  const [ebookLink, setEbookLink] = useState("");
  const [ebookPreview, setEbookPreview] = useState<string | null>(null);
  const [ebookPreviewLoading, setEbookPreviewLoading] = useState(false);
  // This composer used to hardcode 'finance', so every post made from the home
  // page landed in Finance no matter what it was about.
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [categoryStillEnum, setCategoryStillEnum] = useState(false);
  const [newPostCategory, setNewPostCategory] = useState<string>("general");
  const [videoThumbnails, setVideoThumbnails] = useState<Record<string, string>>({});
  const [pdfThumbnails, setPdfThumbnails] = useState<Record<string, string>>({});
  // One poster lookup per post, ever, so changing thumbnails does not re-HEAD
  // every video on the page.
  const posterChecks = useRef<Set<string>>(new Set());
  const pdfChecks = useRef<Set<string>>(new Set());
  const [playingVideos, setPlayingVideos] = useState<Set<string>>(new Set());
  const [votingPower, setVotingPower] = useState<VotingPower | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, number>>({});
  const [votingPostId, setVotingPostId] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { toast } = useToast();

  /**
   * The category list the composer offers. While `posts.category` is still the
   * old enum this falls back to the seven values the database will accept, so
   * whatever the user picks is always storable. Mirrors the community page.
   */
  const activeCategories = categoryStillEnum ? LEGACY_ENUM_CATEGORIES : categories;

  // The Ebook Track only applies to the Creativity & Enterprise Challenge
  // categories, so its PDF field stays out of ordinary posts. Match the label as
  // well as the slug: an admin may file the challenge under a custom name.
  const selectedCategoryLabel = activeCategories.find((c) => c.name === newPostCategory)?.label;
  const showEbookEntry =
    isAiwcCategory(newPostCategory) || isAiwcCategory(selectedCategoryLabel);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadPostCategories();
      if (cancelled) return;
      setCategories(loaded);
      // "general" is the traditional default but is admin-defined and often
      // absent, so the remembered value is reconciled against what loaded.
      setNewPostCategory((prev) => reconcileCategory(prev, loaded));
      setCategoryStillEnum(await isCategoryColumnStillEnum(loaded));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchPosts();
    if (user) {
      fetchUserLikes();
      void fetchVotingPower().then(setVotingPower);
    } else {
      setVotingPower(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const postId = searchParams.get("post");
    if (postId && posts.length > 0) {
      const post = posts.find((p) => p.id === postId);
      if (post) {
        const shareUrl = buildShareUrl(postId);
        const sharePreview =
          post.attachment_type === "image"
            ? post.attachment_url
            : videoThumbnails[post.id] ??
              pdfThumbnails[post.id] ??
              attachmentThumbnail(post.attachment_url, post.attachment_type) ??
              undefined;
        updateShareOGTags({
          title: `${post.profiles?.full_name || "Investours Member"} shared a post`,
          description: post.content.substring(0, 200),
          image: sharePreview,
          url: shareUrl,
        });

        setTimeout(() => {
          const el = document.getElementById(`post-${postId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
            setTimeout(() => {
              el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-lg");
            }, 3000);
          }
        }, 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, posts]);

  useEffect(() => {
    posts.forEach((post) => {
      if (post.attachment_type !== "video" || !post.attachment_url) return;
      if (videoThumbnails[post.id] || posterChecks.current.has(post.id)) return;
      posterChecks.current.add(post.id);

      // Link-based videos already carry a poster derived from their URL.
      if (parseVideoLink(post.attachment_url)?.thumbnailUrl) return;

      void (async () => {
        // Prefer the stored frame: same image the share preview will use, and
        // one HEAD instead of a decode.
        const stored = await storedThumbnailFor(post.attachment_url!);
        if (stored) {
          setVideoThumbnails((prev) => ({ ...prev, [post.id]: stored }));
          return;
        }

        // Older uploads have no frame. Only the author may create one.
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

  // PDF entries get the same treatment as uploaded videos: prefer the preview
  // stored beside the PDF, let the author backfill older entries, then fall back
  // to rendering page one in the browser.
  useEffect(() => {
    posts.forEach((post) => {
      const url = post.attachment_url;
      const isPdfPost =
        post.attachment_type === "pdf" ||
        (post.attachment_type === "document" && isPdfUrl(url));
      if (!isPdfPost || !url) return;
      if (pdfThumbnails[post.id] || pdfChecks.current.has(post.id)) return;
      pdfChecks.current.add(post.id);

      void (async () => {
        const stored = await storedPdfThumbnailFor(url);
        if (stored) {
          setPdfThumbnails((prev) => ({ ...prev, [post.id]: stored }));
          return;
        }

        if (user && post.author_id === user.id) {
          const backfilled = await backfillPdfThumbnail(url);
          if (backfilled) {
            setPdfThumbnails((prev) => ({ ...prev, [post.id]: backfilled }));
            fetchPosts();
            return;
          }
        }

        const generated = await generatePdfThumbnail(url);
        if (generated) setPdfThumbnails((prev) => ({ ...prev, [post.id]: generated }));
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, user]);

  // Debounced first-page render for a linked PDF, so typing a URL does not
  // download the file once per keystroke.
  useEffect(() => {
    const link = ebookLink.trim();
    if (!link || !isHttpUrl(link)) {
      setEbookPreview(null);
      setEbookPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setEbookPreviewLoading(true);
    const timer = setTimeout(async () => {
      const thumb = await generatePdfThumbnail(link);
      if (!cancelled) {
        setEbookPreview(thumb);
        setEbookPreviewLoading(false);
      }
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ebookLink]);

  const fetchPosts = async () => {
    try {
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id, content, created_at, likes_count, comments_count, shares_count, votes_count, author_id, category, attachment_url, attachment_type')
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

      // Only ask which posts this user has backed once the ids are known.
      if (user) {
        setMyVotes(await fetchMyVotes(postsWithProfiles.map((p) => p.id)));
      } else {
        setMyVotes({});
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching posts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVote = async (postId: string, amount: number) => {
    if (!user) {
      toast({ title: "Login Required", description: "Please sign in to vote.", variant: "destructive" });
      return;
    }
    // A vote is final, so refuse a withdrawal or reduction before spending a
    // request on something the database will reject anyway.
    const alreadyCast = myVotes[postId] ?? 0;
    if (amount < alreadyCast) {
      toast({
        title: "Your vote is final",
        description: "A vote cannot be removed or reduced once cast.",
        variant: "destructive",
      });
      return;
    }
    setVotingPostId(postId);
    try {
      // Payment, self-voting, stage and remaining allowance are all re-checked
      // by the database; its refusal reason is what gets shown.
      const result = await castVote(postId, amount);

      if (!result.ok) {
        toast({ title: "Vote not counted", description: result.message, variant: "destructive" });
        setVotingPower(await fetchVotingPower());
        return;
      }

      setMyVotes((prev) => ({ ...prev, [postId]: amount }));
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, votes_count: result.post_votes_count } : p)),
      );
      setVotingPower((prev) =>
        prev ? { ...prev, votes_remaining: result.votes_remaining } : prev,
      );
    } catch (error) {
      console.error("Vote failed:", error);
      toast({
        title: "Vote not counted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setVotingPostId(null);
    }
  };

  // Taken through the actual checkout in place, so a member never loses their
  // scroll position to go and pay. Power is re-read on success because the
  // purchase is what grants it.
  const requirePaymentForVoting = () => setUpgradeOpen(true);
  const needMoreVotes = () => setUpgradeOpen(true);
  const onVotingPurchased = async () => {
    setVotingPower(await fetchVotingPower());
    await fetchPosts();
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const pdf = isPdfFile(file);
    const maxSize = isVideo
      ? 5 * 1024 * 1024
      : isImage
        ? 3 * 1024 * 1024
        : pdf
          ? MAX_PDF_SIZE
          : 10 * 1024 * 1024;
    const label = isVideo ? "Videos" : isImage ? "Images" : pdf ? "PDFs" : "Files";
    if (file.size > maxSize) {
      toast({ title: "File too large", description: `${label} must be under ${(maxSize / 1024 / 1024).toFixed(0)}MB`, variant: "destructive" });
      return;
    }
    // An ordinary attachment and an Ebook Track PDF share one media slot.
    setEbookFile(null);
    setEbookLink("");
    setEbookPreview(null);
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
    } else if (pdf) {
      setFilePreview(await generatePdfThumbnail(file));
    } else {
      setFilePreview(null);
    }
  };

  const handleEbookFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isPdfFile(file)) {
      toast({
        title: "PDF required",
        description: "Ebook Track entries must be uploaded as a PDF.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > MAX_PDF_SIZE) {
      toast({
        title: "File too large",
        description: `PDFs must be under ${(MAX_PDF_SIZE / 1024 / 1024).toFixed(0)}MB`,
        variant: "destructive",
      });
      return;
    }

    setEbookFile(file);
    setEbookLink("");
    setSelectedFile(null);
    setFilePreview(null);
    setVideoLink("");
    setLinkPreview(null);
    setEbookPreview(null);
    setEbookPreviewLoading(true);
    setEbookPreview(await generatePdfThumbnail(file));
    setEbookPreviewLoading(false);
  };

  const handlePost = async () => {
    if (!newPost.trim() || !user) return;

    // A pasted video link wins over an uploaded file: it is what the creator
    // asked for, and a poster frame can still be derived from it.
    const linkedVideo = videoLink.trim() ? parseVideoLink(videoLink.trim()) : null;

    if (videoLink.trim() && !linkedVideo) {
      toast({
        title: "Unrecognised video link",
        description: "Paste a YouTube, Vimeo or direct video-file link (https://...).",
        variant: "destructive",
      });
      return;
    }

    setIsPosting(true);
    try {
      let attachmentUrl = null;
      let attachmentType = null;

      const ebookEnabled =
        isAiwcCategory(newPostCategory) ||
        isAiwcCategory(activeCategories.find((c) => c.name === newPostCategory)?.label);
      const ebookLinkValue = ebookEnabled ? ebookLink.trim() : "";
      const ebookFileValue = ebookEnabled ? ebookFile : null;

      if (ebookLinkValue && !isHttpUrl(ebookLinkValue)) {
        toast({
          title: "Unrecognised PDF link",
          description: "Paste a direct link to your ebook PDF (https://...).",
          variant: "destructive",
        });
        setIsPosting(false);
        return;
      }

      if (linkedVideo) {
        attachmentUrl = linkedVideo.url;
        attachmentType = "video";
      } else if (ebookFileValue) {
        try {
          const filePath = `${user.id}/ebook-entries/${Date.now()}.pdf`;
          const { data, error: uploadError } = await supabase.storage
            .from("attachments")
            .upload(filePath, ebookFileValue, { cacheControl: "3600", upsert: false });
          if (uploadError) throw uploadError;
          if (data) {
            const { data: { publicUrl } } = supabase.storage.from("attachments").getPublicUrl(filePath);
            attachmentUrl = publicUrl;
            attachmentType = "pdf";
            await attachPdfThumbnailToUpload(ebookFileValue, filePath);
          }
        } catch (uploadError) {
          console.error("Ebook upload error:", uploadError);
          toast({
            title: "Ebook upload failed",
            description: "Your PDF could not be uploaded. Please try again.",
            variant: "destructive",
          });
          setIsPosting(false);
          return;
        }
      } else if (ebookLinkValue) {
        attachmentUrl = ebookLinkValue;
        attachmentType = "pdf";
      } else if (selectedFile) {
        try {
          const fileExt = selectedFile.name.split(".").pop();
          const filePath = `${user.id}/post-attachments/${Date.now()}.${fileExt}`;
          if (selectedFile.type.startsWith("image/")) attachmentType = "image";
          else if (selectedFile.type.startsWith("video/")) attachmentType = "video";
          else if (isPdfFile(selectedFile)) attachmentType = "pdf";
          else attachmentType = "document";

          const { data, error: uploadError } = await supabase.storage
            .from("attachments")
            .upload(filePath, selectedFile, { cacheControl: "3600", upsert: false });
          if (uploadError) throw uploadError;
          if (data) {
            const { data: { publicUrl } } = supabase.storage.from("attachments").getPublicUrl(filePath);
            attachmentUrl = publicUrl;

            // An uploaded file has no poster frame the way a YouTube link does.
            // Capture one now and store it beside the video or PDF, otherwise
            // this post shares with a generic image forever.
            if (attachmentType === "video") {
              await attachThumbnailToUpload(selectedFile, filePath);
            } else if (attachmentType === "pdf") {
              await attachPdfThumbnailToUpload(selectedFile, filePath);
            }
          }
        } catch (uploadError) {
          console.error("File upload error:", uploadError);
          toast({ title: "Upload Failed", description: "Failed to upload file. You can still post without it.", variant: "destructive" });
          attachmentUrl = null;
          attachmentType = null;
        }
      }

      // An admin can deactivate the category this composer last used, which
      // would silently file the post under something the filters never show.
      const category = pickStorableCategory(newPostCategory, activeCategories);

      const insertPost = async (postCategory: string) =>
        supabase.from('posts').insert({
          content: newPost.trim(),
          author_id: postingAs?.id ?? user.id,
          category: postCategory,
          attachment_url: attachmentUrl,
          attachment_type: attachmentType,
          is_approved: true
        });

      let usedCategory = category;
      let result = await insertPost(category);

      if (result.error) {
        console.error('Post insert failed:', result.error);

        // posts.category began as a seven-value enum. If that is somehow still
        // the case, retry with a value both column types accept rather than
        // dropping the post.
        if (isCategoryValueError(result.error) && category !== ENUM_SAFE_CATEGORY) {
          const retry = await insertPost(ENUM_SAFE_CATEGORY);
          if (!retry.error) {
            usedCategory = ENUM_SAFE_CATEGORY;
            result = retry;
            setCategoryStillEnum(true);
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

      toast({
        title: "Posted!",
        description: postingAs
          ? `Published as ${postingAs.full_name?.trim() || postingAs.email?.trim() || "member"}.`
          : usedCategory === category
            ? "Your post has been shared with the community."
            : `Your post has been shared under ${usedCategory}.`,
      });
      setNewPost("");
      setNewPostCategory(usedCategory);
      setPostingAs(null);
      setSelectedFile(null);
      setFilePreview(null);
      setVideoLink("");
      setLinkPreview(null);
      setEbookFile(null);
      setEbookLink("");
      setEbookPreview(null);
      setEbookPreviewLoading(false);
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
      // posts.likes_count is maintained by a database trigger. Writing it here
      // too would double-count, and the RLS policy on posts only lets an
      // author update their own row, so the write was silently dropped for
      // every other user's post.
      if (isLiked) {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);
        if (error) throw error;

        setUserLikes(prev => {
          const newSet = new Set(prev);
          newSet.delete(postId);
          return newSet;
        });
      } else {
        const { error } = await supabase
          .from('post_likes')
          .insert({ post_id: postId, user_id: user.id });
        if (error) throw error;

        setUserLikes(prev => new Set([...prev, postId]));
      }

      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, likes_count: isLiked ? Math.max(0, post.likes_count - 1) : post.likes_count + 1 }
          : post
      ));
    } catch (error) {
      console.error("Error toggling like:", error);
      toast({
        title: "Couldn't update like",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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

      // posts.comments_count is maintained by a database trigger.
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
    const shareUrl = buildShareUrl(postId);
    const post = posts.find((p) => p.id === postId);
    // AIWC competition entries carry the full pitch; other posts keep the
    // short "check this out" summary.
    const shareText = postShareText(post, shareUrl);

    try {
      if (navigator.share && navigator.canShare?.({ text: shareText })) {
        await navigator.share({ title: "Investours Opportunity Hub", text: shareText, url: shareUrl });
      } else {
        // Copy the whole message, not a bare URL, so the pitch survives a paste
        // into a chat or a DM.
        try {
          await navigator.clipboard.writeText(shareText);
        } catch {
          const el = document.createElement("textarea");
          el.value = shareText;
          el.style.position = "fixed";
          el.style.opacity = "0";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
        }
      }
      
      if (user) {
        const { error: shareError } = await supabase
          .from('post_shares')
          .insert({ post_id: postId, user_id: user.id, platform: 'copy' });
        if (shareError) console.error("Failed to record share:", shareError);

        // posts.shares_count is maintained by a database trigger.
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

        {/* Buy voting power in place, without leaving the page */}
        <VoteCheckoutDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          onPurchased={() => void onVotingPurchased()}
        />

        {/* Evidence of Activity & Impact */}
        <div className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-2xl mx-auto mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Evidence of Activity &amp; Impact
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
            >
              <div className="aspect-video rounded-xl overflow-hidden mb-4 bg-muted">
                <iframe
                  src="https://www.youtube.com/embed/acm7ESTAwIY"
                  title="AI Financial Intelligence Awareness — NYSC Camp"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                AI Financial Intelligence Awareness — NYSC Camp
              </h3>
              <p className="text-sm text-muted-foreground">
                200+ corps members participating in live financial intelligence engagement.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <div className="aspect-video rounded-xl overflow-hidden mb-4 bg-muted">
                <iframe
                  src="https://www.youtube.com/embed/5qDIG0ucOLI"
                  title="Real User Experience"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Real User Experience
              </h3>
              <p className="text-sm text-muted-foreground">
                Corps member testimonial after interacting with Investours.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
            >
              <div className="aspect-video rounded-xl overflow-hidden mb-4 bg-muted">
                <iframe
                  src="https://www.youtube.com/embed/Vzb-R1bRil0"
                  title="Community Training Session"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Community Training Session
              </h3>
              <p className="text-sm text-muted-foreground">
                Live training and financial empowerment activities with youth participants.
              </p>
            </motion.div>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="text-center text-muted-foreground italic mt-10 max-w-3xl mx-auto text-sm md:text-base"
          >
            &ldquo;Investours is combining AI, financial education, mentorship, and grassroots engagement to improve economic resilience for underserved communities.&rdquo;
          </motion.p>
        </div>

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
             Investours Opportunity Hub
           </h2>
           <p className="text-muted-foreground">
             Growth Community for Opportunities, Grants, Funding, Partnerships, Mentorship, Jobs & Gigs.
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
                      {linkPreview && (
                        <div className="relative rounded-lg overflow-hidden border">
                          <img
                            src={linkPreview}
                            alt="Video preview"
                            className="w-full max-h-40 object-cover"
                            onError={() => setLinkPreview(null)}
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                              <Play className="w-5 h-5 text-foreground ml-0.5" />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setVideoLink(""); setLinkPreview(null); }}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        </div>
                      )}
                      {filePreview && (
                        <div className="relative rounded-lg overflow-hidden border">
                          {selectedFile?.type.startsWith("image/") ? (
                            <img src={filePreview} alt="Preview" className="w-full max-h-40 object-cover" />
                          ) : selectedFile && isPdfFile(selectedFile) ? (
                            <img src={filePreview} alt="PDF preview" className="w-full max-h-40 bg-white object-contain" />
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
                      <div className="space-y-1.5">
                        <Input
                          type="url"
                          inputMode="url"
                          placeholder="Paste a video link (YouTube, Vimeo) - optional"
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
                              setEbookFile(null);
                              setEbookLink("");
                              setEbookPreview(null);
                            }
                          }}
                          disabled={isPosting || Boolean(ebookFile) || Boolean(ebookLink.trim())}
                          className="text-sm"
                        />
                        {videoLink.trim() && !parseVideoLink(videoLink.trim()) && (
                          <p className="text-xs text-destructive">
                            That does not look like a video link yet.
                          </p>
                        )}
                      </div>
                      {isAdmin && (
                        <PostAsMemberPicker
                          value={postingAs}
                          onChange={setPostingAs}
                          disabled={isPosting}
                        />
                      )}
                      <Select
                        value={newPostCategory}
                        onValueChange={setNewPostCategory}
                        disabled={isPosting}
                      >
                        <SelectTrigger className="w-full sm:w-64" aria-label="Post category">
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeCategories.filter((c) => c.name !== "all").map((cat) => (
                            <SelectItem key={cat.name} value={cat.name}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {showEbookEntry && (
                        <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
                          <div>
                            <p className="text-xs font-medium text-foreground">
                              Ebook Track entry (PDF){" "}
                              <span className="font-normal text-muted-foreground">(optional)</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              For the Creativity &amp; Enterprise Challenge. Upload your ebook as a PDF or
                              paste a direct link — the first page becomes the post thumbnail.
                            </p>
                          </div>
                          <Input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={handleEbookFileSelect}
                            disabled={isPosting || Boolean(videoLink.trim())}
                            className="h-8 cursor-pointer text-xs"
                          />
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <span className="h-px flex-1 bg-border" />
                            or paste a PDF link
                            <span className="h-px flex-1 bg-border" />
                          </div>
                          <Input
                            type="url"
                            inputMode="url"
                            placeholder="https://.../my-ebook.pdf"
                            value={ebookLink}
                            onChange={(e) => {
                              const value = e.target.value;
                              setEbookLink(value);
                              setEbookPreview(null);
                              if (value.trim()) {
                                setEbookFile(null);
                                setSelectedFile(null);
                                setFilePreview(null);
                                setVideoLink("");
                                setLinkPreview(null);
                              }
                            }}
                            disabled={isPosting || Boolean(videoLink.trim())}
                            className="text-sm"
                          />
                          {ebookLink.trim() && !isHttpUrl(ebookLink.trim()) && (
                            <p className="text-xs text-destructive">
                              That does not look like a PDF link yet.
                            </p>
                          )}
                          {(ebookFile || ebookLink.trim()) && (
                            <div className="flex gap-2 rounded border border-border bg-card p-2">
                              <div className="h-16 w-12 shrink-0 overflow-hidden rounded border border-border bg-white">
                                {ebookPreviewLoading ? (
                                  <div className="flex h-full items-center justify-center text-[9px] text-muted-foreground">
                                    …
                                  </div>
                                ) : ebookPreview ? (
                                  <img
                                    src={ebookPreview}
                                    alt="Ebook PDF preview"
                                    className="h-full w-full object-cover object-top"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-muted-foreground">
                                    <FileText className="h-4 w-4" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">
                                  {ebookFile ? ebookFile.name : "Linked PDF"}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {ebookFile
                                    ? `${(ebookFile.size / 1024 / 1024).toFixed(2)} MB`
                                    : ebookLink.trim()}
                                </p>
                                <button
                                  type="button"
                                  className="mt-0.5 text-[11px] font-medium text-destructive hover:underline"
                                  onClick={() => {
                                    setEbookFile(null);
                                    setEbookLink("");
                                    setEbookPreview(null);
                                    setEbookPreviewLoading(false);
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            PDF only, up to 20MB. Replaces any other attachment.
                          </p>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/*,video/*,.pdf"
                            className="hidden"
                            onChange={handleFileSelect}
                            disabled={isPosting || Boolean(videoLink.trim()) || Boolean(ebookFile) || Boolean(ebookLink.trim())}
                          />
                          <Button variant="ghost" size="sm" asChild>
                            <span>
                              <Image className="w-4 h-4 mr-2" />
                              Photo/Video/PDF
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
                  id={`post-${post.id}`}
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
                          {post.attachment_url && post.attachment_type === "video" && (() => {
                            // Link-based videos embed behind their poster frame;
                            // uploaded files keep the native <video> element.
                            const linked = parseVideoLink(post.attachment_url);
                            const poster = linked?.thumbnailUrl ?? videoThumbnails[post.id];
                            const isPlaying = playingVideos.has(post.id);

                            if (linked && linked.provider !== "file") {
                              return (
                                <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg bg-black">
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
                                        <img src={poster} alt="Video" className="h-full w-full object-cover" />
                                      )}
                                      <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
                                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 transition-transform group-hover:scale-110">
                                          <Play className="ml-0.5 h-6 w-6 text-foreground" />
                                        </span>
                                      </span>
                                    </button>
                                  )}
                                </div>
                              );
                            }

                            return (
                              <div className="mb-3 rounded-lg overflow-hidden bg-black relative">
                                {poster && !isPlaying && (
                                  <div
                                    className="relative cursor-pointer"
                                    onClick={() => setPlayingVideos(prev => new Set([...prev, post.id]))}
                                  >
                                    <img src={poster} alt="Video" className="w-full object-cover max-h-64" />
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
                                  autoPlay={isPlaying}
                                  className={`w-full max-h-64 ${!isPlaying && poster ? "hidden" : ""}`}
                                />
                              </div>
                            );
                          })()}
                          {post.attachment_url && (post.attachment_type === "pdf" || (post.attachment_type === "document" && isPdfUrl(post.attachment_url))) && (
                            <a
                              href={post.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group mb-3 flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/40 p-2 transition-colors hover:border-primary/40"
                            >
                              <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded border border-border bg-white">
                                {pdfThumbnails[post.id] ? (
                                  <img
                                    src={pdfThumbnails[post.id]}
                                    alt="Ebook PDF preview"
                                    className="h-full w-full object-cover object-top"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-muted-foreground">
                                    <FileText className="h-6 w-6" />
                                  </div>
                                )}
                                <span className="absolute left-1 top-1 rounded bg-primary px-1 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                                  PDF
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-foreground">
                                  {post.category && isAiwcCategory(post.category) ? "Ebook entry (PDF)" : "PDF document"}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  Open the PDF to read the full {post.category && isAiwcCategory(post.category) ? "entry" : "document"}.
                                </p>
                                <span className="mt-1 inline-block text-xs font-medium text-primary group-hover:underline">
                                  Open PDF
                                </span>
                              </div>
                            </a>
                          )}
                          {post.attachment_url && post.attachment_type === "document" && !isPdfUrl(post.attachment_url) && (
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
                            <button 
                              onClick={() => handleShare(post.id)}
                              className="flex items-center gap-1 text-xs hover:text-primary transition-colors"
                            >
                              <Share2 className="w-4 h-4" />
                              {post.shares_count || 0}
                            </button>

                            {/* Vote Button - beside Share */}
                            <VoteButton
                              votesCount={post.votes_count || 0}
                              myVote={myVotes[post.id] || 0}
                              power={votingPower}
                              isOwnPost={user?.id === post.author_id}
                              busy={votingPostId === post.id}
                              onVote={(amount) => handleVote(post.id, amount)}
                              onRequirePayment={requirePaymentForVoting}
                              onNeedMoreVotes={needMoreVotes}
                              className="text-xs"
                            />
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
                                        <p className="text-sm"><LinkifiedText text={comment.content} /></p>
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
                View All Opportunities
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CommunitySection;
