import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Coins,
  Headphones,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type RangeKey = "today" | "7d" | "30d" | "all_time" | "per_user";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all_time", label: "All time" },
  { key: "per_user", label: "Per user" },
];

interface AnalyticsUser {
  id: string;
  name: string;
  email: string | null;
  subscription_type: string | null;
  subscription_expires_at: string | null;
  pack_credits: number;
  subscription_credits: number;
}

interface AnalyticsMetrics {
  total_users: number;
  active_users: number;
  paying_customers: number;
  revenue_kobo: number;
  ebooks_generated: number;
  audiobooks_generated: number;
  failed_generations: number;
}

interface TransactionRow {
  id: string;
  kind: "subscription" | "credits";
  label: string;
  user_id: string;
  user_name: string;
  email: string | null;
  amount_kobo: number;
  status: string;
  reference: string;
  created_at: string;
}

interface GenerationRow {
  id: string;
  operation: string;
  status: string;
  book_id: string | null;
  book_title: string;
  user_id: string;
  user_name: string;
  credit_cost: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AnalyticsResponse {
  success: boolean;
  message?: string;
  range: string;
  start: string | null;
  user: AnalyticsUser | null;
  metrics: AnalyticsMetrics;
  recent_transactions: TransactionRow[];
  recent_generations: GenerationRow[];
}

const EMPTY_METRICS: AnalyticsMetrics = {
  total_users: 0,
  active_users: 0,
  paying_customers: 0,
  revenue_kobo: 0,
  ebooks_generated: 0,
  audiobooks_generated: 0,
  failed_generations: 0,
};

const naira = (kobo: number) => `₦${Math.round((Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const dateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const planLabel = (value: string | null | undefined) => {
  if (!value) return "Free";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const OPERATION_LABELS: Record<string, string> = {
  initial_book: "Ebook written",
  full_rework: "Full rework",
  full_regeneration: "Full regeneration",
  audiobook: "Audiobook narrated",
  chapter_regeneration: "Chapter rewritten",
  visual_regeneration: "Visual refreshed",
  cover_generation: "Cover designed",
};

const BookmakerAITab = () => {
  const [range, setRange] = useState<RangeKey>("30d");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userQuery, setUserQuery] = useState("");
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRange: RangeKey = range === "per_user" ? "all_time" : range;

  const loadProfiles = useCallback(async () => {
    const { data: rows } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("created_at", { ascending: false })
      .limit(1000);
    setProfiles(rows ?? []);
  }, []);

  const loadAnalytics = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        // Stay bound to the client: supabase-js reads `this.rest` inside rpc().
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rpc = (supabase.rpc as any).bind(supabase) as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
        const { data: result, error: rpcError } = await rpc("bookmaker_admin_analytics", {
          p_range: activeRange,
          p_user_id: range === "per_user" && selectedUserId ? selectedUserId : null,
        });
        if (rpcError) throw new Error(rpcError.message);
        const response = result as AnalyticsResponse;
        if (!response?.success) throw new Error(response?.message || "Could not load BookMaker analytics.");
        setData(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load BookMaker analytics.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeRange, range, selectedUserId],
  );

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    void loadAnalytics(true);
  }, [loadAnalytics]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAnalytics();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadAnalytics]);

  const filteredProfiles = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return profiles.slice(0, 50);
    return profiles
      .filter((profile) =>
        `${profile.full_name ?? ""} ${profile.email ?? ""}`.toLowerCase().includes(query),
      )
      .slice(0, 50);
  }, [profiles, userQuery]);

  const metrics = data?.metrics ?? EMPTY_METRICS;
  const user = data?.user ?? null;

  const cards = [
    { label: "Total Users", value: metrics.total_users.toLocaleString("en-NG"), icon: Users, color: "text-sky-600" },
    { label: "Active Users", value: metrics.active_users.toLocaleString("en-NG"), icon: TrendingUp, color: "text-emerald-600" },
    { label: "Paying Customers", value: metrics.paying_customers.toLocaleString("en-NG"), icon: Wallet, color: "text-investours-gold" },
    { label: "Total Revenue", value: naira(metrics.revenue_kobo), icon: Coins, color: "text-emerald-600" },
    { label: "Ebooks Generated", value: metrics.ebooks_generated.toLocaleString("en-NG"), icon: BookOpen, color: "text-primary" },
    { label: "Audiobooks Generated", value: metrics.audiobooks_generated.toLocaleString("en-NG"), icon: Headphones, color: "text-purple-600" },
    { label: "Failed Generations", value: metrics.failed_generations.toLocaleString("en-NG"), icon: AlertTriangle, color: "text-rose-600" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <Card>
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <BarChart3 className="h-5 w-5 text-primary" /> BookMaker AI — Admin Dashboard
              </CardTitle>
              <CardDescription>
                Live figures from payments and generation records. Revenue counts successful payments only; generation
                counts are successful completions.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAnalytics()}
              disabled={loading || refreshing}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Refresh
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  range === option.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {range === "per_user" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bookmaker-user-search">Find a member</Label>
                <Input
                  id="bookmaker-user-search"
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Search by name or email"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Member</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a member" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.full_name || profile.email || profile.id}
                        {profile.email && profile.full_name ? ` · ${profile.email}` : ""}
                      </SelectItem>
                    ))}
                    {filteredProfiles.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No members match that search.</div>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4 px-4 md:px-6">
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cards.map((card) => (
                <div key={card.label} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <card.icon className={cn("h-4 w-4", card.color)} />
                    <span className="text-[11px] font-medium uppercase tracking-wide">{card.label}</span>
                  </div>
                  <p className="mt-2 text-xl font-semibold tabular-nums">{card.value}</p>
                </div>
              ))}
            </div>
          )}

          {range === "per_user" && user ? (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email || "No email on file"}</p>
                </div>
                <Badge variant="secondary">{planLabel(user.subscription_type)} plan</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Subscription credits</p>
                  <p className="text-sm font-semibold">{user.subscription_credits}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pack credits</p>
                  <p className="text-sm font-semibold">{user.pack_credits}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Plan expires</p>
                  <p className="text-sm font-semibold">
                    {user.subscription_expires_at ? dateTime(user.subscription_expires_at).split(",")[0] : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Revenue in range</p>
                  <p className="text-sm font-semibold">{naira(metrics.revenue_kobo)}</p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <CardDescription>Successful and pending subscription and credit-pack payments.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2 md:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.recent_transactions ?? []).map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(row.created_at)}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{row.user_name}</p>
                      <p className="text-xs text-muted-foreground">{row.email || "—"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{row.label}</p>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {row.kind === "subscription" ? "Subscription" : "Credit pack"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">{naira(row.amount_kobo)}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "completed" ? "default" : "secondary"}>{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.recent_transactions ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      No payments in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Book Generations</CardTitle>
          <CardDescription>Every AI action on a book, including failures.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2 md:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Book</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.recent_generations ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(row.created_at)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">{row.book_title}</TableCell>
                    <TableCell className="text-sm">{row.user_name}</TableCell>
                    <TableCell className="text-sm">{OPERATION_LABELS[row.operation] ?? row.operation}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "completed" ? "default" : row.status === "failed" ? "destructive" : "secondary"
                        }
                      >
                        {row.status}
                      </Badge>
                      {row.error ? (
                        <p className="mt-1 max-w-[180px] truncate text-[11px] text-destructive" title={row.error}>
                          {row.error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{row.credit_cost}</TableCell>
                  </TableRow>
                ))}
                {(data?.recent_generations ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      No generations in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BookmakerAITab;
