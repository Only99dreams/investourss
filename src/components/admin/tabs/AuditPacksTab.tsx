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
import { Loader2, Plus, Package, Trash2, Save } from "lucide-react";
import { formatNaira } from "@/lib/auditor";

interface AuditPack {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price: number;
  validity_days: number;
  is_active: boolean;
  sort_order: number;
}

const emptyPack = { name: "", description: "", credits: 0, price: 0, validity_days: 30, sort_order: 0, is_active: true };

const AuditPacksTab = () => {
  const { toast } = useToast();
  const [packs, setPacks] = useState<AuditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Omit<AuditPack, "id">>(emptyPack);

  const fetchPacks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("audit_credit_packs")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      console.error(error);
    } else {
      setPacks(data as AuditPack[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPacks();
  }, []);

  const updateField = (id: string, field: keyof AuditPack, value: unknown) => {
    setPacks((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const savePack = async (pack: AuditPack) => {
    const { error } = await supabase
      .from("audit_credit_packs")
      .update({
        name: pack.name,
        description: pack.description,
        credits: pack.credits,
        price: pack.price,
        validity_days: pack.validity_days,
        is_active: pack.is_active,
        sort_order: pack.sort_order,
      })
      .eq("id", pack.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pack updated" });
    }
  };

  const createPack = async () => {
    if (!draft.name || draft.credits <= 0 || draft.price <= 0) {
      toast({ title: "Missing fields", description: "Name, credits and price are required.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("audit_credit_packs").insert(draft);
    if (error) {
      toast({ title: "Create failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pack created" });
      setDraft(emptyPack);
      fetchPacks();
    }
  };

  const deletePack = async (id: string) => {
    const { error } = await supabase.from("audit_credit_packs").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pack deleted" });
      setPacks((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const movePack = async (id: string, dir: -1 | 1) => {
    const sorted = [...packs].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((p) => p.id === id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const a = sorted[idx];
    const tmp = a.sort_order;
    await supabase.from("audit_credit_packs").update({ sort_order: swap.sort_order }).eq("id", a.id);
    await supabase.from("audit_credit_packs").update({ sort_order: tmp }).eq("id", swap.id);
    fetchPacks();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Package className="w-5 h-5" /> Audit Credit Packs
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
                    <TableHead className="min-w-[160px]">Name</TableHead>
                    <TableHead className="min-w-[80px]">Credits</TableHead>
                    <TableHead className="min-w-[90px]">Price (₦)</TableHead>
                    <TableHead className="min-w-[80px]">Days</TableHead>
                    <TableHead className="min-w-[70px]">Order</TableHead>
                    <TableHead className="min-w-[70px]">Active</TableHead>
                    <TableHead className="min-w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center h-24">No packs yet.</TableCell>
                    </TableRow>
                  ) : (
                    packs.map((pack) => (
                      <TableRow key={pack.id}>
                        <TableCell>
                          <Input
                            value={pack.name}
                            onChange={(e) => updateField(pack.id, "name", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={pack.credits}
                            onChange={(e) => updateField(pack.id, "credits", Number(e.target.value))}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={pack.price}
                            onChange={(e) => updateField(pack.id, "price", Number(e.target.value))}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={pack.validity_days}
                            onChange={(e) => updateField(pack.id, "validity_days", Number(e.target.value))}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => movePack(pack.id, -1)}>↑</Button>
                            <span className="text-xs text-muted-foreground">{pack.sort_order}</span>
                            <Button variant="ghost" size="sm" onClick={() => movePack(pack.id, 1)}>↓</Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={pack.is_active}
                            onCheckedChange={(v) => updateField(pack.id, "is_active", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => savePack(pack)}>
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => deletePack(pack.id)}>
                              <Trash2 className="w-4 h-4" />
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

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
            <Plus className="w-5 h-5" /> New Pack
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="grid gap-4 md:grid-cols-5">
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Starter Audit Pack" />
            </div>
            <div>
              <Label>Credits</Label>
              <Input type="number" value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Price (₦)</Label>
              <Input type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Validity (days)</Label>
              <Input type="number" value={draft.validity_days} onChange={(e) => setDraft({ ...draft, validity_days: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div>
              <Label>Description</Label>
              <Input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="2 Audit Credits · Valid 30 Days" />
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2 mb-2">
                <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
                <span className="text-sm text-muted-foreground">Active</span>
              </div>
              <Button onClick={createPack} className="ml-auto">
                <Plus className="w-4 h-4 mr-2" /> Create Pack
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <Badge variant="secondary">{draft.credits} credits · {formatNaira(draft.price)} · {draft.validity_days} days</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditPacksTab;
