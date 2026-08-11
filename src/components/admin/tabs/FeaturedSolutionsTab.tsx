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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Star, Trash2 } from "lucide-react";

interface FeaturedSolution {
  id: string;
  key: string;
  title: string;
  description: string;
  path: string;
  icon: string;
  badge: string | null;
  sort_order: number;
  is_active: boolean;
}

const FeaturedSolutionsTab = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<FeaturedSolution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("featured_solutions")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      console.error(error);
    } else {
      setItems(data as FeaturedSolution[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const updateField = (id: string, field: keyof FeaturedSolution, value: unknown) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  };

  const save = async (item: FeaturedSolution) => {
    const { error } = await supabase
      .from("featured_solutions")
      .update({
        title: item.title,
        description: item.description,
        path: item.path,
        icon: item.icon,
        badge: item.badge,
        sort_order: item.sort_order,
        is_active: item.is_active,
      })
      .eq("id", item.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: "Featured solution updated." });
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((i) => i.id === id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const a = sorted[idx];
    const tmp = a.sort_order;
    await supabase.from("featured_solutions").update({ sort_order: swap.sort_order }).eq("id", a.id);
    await supabase.from("featured_solutions").update({ sort_order: tmp }).eq("id", swap.id);
    fetchItems();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Star className="w-5 h-5" /> Featured Solutions (Homepage)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[40px]">Order</TableHead>
                    <TableHead className="min-w-[180px]">Title</TableHead>
                    <TableHead className="min-w-[240px]">Description</TableHead>
                    <TableHead className="min-w-[120px]">Path</TableHead>
                    <TableHead className="min-w-[80px]">Badge</TableHead>
                    <TableHead className="min-w-[70px]">Active</TableHead>
                    <TableHead className="min-w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center h-24">No featured solutions yet.</TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => move(item.id, -1)}>↑</Button>
                            <span className="text-xs text-muted-foreground">{item.sort_order}</span>
                            <Button variant="ghost" size="sm" onClick={() => move(item.id, 1)}>↓</Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.title}
                            onChange={(e) => updateField(item.id, "title", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateField(item.id, "description", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.path}
                            onChange={(e) => updateField(item.id, "path", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.badge ?? ""}
                            onChange={(e) => updateField(item.id, "badge", e.target.value || null)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={item.is_active}
                            onCheckedChange={(v) => updateField(item.id, "is_active", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => save(item)}>
                            <Save className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-4">
            <Badge variant="secondary">Changes take effect on the homepage immediately after saving.</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FeaturedSolutionsTab;
