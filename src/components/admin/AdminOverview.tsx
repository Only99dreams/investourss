import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, TrendingUp, Wallet, AlertTriangle, ArrowUp, ArrowDown, CreditCard, CheckCircle, XCircle, Clock, DollarSign, Activity, UserCheck, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface Stats {
  totalUsers: number;
  totalInvestments: number;
  totalWalletBalance: number;
  pendingComplaints: number;
  userGrowth: number;
  investmentGrowth: number;
  // New statistics
  premiumUsers: number;
  pendingDeposits: number;
  approvedDeposits: number;
  rejectedDeposits: number;
  totalDepositsValue: number;
  totalTransactions: number;
  monthlyRevenue: number;
  activeUsers: number;
  aiQueriesToday: number;
  totalReferrals: number;
}

const AdminOverview = () => {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalInvestments: 0,
    totalWalletBalance: 0,
    pendingComplaints: 0,
    userGrowth: 12.5,
    investmentGrowth: 8.3,
    // New statistics
    premiumUsers: 0,
    pendingDeposits: 0,
    approvedDeposits: 0,
    rejectedDeposits: 0,
    totalDepositsValue: 0,
    totalTransactions: 0,
    monthlyRevenue: 0,
    activeUsers: 0,
    aiQueriesToday: 0,
    totalReferrals: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Get current date for filtering
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const [
        usersResult,
        investmentsResult,
        walletsResult,
        complaintsResult,
        premiumUsersResult,
        depositRequestsResult,
        transactionsResult,
        activeUsersResult,
        aiQueriesResult,
        referralsResult
      ] = await Promise.all([
        // Total users
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        // Total investments
        supabase.from('user_investments').select('amount'),
        // Wallet balances
        supabase.from('wallets').select('user_wallet_balance, gfe_wallet_balance'),
        // Pending complaints
        supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('status', 'open'),
        // Premium users
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('user_tier', 'premium'),
        // Deposit requests stats
        supabase.from('deposit_requests').select('status, amount, created_at'),
        // Total transactions
        supabase.from('wallet_transactions').select('*', { count: 'exact', head: true }),
        // Active users (logged in within last 30 days)
        supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('last_login', thirtyDaysAgo.toISOString()),
        // AI queries today
        supabase.from('ai_search_logs').select('*', { count: 'exact', head: true }).gte('created_at', startOfToday.toISOString()),
        // Total referrals
        supabase.from('referral_commissions').select('*', { count: 'exact', head: true })
      ]);

      const totalInvestments = investmentsResult.data?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
      const totalWalletBalance = walletsResult.data?.reduce((sum, w) =>
        sum + (w.user_wallet_balance || 0) + (w.gfe_wallet_balance || 0), 0) || 0;

      // Calculate deposit statistics
      const deposits = depositRequestsResult.data || [];
      const pendingDeposits = deposits.filter(d => d.status === 'pending').length;
      const approvedDeposits = deposits.filter(d => d.status === 'approved').length;
      const rejectedDeposits = deposits.filter(d => d.status === 'rejected').length;
      const totalDepositsValue = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);
      const monthlyRevenue = deposits
        .filter(d => d.status === 'approved' && new Date(d.created_at) >= thirtyDaysAgo)
        .reduce((sum, d) => sum + (d.amount || 0), 0);

      setStats({
        totalUsers: usersResult.count || 0,
        totalInvestments,
        totalWalletBalance,
        pendingComplaints: complaintsResult.count || 0,
        userGrowth: 12.5,
        investmentGrowth: 8.3,
        premiumUsers: premiumUsersResult.count || 0,
        pendingDeposits,
        approvedDeposits,
        rejectedDeposits,
        totalDepositsValue,
        totalTransactions: transactionsResult.count || 0,
        monthlyRevenue,
        activeUsers: activeUsersResult.count || 0,
        aiQueriesToday: aiQueriesResult.count || 0,
        totalReferrals: referralsResult.count || 0
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      change: stats.userGrowth,
      icon: Users,
      color: "text-primary"
    },
    {
      title: "Active Users (30d)",
      value: stats.activeUsers.toLocaleString(),
      change: 8.2,
      icon: UserCheck,
      color: "text-accent"
    },
    {
      title: "Premium Users",
      value: stats.premiumUsers.toLocaleString(),
      change: 15.3,
      icon: CreditCard,
      color: "text-investours-gold"
    },
    {
      title: "Total Investments",
      value: `₦${(stats.totalInvestments / 1000000).toFixed(1)}M`,
      change: stats.investmentGrowth,
      icon: TrendingUp,
      color: "text-green-600"
    },
    {
      title: "Wallet Balances",
      value: `₦${(stats.totalWalletBalance / 1000000).toFixed(1)}M`,
      change: 5.2,
      icon: Wallet,
      color: "text-blue-600"
    },
    {
      title: "Monthly Revenue",
      value: `₦${(stats.monthlyRevenue / 1000).toFixed(0)}K`,
      change: 12.8,
      icon: DollarSign,
      color: "text-emerald-600"
    },
    {
      title: "Pending Deposits",
      value: stats.pendingDeposits.toString(),
      change: 2.1,
      icon: Clock,
      color: "text-orange-600"
    },
    {
      title: "Approved Deposits",
      value: stats.approvedDeposits.toString(),
      change: 18.5,
      icon: CheckCircle,
      color: "text-green-500"
    },
    {
      title: "Total Transactions",
      value: stats.totalTransactions.toLocaleString(),
      change: 9.7,
      icon: Activity,
      color: "text-purple-600"
    },
    {
      title: "AI Queries Today",
      value: stats.aiQueriesToday.toString(),
      change: 24.3,
      icon: BarChart3,
      color: "text-indigo-600"
    },
    {
      title: "Total Referrals",
      value: stats.totalReferrals.toString(),
      change: 6.9,
      icon: Users,
      color: "text-teal-600"
    },
    {
      title: "Pending Complaints",
      value: stats.pendingComplaints.toString(),
      change: -3.1,
      icon: AlertTriangle,
      color: "text-destructive"
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard Overview</h1>
        <p className="text-muted-foreground">Welcome back, here's what's happening with Investours.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="flex items-center gap-1 text-xs">
                  {stat.change >= 0 ? (
                    <ArrowUp className="w-3 h-3 text-accent" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-destructive" />
                  )}
                  <span className={stat.change >= 0 ? "text-accent" : "text-destructive"}>
                    {Math.abs(stat.change)}%
                  </span>
                  <span className="text-muted-foreground">from last month</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Additional Statistics Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Deposit Overview</CardTitle>
            <CardDescription>Deposit request statistics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pending</span>
                <span className="text-lg font-semibold text-orange-600">{stats.pendingDeposits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Approved</span>
                <span className="text-lg font-semibold text-green-600">{stats.approvedDeposits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Rejected</span>
                <span className="text-lg font-semibold text-red-600">{stats.rejectedDeposits}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Total Value</span>
                  <span className="text-lg font-bold">₦{stats.totalDepositsValue.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User Engagement</CardTitle>
            <CardDescription>User activity metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Users (30d)</span>
                <span className="text-lg font-semibold text-blue-600">{stats.activeUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Premium Users</span>
                <span className="text-lg font-semibold text-gold-600">{stats.premiumUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">AI Queries Today</span>
                <span className="text-lg font-semibold text-purple-600">{stats.aiQueriesToday}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Engagement Rate</span>
                  <span className="text-lg font-bold">
                    {stats.totalUsers > 0 ? ((stats.activeUsers / stats.totalUsers) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financial Summary</CardTitle>
            <CardDescription>Revenue and transaction metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monthly Revenue</span>
                <span className="text-lg font-semibold text-green-600">₦{(stats.monthlyRevenue / 1000).toFixed(0)}K</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Transactions</span>
                <span className="text-lg font-semibold text-indigo-600">{stats.totalTransactions.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Referrals</span>
                <span className="text-lg font-semibold text-teal-600">{stats.totalReferrals}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Avg Transaction</span>
                  <span className="text-lg font-bold">
                    ₦{stats.totalTransactions > 0 ? (stats.totalWalletBalance / stats.totalTransactions).toFixed(0) : 0}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest platform activities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { action: "New user registered", user: "John Doe", time: "2 minutes ago" },
                { action: "Investment submitted", user: "ABC Firm", time: "15 minutes ago" },
                { action: "Withdrawal request", user: "Jane Smith", time: "1 hour ago" },
                { action: "Scam reported", user: "Mike Johnson", time: "2 hours ago" },
              ].map((activity, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{activity.action}</p>
                    <p className="text-xs text-muted-foreground">{activity.user}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Pending Deposits", count: stats.pendingDeposits, color: "text-orange-600" },
                { label: "Review Complaints", count: stats.pendingComplaints, color: "text-red-600" },
                { label: "Active Users", count: stats.activeUsers, color: "text-green-600" },
                { label: "AI Queries Today", count: stats.aiQueriesToday, color: "text-blue-600" },
              ].map((action, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
                >
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className={`text-2xl font-bold ${action.color}`}>{action.count}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminOverview;
