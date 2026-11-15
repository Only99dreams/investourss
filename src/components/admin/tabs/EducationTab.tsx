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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Video, Eye, EyeOff, GraduationCap, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { PLAN_TIER_OPTIONS, planLabel } from "@/lib/subscription";

interface Module {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  video_url: string | null;
  category: string | null;
  subcategory: string | null;
  tier_required: "free" | "monthly" | "quarterly" | "biennial" | "annual" | "b2b";
  is_published: boolean;
  order_index: number;
  certification_course_id: string | null;
  created_at: string;
}

interface CertificationCourseOption {
  id: string;
  title: string;
  is_published: boolean | null;
}

/** One draggable module row. Only the handle starts a drag so row actions stay usable. */
function SortableModuleRow({
  module,
  position,
  total,
  certificationLabel,
  onMoveUp,
  onMoveDown,
  onToggle,
  onEdit,
  onDelete,
}: {
  module: Module;
  position: number;
  total: number;
  certificationLabel: string | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onEdit: () => void;
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
  } = useSortable({ id: module.id });

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
            aria-label={`Reorder ${module.title}`}
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
      <TableCell className="font-medium">{module.title}</TableCell>
      <TableCell>{module.category || "-"}</TableCell>
      <TableCell>
        {module.certification_course_id ? (
          <Badge variant="secondary" className="max-w-[180px] truncate text-[10px]">
            {certificationLabel ?? "Certification"}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={
          module.tier_required === "free" ? "outline" :
          module.tier_required === "monthly" ? "secondary" :
          "default"
        }>
          {planLabel(module.tier_required)}
        </Badge>
      </TableCell>
      <TableCell>
        {module.video_url ? (
          <Video className="w-4 h-4 text-blue-500" />
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
        >
          {module.is_published ? (
            <Eye className="w-4 h-4 text-emerald-500" />
          ) : (
            <EyeOff className="w-4 h-4 text-muted-foreground" />
          )}
        </Button>
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
        >
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

const EducationTab = () => {
  const [modules, setModules] = useState<Module[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  
  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [tierRequired, setTierRequired] = useState<"free" | "monthly" | "quarterly" | "biennial" | "annual" | "b2b">("free");
  const [isPublished, setIsPublished] = useState(true);
  const [isCertification, setIsCertification] = useState(false);
  const [certificationCourseId, setCertificationCourseId] = useState("");
  const [certCourses, setCertCourses] = useState<CertificationCourseOption[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [courseBusy, setCourseBusy] = useState(false);

  // Categories are managed in the CMS rather than hard-coded: admins can
  // add new ones from this dialog and delete ones they no longer use.
  const [categoryOptions, setCategoryOptions] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);

  // A small activation distance keeps a click on the handle from starting a
  // drag, and the keyboard sensor keeps reordering possible without a mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    fetchModules();
    fetchCategories();
    fetchCertificationCourses();
  }, []);

  const fetchCertificationCourses = async () => {
    const { data, error } = await supabase
      .from("education_certification_courses")
      .select("id, title, is_published")
      .order("order_index");

    if (error) {
      console.error("Could not load certification courses:", error);
      return;
    }
    setCertCourses((data ?? []) as CertificationCourseOption[]);
  };

  const certificationCourseTitle = (courseId: string | null) =>
    courseId ? certCourses.find((course) => course.id === courseId)?.title ?? "Certification" : null;

  /**
   * Courses can be created from the upload form so a certification video is
   * never blocked by an empty catalogue. The new course inherits the tier
   * picked below and can be edited in the Certification tab afterwards.
   */
  const handleAddCertificationCourse = async () => {
    const name = newCourseTitle.trim();
    if (!name) return;
    if (certCourses.some((course) => course.title.toLowerCase() === name.toLowerCase())) {
      toast.error("That course already exists");
      return;
    }

    setCourseBusy(true);
    const { data, error } = await supabase
      .from("education_certification_courses")
      .insert({
        title: name,
        category: "Certification",
        tier_required: tierRequired,
        is_published: true,
        order_index: certCourses.length + 1,
      })
      .select("id, title, is_published")
      .single();
    setCourseBusy(false);

    if (error || !data) {
      console.error("Could not add certification course:", error);
      toast.error("Failed to add the course");
      return;
    }

    setCertCourses((current) => [...current, data as CertificationCourseOption]);
    setCertificationCourseId(data.id);
    setNewCourseTitle("");
    toast.success("Course added");
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from("content_categories")
      .select("id, name")
      .order("name");

    if (error) {
      // The table is unreachable on this environment; fall back to the
      // historical defaults so module uploads still work.
      setCategoryOptions(
        ["Investment Basics", "Financial Literacy", "Climate Finance", "Risk Management", "Scam Prevention", "SDG Investing", "Platform Guide", "Certification"]
          .map((name, i) => ({ id: `fallback-${i}`, name })),
      );
      return;
    }
    setCategoryOptions((data ?? []) as { id: string; name: string }[]);
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categoryOptions.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("That category already exists");
      return;
    }
    setCategoryBusy(true);
    const { error } = await supabase.from("content_categories").insert({ name });
    setCategoryBusy(false);
    if (error) {
      toast.error("Failed to add category");
      return;
    }
    setNewCategoryName("");
    setCategory(name);
    toast.success("Category added");
    fetchCategories();
  };

  const handleDeleteCategory = async (cat: { id: string; name: string }) => {
    if (cat.id.startsWith("fallback-")) {
      toast.error("Categories cannot be deleted while offline");
      return;
    }
    if (!confirm(`Delete the category "${cat.name}"?`)) return;
    setCategoryBusy(true);
    const { error } = await supabase.from("content_categories").delete().eq("id", cat.id);
    setCategoryBusy(false);
    if (error) {
      toast.error("Failed to delete category");
      return;
    }
    if (category === cat.name) setCategory("");
    toast.success("Category deleted");
    fetchCategories();
  };

  const fetchModules = async () => {
    const { data, error } = await supabase
      .from("education_modules")
      .select("*")
      .order("order_index");

    if (error) {
      toast.error("Failed to fetch modules");
      return;
    }
    setModules(data || []);
    setIsLoading(false);
  };

  /** The order the table renders in, and drag-and-drop mutates. */
  const orderedModules = [...modules].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

  /**
   * Persist a new sequence by renumbering 1..N rather than swapping two
   * values, so duplicate or zeroed order_index rows can't wedge the list.
   */
  const persistOrder = async (next: Module[], successMessage: string) => {
    const renumbered = next.map((module, index) => ({ ...module, order_index: index + 1 }));
    setModules(renumbered);
    try {
      for (let i = 0; i < renumbered.length; i += 1) {
        const { error } = await supabase
          .from("education_modules")
          .update({ order_index: i + 1 })
          .eq("id", renumbered[i].id);
        if (error) throw error;
      }
      toast.success(successMessage);
    } catch (error) {
      console.error("Error reordering modules:", error);
      toast.error("Failed to save the new order");
      fetchModules();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = orderedModules.findIndex((m) => m.id === active.id);
    const to = orderedModules.findIndex((m) => m.id === over.id);
    if (from < 0 || to < 0) return;

    const moved = orderedModules[from];
    void persistOrder(
      arrayMove(orderedModules, from, to),
      `"${moved.title}" moved to position ${to + 1}.`,
    );
  };

  /**
   * Move a module one slot up (-1) or down (+1) and persist the new order.
   * Kept as a keyboard/accessible alternative to dragging.
   */
  const moveModule = (id: string, dir: -1 | 1) => {
    const idx = orderedModules.findIndex((m) => m.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= orderedModules.length) return;

    const moved = orderedModules[idx];
    void persistOrder(
      arrayMove(orderedModules, idx, target),
      `"${moved.title}" moved ${dir === -1 ? "up" : "down"}.`,
    );
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setContent("");
    setVideoUrl("");
    setCategory("");
    setSubcategory("");
    setTierRequired("free");
    setIsPublished(true);
    setIsCertification(false);
    setCertificationCourseId("");
    setEditingModule(null);
  };

  const openEditDialog = (module: Module) => {
    setEditingModule(module);
    setTitle(module.title);
    setDescription(module.description || "");
    setContent(module.content || "");
    setVideoUrl(module.video_url || "");
    setCategory(module.category || "");
    setSubcategory(module.subcategory || "");
    setTierRequired(module.tier_required || "free");
    setIsPublished(module.is_published);
    setIsCertification(Boolean(module.certification_course_id));
    setCertificationCourseId(module.certification_course_id || "");
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (isCertification && !certificationCourseId) {
      toast.error("Select the certification course this video is for");
      return;
    }

    const moduleData = {
      title: title.trim(),
      description: description.trim() || null,
      content: content.trim() || null,
      video_url: videoUrl.trim() || null,
      category: category.trim() || null,
      subcategory: subcategory.trim() || null,
      tier_required: tierRequired,
      is_published: isPublished,
      certification_course_id: isCertification ? certificationCourseId : null,
      order_index: editingModule
        ? editingModule.order_index
        : modules.reduce((max, m) => Math.max(max, m.order_index ?? 0), 0) + 1,
    };

    if (editingModule) {
      const { error } = await supabase
        .from("education_modules")
        .update(moduleData)
        .eq("id", editingModule.id);

      if (error) {
        toast.error("Failed to update module");
        return;
      }
      toast.success("Module updated successfully");
    } else {
      const { error } = await supabase
        .from("education_modules")
        .insert(moduleData);

      if (error) {
        toast.error("Failed to create module");
        return;
      }
      toast.success("Module created successfully");
    }

    setIsDialogOpen(false);
    resetForm();
    fetchModules();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this module?")) return;

    const { error } = await supabase
      .from("education_modules")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete module");
      return;
    }
    toast.success("Module deleted");
    fetchModules();
  };

  const togglePublished = async (module: Module) => {
    const { error } = await supabase
      .from("education_modules")
      .update({ is_published: !module.is_published })
      .eq("id", module.id);

    if (error) {
      toast.error("Failed to update module");
      return;
    }
    fetchModules();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Education Modules</h2>
          <p className="text-muted-foreground">Manage learning content for users</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Module
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingModule ? "Edit Module" : "Create New Module"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Introduction to Investing"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this module"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="video_url">Video URL (YouTube, Vimeo, etc.)</Label>
                <div className="flex gap-2">
                  <Video className="w-5 h-5 text-muted-foreground mt-2" />
                  <Input
                    id="video_url"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Content / Notes</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Additional text content or notes for this module"
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Add / delete categories without leaving the upload form */}
                  <div className="flex gap-2 pt-1">
                    <Input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="New category name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddCategory();
                        }
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" disabled={categoryBusy || !newCategoryName.trim()} onClick={() => void handleAddCategory()}>
                      Add
                    </Button>
                  </div>
                  {categoryOptions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {categoryOptions.map((cat) => (
                        <Badge key={cat.id} variant="secondary" className="gap-1 py-1">
                          {cat.name}
                          <button
                            type="button"
                            className="ml-1 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete category ${cat.name}`}
                            disabled={categoryBusy}
                            onClick={() => void handleDeleteCategory(cat)}
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subcategory">Subcategory</Label>
                  <Input
                    id="subcategory"
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    placeholder="e.g., Beginner"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label>Certification video</Label>
                    <p className="text-xs text-muted-foreground">
                      Turn this on when the video prepares members for a certification course. It
                      then appears in the Request Certificate tab for that course.
                    </p>
                  </div>
                  <Switch
                    checked={isCertification}
                    onCheckedChange={(checked) => {
                      setIsCertification(checked);
                      if (!checked) setCertificationCourseId("");
                    }}
                  />
                </div>
                {isCertification ? (
                  <div className="space-y-2">
                    <Label htmlFor="certification_course">Certification course *</Label>
                    <Select value={certificationCourseId} onValueChange={setCertificationCourseId}>
                      <SelectTrigger id="certification_course">
                        <SelectValue placeholder="Select the course this video is for" />
                      </SelectTrigger>
                      <SelectContent>
                        {certCourses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.title}
                            {course.is_published ? "" : " (draft)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {certCourses.length === 0 ? (
                      <p className="text-xs text-amber-700">
                        No certification courses yet. Add one below.
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Input
                        value={newCourseTitle}
                        onChange={(event) => setNewCourseTitle(event.target.value)}
                        placeholder="Or add a new course"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleAddCertificationCourse();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={courseBusy || !newCourseTitle.trim()}
                        onClick={() => void handleAddCertificationCourse()}
                      >
                        Add course
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      New courses take the tier selected below. Add a description or unpublish it
                      in the Certification tab.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tier Required</Label>
                  <Select value={tierRequired} onValueChange={(v: "free" | "monthly" | "quarterly" | "biennial" | "annual" | "b2b") => setTierRequired(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_TIER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Published</Label>
                  <div className="flex items-center gap-2 pt-2">
                    <Switch
                      checked={isPublished}
                      onCheckedChange={setIsPublished}
                    />
                    <span className="text-sm text-muted-foreground">
                      {isPublished ? "Visible to users" : "Hidden"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingModule ? "Update Module" : "Create Module"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-8 h-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{modules.length}</p>
                <p className="text-sm text-muted-foreground">Total Modules</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Eye className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{modules.filter(m => m.is_published).length}</p>
                <p className="text-sm text-muted-foreground">Published</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Video className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{modules.filter(m => m.video_url).length}</p>
                <p className="text-sm text-muted-foreground">With Video</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <EyeOff className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{modules.filter(m => !m.is_published).length}</p>
                <p className="text-sm text-muted-foreground">Hidden</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modules Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>All Modules</CardTitle>
            <p className="text-xs text-muted-foreground">
              Drag the handle (or use the arrows) to change the order users see.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : modules.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No modules yet. Click "Add Module" to create your first one.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Order</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Certification</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={orderedModules.map((module) => module.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {orderedModules.map((module, index) => (
                      <SortableModuleRow
                        key={module.id}
                        module={module}
                        position={index + 1}
                        total={orderedModules.length}
                        certificationLabel={certificationCourseTitle(module.certification_course_id)}
                        onMoveUp={() => moveModule(module.id, -1)}
                        onMoveDown={() => moveModule(module.id, 1)}
                        onToggle={() => togglePublished(module)}
                        onEdit={() => openEditDialog(module)}
                        onDelete={() => handleDelete(module.id)}
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
    </div>
  );
};

export default EducationTab;
