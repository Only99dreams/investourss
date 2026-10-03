import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, MessageSquare, CheckCircle, Eye, EyeOff, Trash2, Plus, Tag, ArrowUp, ArrowDown, GripVertical, Vote, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ClosedVotesPanel } from "@/components/admin/ClosedVotesPanel";

const ICON_OPTIONS = ["Banknote", "Briefcase", "Handshake", "Rocket", "GraduationCap", "Calendar", "Megaphone", "Tag"];
const COLOR_OPTIONS = [
  { label: "Green", value: "bg-green-100 text-green-800" },
  { label: "Blue", value: "bg-blue-100 text-blue-800" },
  { label: "Purple", value: "bg-purple-100 text-purple-800" },
  { label: "Orange", value: "bg-orange-100 text-orange-800" },
  { label: "Indigo", value: "bg-indigo-100 text-indigo-800" },
  { label: "Yellow", value: "bg-yellow-100 text-yellow-800" },
  { label: "Red", value: "bg-red-100 text-red-800" },
  { label: "Gray", value: "bg-gray-100 text-gray-800" },
];

interface PostCategory {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  color: string | null;
  sort_order: number | null;
  is_active: boolean | null;
}

interface VotingStage {
  id: string;
  name: string;
  stage_number: number;
  is_current: boolean;
  category: string | null;
  opens_at: string | null;
  closes_at: string | null;
}

