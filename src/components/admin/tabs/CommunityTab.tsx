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

const CommunityTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPosts = async () => {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select(`
          *,
          author:profiles(full_name, email)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPosts(data || []);
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

  const handleApprove = async (id: string) => {
    try {
      const { error } = await supabase
        .from("posts")
        .update({ is_approved: true })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Post approved",
      });
      fetchPosts();
    } catch (error) {
      console.error("Error approving post:", error);
      toast({
        title: "Error",
        description: "Failed to approve post",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" /> Community Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
};

export default CommunityTab;

