import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, History, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Transaction tables added after the generated Database types were last refreshed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Category =
  | "wallet"
  | "deposit"
  | "withdrawal"
  | "subscription"
  | "audit_pack"
  | "investment"
  | "bookmaker"
  | "audiobook";
type CategoryFilter = Category | "all";
type Direction = "in" | "out" | "none";
type RangeKey = "7d" | "30d" | "90d" | "all";

interface LedgerEntry {
  key: string;
  category: Category;
  title: string;
  detail: string | null;
  reference: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  amount: number;
  unit: "naira" | "credits";
  direction: Direction;
  status: string;
  createdAt: string;
}

interface WalletTransactionRow {
  id: string;
  wallet_id: string;
  transaction_type: string | null;
  amount: number | null;
  narration: string | null;
  source: string | null;
  status: string | null;
  actor_id: string | null;
  created_at: string | null;
}

interface SubscriptionPaymentRow {
  id: string;
  user_id: string;
  reference: string | null;
  plan_type: string | null;
  amount_kobo: number | null;
  status: string | null;
  promo_code_id: string | null;
  created_at: string | null;
}

interface AuditPackPaymentRow {
  id: string;
  user_id: string;
  reference: string | null;
  amount_kobo: number | null;
  status: string | null;
  created_at: string | null;
}

interface DepositRequestRow {
  id: string;
  user_id: string;
  amount: number | null;
  payment_method: string | null;
  reference_number: string | null;
  depositor_name: string | null;
  wallet_type: string | null;
  status: string | null;
  created_at: string | null;
}

interface WithdrawalRequestRow {
  id: string;
  user_id: string;
  amount: number | null;
  gross_amount: number | null;
  fee_amount: number | null;
  wallet_type: string | null;
  status: string | null;
  created_at: string | null;
}

interface InvestmentRow {
  id: string;
  user_id: string;
  amount: number | null;
  status: string | null;
  created_at: string | null;
}

interface CreditOperationRow {
  id: string;
  user_id: string;
  operation: string | null;
  credit_cost: number | null;
  status: string | null;
  created_at: string | null;
}

interface AudiobookDownloadRow {
  id: string;
  user_id: string;
  item_key: string | null;
  cost_credits: number | null;
  created_at: string | null;
}

interface WalletOwnerRow {
  id: string;
  user_id: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

const FETCH_LIMIT = 1000;
const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

const RANGE_DAYS: Record<Exclude<RangeKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "wallet", label: "Wallet movements" },
  { value: "deposit", label: "Deposits" },
  { value: "withdrawal", label: "Withdrawals" },
  { value: "subscription", label: "Subscriptions" },
  { value: "audit_pack", label: "Audit packs" },
  { value: "investment", label: "Investments" },
  { value: "bookmaker", label: "BookMaker credits" },
  { value: "audiobook", label: "Audiobook credits" },
];

const CATEGORY_LABELS: Record<Category, string> = {
  wallet: "Wallet",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  subscription: "Subscription",
  audit_pack: "Audit pack",
  investment: "Investment",
  bookmaker: "BookMaker",
  audiobook: "Audiobook",
};

const STATUS_OPTIONS = ["all", "completed", "pending", "approved", "rejected", "failed", "cancelled", "active"];

const SETTLED_STATUSES = new Set(["completed", "approved", "active", "success", "paid"]);

// These wallet rows are mirrors of richer ledgers (deposit/withdrawal requests and
// audit pack payments) and would double-count the same event.
const MIRRORED_WALLET_SOURCES = new Set([
  "audit_pack_payment",
  "manual_deposit",
  "deposit_approval",
  "withdrawal",
]);