/** One draggable row. Only the handle starts a drag, so the row's buttons stay clickable. */
function SortableCategoryRow({
  category,
  position,
  total,
  onMoveUp,
  onMoveDown,
  onToggle,
  onDelete,
}: {
  category: PostCategory;
  position: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 bg-muted shadow-lg" : undefined}
    >
      <TableCell>
        <div className="flex items-center gap-1">
          <span className="w-5 text-center text-sm text-muted-foreground">{position}</span>
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${category.label}`}
            title="Drag to reorder"
            className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={position === 1}
            title="Move up"
            onClick={onMoveUp}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={position === total}
            title="Move down"
            onClick={onMoveDown}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm">{category.name}</TableCell>
      <TableCell>{category.label}</TableCell>
      <TableCell>
        <Badge variant={category.is_active ? "default" : "secondary"}>
          {category.is_active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onToggle}>
            {category.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

const CommunityTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<PostCategory[]>([]);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("Tag");
  const [newCategoryColor, setNewCategoryColor] = useState("bg-gray-100 text-gray-800");
  const [stages, setStages] = useState<VotingStage[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [newStageCategory, setNewStageCategory] = useState("");
  const [advancingStage, setAdvancingStage] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editOpensAt, setEditOpensAt] = useState("");
  const [editClosesAt, setEditClosesAt] = useState("");
  const [editStageNumber, setEditStageNumber] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [newStageNumber, setNewStageNumber] = useState("");
  const [changeCategoryPostId, setChangeCategoryPostId] = useState<string | null>(null);
  const [newCategoryValue, setNewCategoryValue] = useState("");
  const { toast } = useToast();
  const { user, roles, profile } = useAuth();

  const isAdmin = roles?.includes('admin') || profile?.assigned_role === 'admin';

  // A small activation distance keeps a click on the handle from starting a
  // drag, and the keyboard sensor keeps reordering possible without a mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchStages = async () => {
    const { data, error } = await supabase
      .from("voting_stages")
      .select("id, name, stage_number, is_current, category, opens_at, closes_at")
      .order("category", { ascending: true, nullsFirst: false })
      .order("stage_number");
    if (error) {
      // Migration not applied yet; the card simply stays empty.
      console.warn("Voting stages unavailable:", error.message);
      return;
    }
    setStages((data ?? []) as VotingStage[]);
  };

  /**
   * Open a competition for one category.
   *
   * A competition is a stage and it must belong to exactly one category.
   * Opening one only supersedes that category's current competition, so
   * different categories can each have a competition running at the same time.
   * The per-stage allowance is refreshed for the members who vote in it.
   */
  const openCompetition = async () => {
    const name = newStageName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give the competition a name, e.g. 'AIWC Stage 2'.", variant: "destructive" });
      return;
    }
    if (!newStageCategory) {
      toast({
        title: "Category required",
        description: "A competition must belong to a category. Pick one to open.",
        variant: "destructive",
      });
      return;
    }
    setAdvancingStage(true);
    try {
      const parsedStage = newStageNumber.trim() ? Number.parseInt(newStageNumber, 10) : null;
      const { error } = await supabase.rpc("open_competition", {
        p_name: name,
        p_category: newStageCategory,
        p_stage_number: parsedStage && Number.isFinite(parsedStage) ? parsedStage : null,
      });
      if (error) throw error;
      const label = categories.find((c) => c.name === newStageCategory)?.label ?? newStageCategory;
      toast({
        title: `${name} is now open`,
        description: `The ${label} competition is live and members can vote in it.`,
      });
      setNewStageName("");
      setNewStageCategory("");
      setNewStageNumber("");
      await fetchStages();
    } catch (error) {
      console.error("Failed to open competition:", error);
      toast({
        title: "Could not open the competition",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAdvancingStage(false);
    }
  };

  /** Fill the edit form from a competition and open it. */
  const startEditStage = (stage: VotingStage) => {
    setEditingStageId(stage.id);
    setEditName(stage.name);
    setEditCategory(stage.category ?? "");
    // datetime-local wants "YYYY-MM-DDTHH:mm" without the timezone suffix.
    setEditOpensAt(stage.opens_at ? stage.opens_at.slice(0, 16) : "");
    setEditClosesAt(stage.closes_at ? stage.closes_at.slice(0, 16) : "");
    setEditStageNumber(String(stage.stage_number));
  };

  const cancelEditStage = () => {
    setEditingStageId(null);
    setEditName("");
    setEditCategory("");
    setEditOpensAt("");
    setEditClosesAt("");
    setEditStageNumber("");
  };

  /** Save edits to one competition via the admin-only RPC. */
  const saveEditStage = async (stage: VotingStage) => {
    if (!editName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!editCategory) {
      toast({ title: "Category required", description: "A competition must belong to a category.", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    try {
      const parsedStage = editStageNumber.trim() ? Number.parseInt(editStageNumber, 10) : null;
      const { error } = await supabase.rpc("update_competition", {
        p_stage_id: stage.id,
        p_name: editName.trim(),
        p_category: editCategory,
        p_opens_at: editOpensAt ? new Date(editOpensAt).toISOString() : null,
        p_closes_at: editClosesAt ? new Date(editClosesAt).toISOString() : null,
        p_stage_number: parsedStage && Number.isFinite(parsedStage) ? parsedStage : null,
      });
      if (error) throw error;
      toast({ title: `${editName.trim()} updated` });
      cancelEditStage();
      await fetchStages();
    } catch (error) {
      console.error("Failed to update competition:", error);
      toast({
        title: "Could not update the competition",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  /** End one competition, leaving every other category's competition running. */
  const closeCompetition = async (stage: VotingStage) => {
    if (!confirm(`Close "${stage.name}"? Members will no longer be able to vote in it.`)) return;
    try {
      const { error } = await supabase.rpc("close_competition", { p_stage_id: stage.id });
      if (error) throw error;
      toast({ title: `${stage.name} closed`, description: "Results are now final." });
      await fetchStages();
    } catch (error) {
      console.error("Failed to close competition:", error);
      toast({
        title: "Could not close the competition",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchPosts();
      fetchCategories();
      void fetchStages();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  const fetchPosts = async () => {
    try {
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      if (postsData && postsData.length > 0) {
        const authorIds = postsData.map(post => post.author_id);
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", authorIds);

        const postsWithAuthors = postsData.map(post => ({
          ...post,
          author: profilesData?.find(profile => profile.id === post.author_id) || null
        }));

        setPosts(postsWithAuthors);
      } else {
        setPosts([]);
      }
    } catch (error) {
      console.error("Error fetching posts:", error);
      toast({ title: "Error", description: "Failed to fetch posts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('post_categories')
        .select('*')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      setCategories((data ?? []) as PostCategory[]);
    } catch {
      setCategories([]);
    }
  };

  const handleToggleHidden = async (id: string, currentHidden: boolean) => {
    try {
      const { error } = await supabase
        .from("posts")
        .update({ is_hidden: !currentHidden })
        .eq("id", id);

      if (error) throw error;

      toast({ title: "Success", description: `Post ${!currentHidden ? "hidden" : "visible"}` });
      fetchPosts();
    } catch (error) {
      console.error("Error updating post:", error);
      toast({ title: "Error", description: "Failed to update post", variant: "destructive" });
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this post?")) return;
    try {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Deleted", description: "Post has been permanently deleted." });
      setPosts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error("Error deleting post:", error);
      toast({ title: "Error", description: "Failed to delete post", variant: "destructive" });
    }
  };

  const handleChangeCategory = async (postId: string, category: string) => {
    try {
      const { error } = await supabase.from("posts").update({ category }).eq("id", postId);
      if (error) throw error;
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, category } : p));
      toast({ title: "Category Updated" });
      setChangeCategoryPostId(null);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update category.", variant: "destructive" });
    }
  };

  /** The order the table renders in, and drag-and-drop mutates. */
  const orderedCategories = [...categories].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  /**
   * Persist a new sequence by renumbering 1..N rather than swapping two
   * values, so duplicate or zeroed sort_order rows can't wedge the list.
   */
  const persistOrder = async (next: PostCategory[], successMessage: string) => {
    setCategories(next);
    try {
      for (let i = 0; i < next.length; i += 1) {
        const { error } = await supabase
          .from('post_categories')
          .update({ sort_order: i + 1 })
          .eq('id', next[i].id);
        if (error) throw error;
      }
      toast({ title: "Order updated", description: successMessage });
    } catch (error) {
      console.error("Error reordering categories:", error);
      toast({ title: "Error", description: "Failed to save the new order", variant: "destructive" });
      fetchCategories();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = orderedCategories.findIndex((c) => c.id === active.id);
    const to = orderedCategories.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;

    const moved = orderedCategories[from];
    void persistOrder(
      arrayMove(orderedCategories, from, to),
      `"${moved.label}" moved to position ${to + 1}.`,
    );
  };

  /**
   * Move a category one slot up (-1) or down (+1) and persist the new order.
   * Kept as a keyboard/accessible alternative to dragging.
   */
  const moveCategory = async (id: string, dir: -1 | 1) => {
    const idx = orderedCategories.findIndex((c) => c.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= orderedCategories.length) return;

    const movedLabel = orderedCategories[idx].label;
    void persistOrder(
      arrayMove(orderedCategories, idx, target),
      `"${movedLabel}" moved ${dir === -1 ? "up" : "down"}.`,
    );
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !newCategoryLabel.trim()) {
      toast({ title: "Required", description: "Name and label are required", variant: "destructive" });
      return;
    }
    try {
      const slug = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
      // Append after the highest existing order so a new category never lands
      // in the middle of the list because of a stray sort_order value.
      const nextOrder = categories.reduce((max, c) => Math.max(max, c.sort_order ?? 0), 0) + 1;
      const { error } = await supabase.from('post_categories').insert({
        name: slug,
        label: newCategoryLabel.trim(),
        icon: newCategoryIcon,
        color: newCategoryColor,
        sort_order: nextOrder,
        is_active: true,
      });
      if (error) throw error;
      toast({ title: "Success", description: "Category added" });
      setNewCategoryName("");
      setNewCategoryLabel("");
      setNewCategoryIcon("Tag");
      setNewCategoryColor("bg-gray-100 text-gray-800");
      setIsCategoryDialogOpen(false);
      fetchCategories();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add category",
        variant: "destructive",
      });
    }
  };

  const handleToggleCategory = async (id: string, currentActive: boolean) => {
    try {
      const { error } = await supabase.from('post_categories').update({ is_active: !currentActive }).eq('id', id);
      if (error) throw error;
      fetchCategories();
    } catch (error) {
      console.error("Error toggling category:", error);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    try {
      const { error } = await supabase.from('post_categories').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Deleted", description: "Category removed" });
      fetchCategories();
    } catch (error) {
      console.error("Error deleting category:", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Competitions. A stage is a competition, each tied to one category, and
          several categories can run theirs at the same time. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Vote className="w-5 h-5" /> Competitions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No competitions yet. Open one for a category to start accepting votes.
            </p>
          ) : (
            <div className="space-y-2">
              {stages.map((s) => {
                const label = s.category
                  ? categories.find((c) => c.name === s.category)?.label ?? s.category.replace(/_/g, " ")
                  : "All categories (legacy)";
                return (
                  <div key={s.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="text-primary">{label}</span>
                          <span className="mx-1">·</span>
                          Stage {s.stage_number}
                          {s.closes_at && (
                            <>
                              <span className="mx-1">·</span>
                              closes {new Date(s.closes_at).toLocaleDateString()}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {s.is_current ? (
                          <>
                            <Badge>Open now</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => void closeCompetition(s)}
                            >
                              Close
                            </Button>
                          </>
                        ) : (
                          <Badge variant="secondary">Closed</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => (editingStageId === s.id ? cancelEditStage() : startEditStage(s))}
                        >
                          {editingStageId === s.id ? "Cancel" : "Edit"}
                        </Button>
                      </div>
                    </div>
                    {editingStageId === s.id && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs">Name</Label>
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={savingEdit} />
                          </div>
                          <div>
                            <Label className="text-xs">Category</Label>
                            <Select value={editCategory} onValueChange={setEditCategory}>
                              <SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger>
                              <SelectContent>
                                {categories
                                  .filter(c => c.name !== 'all' && c.is_active !== false)
                                  .map(cat => (
                                    <SelectItem key={cat.name} value={cat.name}>{cat.label}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Opens at</Label>
                            <Input type="datetime-local" value={editOpensAt} onChange={(e) => setEditOpensAt(e.target.value)} disabled={savingEdit} />
                          </div>
                          <div>
                            <Label className="text-xs">Closes at</Label>
                            <Input type="datetime-local" value={editClosesAt} onChange={(e) => setEditClosesAt(e.target.value)} disabled={savingEdit} />
                          </div>
                          <div>
                            <Label className="text-xs">Stage number</Label>
                            <Input type="number" min={1} value={editStageNumber} onChange={(e) => setEditStageNumber(e.target.value)} disabled={savingEdit} />
                          </div>
                        </div>
                        <Button size="sm" onClick={() => void saveEditStage(s)} disabled={savingEdit}>
                          {savingEdit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Save changes
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Label htmlFor="competition-name" className="sr-only">Competition name</Label>
              <Input
                id="competition-name"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="e.g. AIWC Stage 2"
                disabled={advancingStage}
              />
            </div>
            <div className="w-full sm:w-52">
              <Label htmlFor="competition-category" className="sr-only">Category</Label>
              <Select value={newStageCategory} onValueChange={setNewStageCategory}>
                <SelectTrigger id="competition-category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>
                  {categories
                    .filter(c => c.name !== 'all' && c.is_active !== false)
                    .map(cat => (
                      <SelectItem key={cat.name} value={cat.name}>{cat.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-28">
              <Label htmlFor="competition-stage" className="sr-only">Stage number</Label>
              <Input
                id="competition-stage"
                type="number"
                min={1}
                value={newStageNumber}
                onChange={(e) => setNewStageNumber(e.target.value)}
                placeholder={
                  newStageCategory
                    ? `Stage ${Math.max(0, ...stages.filter((s) => s.category === newStageCategory).map((s) => s.stage_number)) + 1}`
                    : "Stage #"
                }
                disabled={advancingStage}
              />
            </div>
            <Button
              onClick={openCompetition}
              disabled={advancingStage || !newStageName.trim() || !newStageCategory}
            >
              {advancingStage ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Open competition
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each competition belongs to one category, and every category can have its own
            running at the same time. Opening one only replaces that category's previous
            competition — it gives that category's paid members a fresh voting allowance and
            leaves the others untouched. Votes already cast stay counted against the
            competition they were cast in.
          </p>
        </CardContent>
      </Card>

      {/* Closed-competition results. Moved off the user-facing community page;
          the backing RPC is admin-only, so this is gated to admins here too. */}
      {isAdmin && <ClosedVotesPanel />}

      {/* Category Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" /> Category Management
            </CardTitle>
            <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Category</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Category</DialogTitle>
                  <DialogDescription>Create a new post category for the community</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Internal Name</Label>
                    <Input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="e.g. mentorship" />
                  </div>
                  <div>
                    <Label>Display Label</Label>
                    <Input value={newCategoryLabel} onChange={e => setNewCategoryLabel(e.target.value)} placeholder="e.g. Mentorship" />
                  </div>
                  <div>
                    <Label>Icon</Label>
                    <Select value={newCategoryIcon} onValueChange={setNewCategoryIcon}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ICON_OPTIONS.map(icon => (
                          <SelectItem key={icon} value={icon}>{icon}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Color</Label>
                    <Select value={newCategoryColor} onValueChange={setNewCategoryColor}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLOR_OPTIONS.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAddCategory} className="w-full">Add Category</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom categories yet. Using defaults.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Order</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext
                      items={orderedCategories.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {orderedCategories.map((cat, index) => (
                        <SortableCategoryRow
                          key={cat.id}
                          category={cat}
                          position={index + 1}
                          total={orderedCategories.length}
                          onMoveUp={() => moveCategory(cat.id, -1)}
                          onMoveDown={() => moveCategory(cat.id, 1)}
                          onToggle={() => handleToggleCategory(cat.id, cat.is_active)}
                          onDelete={() => handleDeleteCategory(cat.id)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" /> Post Management
            </CardTitle>
            {isAdmin && (
              <Button onClick={fetchPosts} variant="outline" size="sm">Refresh</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            if (!isAdmin) {
              return (
                <div className="text-center p-8">
                  <p className="text-muted-foreground mb-4">You need admin privileges to manage community posts.</p>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p><strong>Current user:</strong> {user?.email || 'Not logged in'}</p>
                    <p><strong>Is Admin:</strong> {isAdmin ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              );
            }

            if (loading) {
              return (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              );
            }

            return (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Author</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center h-24">No posts found.</TableCell>
                      </TableRow>
                    ) : (
                      posts.map((post) => (
                        <TableRow key={post.id}>
                          <TableCell className="font-medium">
                            {post.author?.full_name || "N/A"}
                            <br />
                            <span className="text-xs text-muted-foreground">{post.author?.email}</span>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{post.content}</TableCell>
                          <TableCell className="capitalize">
                            {changeCategoryPostId === post.id ? (
                              <div className="flex items-center gap-1">
                                <Select value={newCategoryValue || post.category} onValueChange={setNewCategoryValue}>
                                  <SelectTrigger className="h-7 text-xs w-28 max-w-[9rem] min-w-0"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {categories.filter(c => c.name !== 'all').map(cat => (
                                      <SelectItem key={cat.name} value={cat.name}>{cat.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleChangeCategory(post.id, newCategoryValue || post.category)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setChangeCategoryPostId(null)}>✕</Button>
                              </div>
                            ) : (
                              <span
                                className="cursor-pointer hover:text-primary"
                                onClick={() => { setChangeCategoryPostId(post.id); setNewCategoryValue(post.category); }}
                                title="Click to change category"
                              >
                                {post.category?.replace("_", " ")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {post.is_approved ? (
                                <Badge variant="default">Approved</Badge>
                              ) : (
                                <Badge variant="secondary">Pending</Badge>
                              )}
                              {post.is_hidden && <Badge variant="destructive">Hidden</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>{new Date(post.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className={`h-8 w-8 p-0 ${
                                  post.is_hidden
                                    ? "text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                    : "text-gray-600 hover:text-gray-700 hover:bg-gray-50"
                                }`}
                                onClick={() => handleToggleHidden(post.id, post.is_hidden)}
                                title={post.is_hidden ? "Unhide" : "Hide"}
                              >
                                {post.is_hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeletePost(post.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
};

export default CommunityTab;
