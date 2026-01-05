import { useState, useEffect } from "react";
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
import { Plus, Pencil, Trash2, Video, Eye, EyeOff, GraduationCap } from "lucide-react";
import { toast } from "sonner";

interface Module {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  video_url: string | null;
  category: string | null;
  subcategory: string | null;
  tier_required: "free" | "premium" | "exclusive";
  is_published: boolean;
  order_index: number;
  created_at: string;
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
  const [tierRequired, setTierRequired] = useState<"free" | "premium" | "exclusive">("free");
  const [isPublished, setIsPublished] = useState(true);

  useEffect(() => {
    fetchModules();
  }, []);

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

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setContent("");
    setVideoUrl("");
    setCategory("");
    setSubcategory("");
    setTierRequired("free");
    setIsPublished(true);
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
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error("Title is required");
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
      order_index: editingModule ? editingModule.order_index : modules.length,
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

  const categories = [
    "Investment Basics",
    "Financial Literacy",
    "Climate Finance",
    "Risk Management",
    "Scam Prevention",
    "SDG Investing",
    "Platform Guide",
  ];

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
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tier Required</Label>
                  <Select value={tierRequired} onValueChange={(v: "free" | "premium" | "exclusive") => setTierRequired(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                      <SelectItem value="exclusive">Exclusive</SelectItem>
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
          <CardTitle>All Modules</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : modules.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No modules yet. Click "Add Module" to create your first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Video</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((module) => (
                  <TableRow key={module.id}>
                    <TableCell className="font-medium">{module.title}</TableCell>
                    <TableCell>{module.category || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={
                        module.tier_required === "exclusive" ? "default" :
                        module.tier_required === "premium" ? "secondary" :
                        "outline"
                      }>
                        {module.tier_required}
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
                        onClick={() => togglePublished(module)}
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
                        onClick={() => openEditDialog(module)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(module.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EducationTab;
