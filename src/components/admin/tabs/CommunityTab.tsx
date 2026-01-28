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
import { Loader2, MessageSquare, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const CommunityTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user, roles, profile } = useAuth();

  const isAdmin = roles?.includes('admin') || profile?.assigned_role === 'admin';

  useEffect(() => {
    if (user && isAdmin) {
      fetchPosts();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  const fetchPosts = async () => {
    try {
      console.log("Fetching posts for admin...");
      // First try to fetch posts without join to isolate the issue
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (postsError) {
        console.error("Posts query error:", postsError);
        throw postsError;
      }

      console.log("Posts fetched:", postsData?.length || 0, "posts");

      // Now fetch author profiles separately
      if (postsData && postsData.length > 0) {
        const authorIds = postsData.map(post => post.author_id);
        const { data: profilesData, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", authorIds);

        if (profilesError) {
          console.error("Profiles query error:", profilesError);
        }

        // Combine posts with author data
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
      toast({
        title: "Error",
        description: "Failed to fetch posts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleHidden = async (id: string, currentHidden: boolean) => {
    try {
      const { error } = await supabase
        .from("posts")
        .update({ is_hidden: !currentHidden })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Post ${!currentHidden ? "hidden" : "visible"}`,
      });
      fetchPosts();
    } catch (error) {
      console.error("Error updating post:", error);
      toast({
        title: "Error",
        description: "Failed to update post",
        variant: "destructive",
      });
    }
  };

  const createSamplePost = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("posts")
        .insert({
          author_id: user.id,
          content: "This is a sample post for testing the community management system.",
          category: "announcement",
          is_approved: false,
          is_hidden: false
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Sample post created",
      });
      fetchPosts();
    } catch (error) {
      console.error("Error creating sample post:", error);
      toast({
        title: "Error",
        description: "Failed to create sample post",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> Community Management
          </CardTitle>
          {isAdmin && (
            <div className="flex gap-2">
              <Button onClick={fetchPosts} variant="outline" size="sm">
                Refresh Posts
              </Button>
              {posts.length === 0 && (
                <Button onClick={createSamplePost} variant="outline" size="sm">
                  Create Sample Post
                </Button>
              )}
            </div>
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
                  <p><strong>Roles from user_roles table:</strong> {roles?.join(', ') || 'none'}</p>
                  <p><strong>Assigned role from profile:</strong> {profile?.assigned_role || 'none'}</p>
                  <p><strong>Is Admin:</strong> {isAdmin ? 'Yes' : 'No'}</p>
                </div>
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">To fix this issue:</p>
                  <p className="text-sm">Ensure the user has admin privileges in the database.</p>
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
            <div className="rounded-md border">
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
                      <TableCell colSpan={6} className="text-center h-24">
                        No posts found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    posts.map((post) => (
                      <TableRow key={post.id}>
                        <TableCell className="font-medium">
                          {post.author?.full_name || "N/A"}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {post.author?.email}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {post.content}
                        </TableCell>
                        <TableCell className="capitalize">{post.category}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {post.is_approved ? (
                              <Badge variant="default">Approved</Badge>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                            {post.is_hidden && (
                              <Badge variant="destructive">Hidden</Badge>
                            )}
                          </div>
                        </TableCell>
                      <TableCell>
                        {new Date(post.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {!post.is_approved && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleApprove(post.id)}
                              title="Approve"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
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
                            {post.is_hidden ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
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
  );
};

export default CommunityTab;

