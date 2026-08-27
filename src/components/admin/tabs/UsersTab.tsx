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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Search, Loader2, MoreVertical, Pencil, CheckCircle, XCircle, PieChart, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const UsersTab = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // Edit User State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    assigned_role: "",
    user_tier: "",
    user_type: "",
    access: "",
  });

  // FHA Portfolio & Followers state
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portfolio, setPortfolio] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [followers, setFollowers] = useState<any[]>([]);

  const formatNaira = (value: number) =>
    `₦${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewDetails = async (user: any) => {
    setSelectedUser(user);
    setIsDetailsDialogOpen(true);
    setDetailsLoading(true);
    setPortfolio(null);
    setFollowers([]);

    try {
      const { data: portfolioData, error: portfolioError } = await supabase
        .rpc("get_fha_portfolio", { p_target_user: user.id });
      if (portfolioError) throw portfolioError;
      setPortfolio(portfolioData);

      const { data: followersData, error: followersError } = await supabase
        .from("profiles")
        .select("id, full_name, email, user_tier, created_at, has_active_subscription, subscription_expires_at")
        .eq("referred_by", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (followersError) throw followersError;
      setFollowers(followersData || []);
    } catch (error) {
      console.error("Error loading user details:", error);
      toast({
        title: "Error",
        description: "Failed to load FHA portfolio & followers",
        variant: "destructive",
      });
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, subscription_type")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditUser = (user: any) => {
    setSelectedUser(user);
    setEditForm({
      assigned_role: user.assigned_role || "user",
      user_tier: user.user_tier || "free",
      user_type: user.user_type || "individual",
      access: user.user_tier === "free" ? "Free" : (user.subscription_type || "monthly"),
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveUser = async () => {
    try {
      if (!selectedUser) return;

      // Determine user_tier and subscription_type based on access
      const isFree = editForm.access === "Free";
      const userTier = isFree ? "free" : "premium";
      const subscriptionType = isFree ? null : editForm.access.toLowerCase();

      const { error } = await supabase
        .from("profiles")
        .update({
          assigned_role: editForm.assigned_role,
          user_tier: userTier,
          user_type: editForm.user_type,
          subscription_type: subscriptionType,
        })
        .eq("id", selectedUser.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "User updated successfully",
      });
      setIsEditDialogOpen(false);
      fetchUsers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error updating user:", error);
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive",
      });
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" /> Users Management
        </CardTitle>
        <div className="relative max-w-sm mt-2">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center h-24">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.full_name || "N/A"}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {user.assigned_role || "user"}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">
                        {user.user_type || "individual"}
                      </TableCell>
                      <TableCell className="capitalize">
                        {user.user_tier || "free"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {user.user_tier === "free" ? "Free" : (user.subscription_type || "monthly")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.profile_completed ? "default" : "secondary"}
                        >
                          {user.profile_completed ? "Active" : "Incomplete"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleEditUser(user)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleViewDetails(user)}>
                              <Eye className="mr-2 h-4 w-4" />
                              FHA Portfolio & Followers
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Make changes to user role and tier.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name
                </Label>
                <Input
                  id="name"
                  value={selectedUser?.full_name || ""}
                  disabled
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="role" className="text-right">
                  Role
                </Label>
                <Select
                  value={editForm.assigned_role}
                  onValueChange={(val) =>
                    setEditForm({ ...editForm, assigned_role: val })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                    <SelectItem value="gfe">GFE</SelectItem>
                    <SelectItem value="firm_admin">Firm Admin</SelectItem>
                    <SelectItem value="firm_staff">Firm Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="tier" className="text-right">
                  Tier
                </Label>
                <Select
                  value={editForm.user_tier}
                  onValueChange={(val) =>
                    setEditForm({ ...editForm, user_tier: val })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="exclusive">Exclusive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">
                  Type
                </Label>
                <Select
                  value={editForm.user_type}
                  onValueChange={(val) =>
                    setEditForm({ ...editForm, user_type: val })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                    <SelectItem value="firm">Firm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="access" className="text-right">
                  Access
                </Label>
                <Select
                  value={editForm.access}
                  onValueChange={(val) =>
                    setEditForm({ ...editForm, access: val })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select access level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Free">Free</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveUser}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PieChart className="w-5 h-5 text-primary" />
                FHA Portfolio & Followers
              </DialogTitle>
              <DialogDescription>
                {selectedUser?.full_name || "User"} · {selectedUser?.email}
              </DialogDescription>
            </DialogHeader>

            {detailsLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !portfolio?.has_ambassador ? (
              <p className="text-sm text-muted-foreground py-4">
                This user is not an active Financial Health Ambassador, so there is no FHA portfolio to show.
              </p>
            ) : (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Earned from Individuals</p>
                    <p className="text-lg font-bold">{formatNaira(portfolio.total_earned_individuals)}</p>
                  </div>
                  <div className="rounded-lg border bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Earned from Businesses</p>
                    <p className="text-lg font-bold">{formatNaira(portfolio.total_earned_businesses)}</p>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">Current Portfolio Value</p>
                    <p className="text-lg font-bold text-primary">{formatNaira(portfolio.current_portfolio_value)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Pack Users (Individuals)", value: portfolio.packs?.individuals?.total_users ?? 0, commission: portfolio.packs?.individuals?.total_commission ?? 0 },
                    { label: "Pack Users (Businesses)", value: portfolio.packs?.businesses?.total_users ?? 0, commission: portfolio.packs?.businesses?.total_commission ?? 0 },
                    { label: "Subscribers (Individuals)", value: portfolio.subscribers?.individuals?.total_users ?? 0, commission: portfolio.subscribers?.individuals?.total_commission ?? 0 },
                    { label: "Subscribers (Businesses)", value: portfolio.subscribers?.businesses?.total_users ?? 0, commission: portfolio.subscribers?.businesses?.total_commission ?? 0 },
                  ].map((card) => (
                    <div key={card.label} className="rounded-lg border bg-background/60 p-3">
                      <p className="text-xs text-muted-foreground">{card.label}</p>
                      <p className="text-xl font-bold">{card.value}</p>
                      <p className="text-xs text-primary font-semibold">{formatNaira(card.commission)} earned</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <p className="text-sm font-medium mb-2">
                Followers ({followers.length})
              </p>
              <div className="rounded-md border overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {followers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-16">
                          No followers yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      followers.map((follower) => (
                        <TableRow key={follower.id}>
                          <TableCell className="font-medium">{follower.full_name || "N/A"}</TableCell>
                          <TableCell>{follower.email}</TableCell>
                          <TableCell className="capitalize">{follower.user_tier || "free"}</TableCell>
                          <TableCell>
                            <Badge variant={follower.has_active_subscription ? "default" : "outline"}>
                              {follower.has_active_subscription
                                ? `Active${follower.subscription_expires_at ? ` until ${new Date(follower.subscription_expires_at).toLocaleDateString()}` : ""}`
                                : "None"}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(follower.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default UsersTab;


