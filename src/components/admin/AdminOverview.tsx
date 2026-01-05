import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, TrendingUp, Wallet, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface Stats {
  totalUsers: number;
  totalInvestments: number;
  totalWalletBalance: number;
  pendingComplaints: number;
  userGrowth: number;
  investmentGrowth: number;
}

const AdminOverview = () => {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalInvestments: 0,
    totalWalletBalance: 0,
    pendingComplaints: 0,
    userGrowth: 12.5,
    investmentGrowth: 8.3
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [usersResult, investmentsResult, walletsResult, complaintsResult] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('user_investments').select('amount'),
        supabase.from('wallets').select('user_wallet_balance, gfe_wallet_balance'),
        supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('status', 'open')
      ]);

      const totalInvestments = investmentsResult.data?.reduce((sum, inv) => sum + (inv.amount || 0), 0) || 0;
      const totalWalletBalance = walletsResult.data?.reduce((sum, w) => 
        sum + (w.user_wallet_balance || 0) + (w.gfe_wallet_balance || 0), 0) || 0;

      setStats({
        totalUsers: usersResult.count || 0,
        totalInvestments,
        totalWalletBalance,
        pendingComplaints: complaintsResult.count || 0,
        userGrowth: 12.5,
        investmentGrowth: 8.3
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
      title: "Total Investments",
      value: `₦${(stats.totalInvestments / 1000000).toFixed(1)}M`,
      change: stats.investmentGrowth,
      icon: TrendingUp,
      color: "text-accent"
    },
    {
      title: "Wallet Balances",
      value: `₦${(stats.totalWalletBalance / 1000000).toFixed(1)}M`,
      change: 5.2,
      icon: Wallet,
      color: "text-investours-gold"
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                { label: "Approve Investments", count: 5 },
                { label: "Review Complaints", count: 3 },
                { label: "Pending Withdrawals", count: 8 },
                { label: "Verify Firms", count: 2 },
              ].map((action, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
                >
                  <p className="text-sm font-medium text-foreground">{action.label}</p>
                  <p className="text-2xl font-bold text-primary">{action.count}</p>
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