const SOURCE_LABELS: Record<string, string> = {
  admin_manual: "Admin wallet adjustment",
  manual_deposit: "Bank deposit",
  deposit_approval: "Bank deposit",
  subscription_payment: "Subscription payment",
  ambassador_commission: "Ambassador commission",
  withdrawal: "Withdrawal",
  credit_pack: "Audit credit pack",
  investment: "Investment",
  investment_referral: "Investment referral bonus",
  referral_reward: "Referral reward",
  referral_system: "Referral reward",
  referral_code: "Referral reward",
  onboarding_bonus: "Onboarding bonus",
  subscription: "Subscription payment",
  audit: "Audit credits",
  bookmaker: "BookMaker credits",
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

const humanize = (value: string | null | undefined) =>
  (value || "Transaction").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const planLabel = (value: string | null | undefined) =>
  value ? humanize(value) : "Subscription";

const naira = (value: number) =>
  `₦${Math.abs(value).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const amountLabel = (entry: LedgerEntry) => {
  if (entry.unit === "credits") {
    const credits = Math.abs(entry.amount).toLocaleString("en-NG");
    return `${credits} credit${Math.abs(entry.amount) === 1 ? "" : "s"}`;
  }
  const value = naira(entry.amount);
  if (entry.direction === "in") return `+${value}`;
  if (entry.direction === "out") return `−${value}`;
  return value;
};

const statusVariant = (status: string) => {
  const value = status.toLowerCase();
  if (["completed", "approved", "active", "success", "paid"].includes(value)) return "default" as const;
  if (["pending", "processing"].includes(value)) return "secondary" as const;
  return "destructive" as const;
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
};

const TransactionHistoryTab = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [range, setRange] = useState<RangeKey>("30d");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const cutoff =
          range === "all" ? null : new Date(Date.now() - RANGE_DAYS[range] * DAY_MS).toISOString();

        const scoped = (table: string, columns: string) => {
          let query = db
            .from(table)
            .select(columns)
            .order("created_at", { ascending: false })
            .limit(FETCH_LIMIT);
          if (cutoff) query = query.gte("created_at", cutoff);
          return query;
        };

        const [
          walletRes,
          depositRes,
          withdrawalRes,
          subscriptionRes,
          auditRes,
          investmentRes,
          operationRes,
          audiobookRes,
        ] =
          (await Promise.all([
            scoped(
              "wallet_transactions",
              "id, wallet_id, transaction_type, amount, narration, source, status, actor_id, created_at",
            ),
            scoped(
              "deposit_requests",
              "id, user_id, amount, payment_method, reference_number, depositor_name, wallet_type, status, created_at",
            ),
            scoped(
              "withdrawal_requests",
              "id, user_id, amount, gross_amount, fee_amount, wallet_type, status, created_at",
            ),
            scoped(
              "subscription_payments",
              "id, user_id, reference, plan_type, amount_kobo, status, promo_code_id, created_at",
            ),
            scoped("audit_pack_payments", "id, user_id, reference, amount_kobo, status, created_at"),
            scoped("user_investments", "id, user_id, amount, status, created_at"),
            scoped(
              "bookmaker_credit_operations",
              "id, user_id, operation, credit_cost, status, created_at",
            ).gt("credit_cost", 0),
            scoped(
              "bookmaker_audio_downloads",
              "id, user_id, item_key, cost_credits, created_at",
            ).gt("cost_credits", 0),
          ])) as [
            QueryResult<WalletTransactionRow>,
            QueryResult<DepositRequestRow>,
            QueryResult<WithdrawalRequestRow>,
            QueryResult<SubscriptionPaymentRow>,
            QueryResult<AuditPackPaymentRow>,
            QueryResult<InvestmentRow>,
            QueryResult<CreditOperationRow>,
            QueryResult<AudiobookDownloadRow>,
          ];

        const failures = [
          walletRes.error,
          depositRes.error,
          withdrawalRes.error,
          subscriptionRes.error,
          auditRes.error,
          investmentRes.error,
          operationRes.error,
          audiobookRes.error,
        ].filter(Boolean) as { message: string }[];
        if (failures.length > 0) {
          setError(`Some sources could not be loaded: ${failures.map((item) => item.message).join("; ")}`);
        }

        const walletRows = (walletRes.data ?? []).filter(
          (row) => !MIRRORED_WALLET_SOURCES.has(row.source ?? ""),
        );
        const depositRows = depositRes.data ?? [];
        const withdrawalRows = withdrawalRes.data ?? [];
        const subscriptionRows = subscriptionRes.data ?? [];
        const auditRows = auditRes.data ?? [];
        const investmentRows = investmentRes.data ?? [];
        const operationRows = operationRes.data ?? [];
        const audiobookRows = audiobookRes.data ?? [];

        setTruncated(
          [
            walletRows,
            depositRows,
            withdrawalRows,
            subscriptionRows,
            auditRows,
            investmentRows,
            operationRows,
            audiobookRows,
          ].some((rows) => rows.length >= FETCH_LIMIT),
        );

        // Wallet rows only carry the wallet id, so resolve each wallet to its owner.
        const walletOwners = new Map<string, string>();
        const walletIds = Array.from(new Set(walletRows.map((row) => row.wallet_id).filter(Boolean)));
        for (const batch of chunk(walletIds, 400)) {
          const { data } = (await db
            .from("wallets")
            .select("id, user_id")
            .in("id", batch)) as QueryResult<WalletOwnerRow>;
          (data ?? []).forEach((row) => walletOwners.set(row.id, row.user_id));
        }

        const profiles = new Map<string, ProfileRow>();
        const userIds = [
          ...walletRows.map((row) => walletOwners.get(row.wallet_id)),
          ...walletRows.map((row) => row.actor_id),
          ...depositRows.map((row) => row.user_id),
          ...withdrawalRows.map((row) => row.user_id),
          ...subscriptionRows.map((row) => row.user_id),
          ...auditRows.map((row) => row.user_id),
          ...investmentRows.map((row) => row.user_id),
          ...operationRows.map((row) => row.user_id),
          ...audiobookRows.map((row) => row.user_id),
        ].filter((value): value is string => Boolean(value));
        for (const batch of chunk(Array.from(new Set(userIds)), 400)) {
          const { data } = (await db
            .from("profiles")
            .select("id, full_name, email")
            .in("id", batch)) as QueryResult<ProfileRow>;
          (data ?? []).forEach((row) => profiles.set(row.id, row));
        }

        const withMember = (userId: string | null) => {
          const profile = userId ? profiles.get(userId) : undefined;
          return {
            userId,
            userName: profile?.full_name || profile?.email || null,
            userEmail: profile?.email ?? null,
          };
        };

        const ledger: LedgerEntry[] = [];

        walletRows.forEach((row) => {
          const member = withMember(walletOwners.get(row.wallet_id) ?? null);
          const actor = row.actor_id ? profiles.get(row.actor_id) : undefined;
          const actorNote =
            row.source === "admin_manual" && actor
              ? `Recorded by ${actor.full_name || actor.email || "admin"}`
              : null;
          ledger.push({
            key: `wallet-${row.id}`,
            category: "wallet",
            title: SOURCE_LABELS[row.source ?? ""] ?? humanize(row.source),
            detail: [row.narration?.trim(), actorNote].filter(Boolean).join(" · ") || null,
            reference: null,
            ...member,
            amount: Number(row.amount) || 0,
            unit: "naira",
            direction: row.transaction_type === "debit" ? "out" : "in",
            status: row.status || "completed",
            createdAt: row.created_at ?? "",
          });
        });

        depositRows.forEach((row) => {
          const method = row.payment_method ? humanize(row.payment_method) : "Bank transfer";
          const wallet = row.wallet_type ? humanize(row.wallet_type) : null;
          ledger.push({
            key: `deposit-${row.id}`,
            category: "deposit",
            title: "Deposit request",
            detail: [method, row.depositor_name, wallet].filter(Boolean).join(" · "),
            reference: row.reference_number,
            ...withMember(row.user_id),
            amount: Number(row.amount) || 0,
            unit: "naira",
            direction: "in",
            status: row.status || "pending",
            createdAt: row.created_at ?? "",
          });
        });

        withdrawalRows.forEach((row) => {
          const gross = Number(row.gross_amount) || Number(row.amount) || 0;
          const fee = Number(row.fee_amount) || 0;
          const net = Number(row.amount) || gross - fee;
          const wallet = row.wallet_type ? humanize(row.wallet_type) : null;
          ledger.push({
            key: `withdrawal-${row.id}`,
            category: "withdrawal",
            title: "Withdrawal request",
            detail: [
              fee > 0 ? `Net ${naira(net)} after ${naira(fee)} fee` : null,
              wallet,
            ]
              .filter(Boolean)
              .join(" · "),
            reference: null,
            ...withMember(row.user_id),
            amount: gross,
            unit: "naira",
            direction: "out",
            status: row.status || "pending",
            createdAt: row.created_at ?? "",
          });
        });

        subscriptionRows.forEach((row) => {
          ledger.push({
            key: `subscription-${row.id}`,
            category: "subscription",
            title: "Subscription payment",
            detail: `${planLabel(row.plan_type)} plan${row.promo_code_id ? " · promo code applied" : ""}`,
            reference: row.reference,
            ...withMember(row.user_id),
            amount: (Number(row.amount_kobo) || 0) / 100,
            unit: "naira",
            direction: "in",
            status: row.status || "completed",
            createdAt: row.created_at ?? "",
          });
        });

        auditRows.forEach((row) => {
          ledger.push({
            key: `audit-pack-${row.id}`,
            category: "audit_pack",
            title: "Audit credit pack",
            detail: "Paystack payment",
            reference: row.reference,
            ...withMember(row.user_id),
            amount: (Number(row.amount_kobo) || 0) / 100,
            unit: "naira",
            direction: "in",
            status: row.status || "completed",
            createdAt: row.created_at ?? "",
          });
        });

        investmentRows.forEach((row) => {
          ledger.push({
            key: `investment-${row.id}`,
            category: "investment",
            title: "Investment placed",
            detail: "Capital committed to an opportunity",
            reference: null,
            ...withMember(row.user_id),
            amount: Number(row.amount) || 0,
            unit: "naira",
            direction: "in",
            status: row.status || "active",
            createdAt: row.created_at ?? "",
          });
        });

        operationRows.forEach((row) => {
          ledger.push({
            key: `bookmaker-${row.id}`,
            category: "bookmaker",
            title: OPERATION_LABELS[row.operation ?? ""] ?? humanize(row.operation),
            detail: "AI credit spend",
            reference: null,
            ...withMember(row.user_id),
            amount: Number(row.credit_cost) || 0,
            unit: "credits",
            direction: "out",
            status: row.status || "completed",
            createdAt: row.created_at ?? "",
          });
        });

        audiobookRows.forEach((row) => {
          ledger.push({
            key: `audiobook-${row.id}`,
            category: "audiobook",
            title: "Audiobook download",
            detail: row.item_key === "full" ? "Complete audiobook" : humanize(row.item_key),
            reference: null,
            ...withMember(row.user_id),
            amount: Number(row.cost_credits) || 0,
            unit: "credits",
            direction: "out",
            status: "completed",
            createdAt: row.created_at ?? "",
          });
        });

        ledger.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setEntries(ledger.filter((entry) => Boolean(entry.createdAt)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load transaction history.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, category, status, range]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (status !== "all" && entry.status.toLowerCase() !== status) return false;
      if (!query) return true;
      return [
        entry.userName,
        entry.userEmail,
        entry.title,
        entry.detail,
        entry.reference,
        entry.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [entries, search, category, status]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, entry) => {
        if (!SETTLED_STATUSES.has(entry.status.toLowerCase())) return acc;
        if (entry.unit === "credits") {
          acc.credits += Math.abs(entry.amount);
        } else if (entry.direction === "in") {
          acc.inflow += entry.amount;
        } else if (entry.direction === "out") {
          acc.outflow += Math.abs(entry.amount);
        }
        return acc;
      },
      { inflow: 0, outflow: 0, credits: 0 },
    );
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(currentPage * PAGE_SIZE, filtered.length);

  const summaryCards = [
    { label: "Total inflow", value: naira(totals.inflow), tone: "text-emerald-600" },
    { label: "Total outflow", value: naira(totals.outflow), tone: "text-rose-600" },
    { label: "Net position", value: naira(totals.inflow - totals.outflow), tone: "text-foreground" },
    {
      label: "AI credits spent",
      value: `${totals.credits.toLocaleString("en-NG")} credits`,
      tone: "text-primary",
    },
  ];

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Transaction History
            </CardTitle>
            <CardDescription>
              One ledger for every wallet movement, deposit, withdrawal, payment, investment and AI
              credit spend on the platform. Totals count settled entries only; amounts are in Naira
              unless marked as credits.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void load()}
            disabled={loading || refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRange(option.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                range === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search member, reference or narration"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={category} onValueChange={(value) => setCategory(value as CategoryFilter)}>
            <SelectTrigger aria-label="Filter by activity type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All statuses" : humanize(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </p>
              <p className={cn("mt-2 text-lg font-semibold tabular-nums", card.tone)}>{card.value}</p>
            </div>
          ))}
        </div>

        {truncated ? (
          <p className="text-xs text-muted-foreground">
            Some sources hold more than {FETCH_LIMIT.toLocaleString("en-NG")} records in this period.
            Choose a shorter date range to see older activity.
          </p>
        ) : null}

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center">
                        {entries.length === 0
                          ? "No transactions in this period."
                          : "No transactions match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((entry) => (
                      <TableRow key={entry.key}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {dateTime(entry.createdAt)}
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <p className="text-sm font-medium">{entry.userName || "Unknown member"}</p>
                          {entry.userEmail && entry.userName !== entry.userEmail ? (
                            <p className="text-xs text-muted-foreground">{entry.userEmail}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-[150px]">
                          <p className="text-sm">{entry.title}</p>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {CATEGORY_LABELS[entry.category]}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="truncate text-xs text-muted-foreground" title={entry.detail ?? undefined}>
                            {entry.detail || "—"}
                          </p>
                          {entry.reference ? (
                            <p className="truncate text-[11px] text-muted-foreground/80" title={entry.reference}>
                              Ref: {entry.reference}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "whitespace-nowrap text-right text-sm font-semibold tabular-nums",
                            entry.direction === "in"
                              ? "text-emerald-600"
                              : entry.direction === "out"
                                ? "text-rose-600"
                                : "text-muted-foreground",
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {entry.direction === "in" ? (
                              <ArrowDownLeft className="h-3.5 w-3.5" />
                            ) : entry.direction === "out" ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : null}
                            {amountLabel(entry)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(entry.status)} className="capitalize">
                            {entry.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {firstShown.toLocaleString("en-NG")}–{lastShown.toLocaleString("en-NG")} of{" "}
                {filtered.length.toLocaleString("en-NG")} events
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TransactionHistoryTab;
