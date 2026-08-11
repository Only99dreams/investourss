import { useState, useEffect } from "react";
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
import { Loader2, MessageSquare, CheckCircle, Eye, EyeOff, Trash2, Plus, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

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

const CommunityTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<any[]>([]);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("Tag");
  const [newCategoryColor, setNewCategoryColor] = useState("bg-gray-100 text-gray-800");
  const { toast } = useToast();
  const { user, roles, profile } = useAuth();

  const isAdmin = roles?.includes('admin') || profile?.assigned_role === 'admin';

  useEffect(() => {
    if (user && isAdmin) {
      fetchPosts();
      fetchCategories();
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
        .order('sort_order');
      if (error) throw error;
      setCategories(data || []);
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

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !newCategoryLabel.trim()) {
      toast({ title: "Required", description: "Name and label are required", variant: "destructive" });
      return;
    }
    try {
      const slug = newCategoryName.trim().toLowerCase().replace(/\s+/g, '_');
      const { error } = await supabase.from('post_categories').insert({
        name: slug,
        label: newCategoryLabel.trim(),
        icon: newCategoryIcon,
        color: newCategoryColor,
        sort_order: categories.length + 1,
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add category", variant: "destructive" });
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
                    <TableHead>Name</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map(cat => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-mono text-sm">{cat.name}</TableCell>
                      <TableCell>{cat.label}</TableCell>
                      <TableCell>
                        <Badge variant={cat.is_active ? "default" : "secondary"}>
                          {cat.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleToggleCategory(cat.id, cat.is_active)}>
                            {cat.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleDeleteCategory(cat.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
                          <TableCell className="capitalize">{post.category?.replace("_", " ")}</TableCell>
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
