import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, TrendingUp, Wallet, AlertTriangle, ArrowUp, ArrowDown, CreditCard, CheckCircle, XCircle, Clock, DollarSign, Activity, UserCheck, BarChart3, Brain, Shield, BookOpen, Zap } from "lucide-react";
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

interface AIImpact {
  // Financial Tutor — usage
  tutorTotal: number;
  tutorCompletionRate: number;
  tutorPartialRate: number;
  tutorNotCompletedRate: number;
  tutorLearningImprovedPct: number;
  tutorPreWellPct: number;
  tutorPreSlightlyPct: number;
  tutorPreNotAtAllPct: number;
  tutorPostWellPct: number;
  tutorHelpfulPct: number;
  tutorSomewhatHelpfulPct: number;
  tutorNotHelpfulPct: number;
  tutorWantsAdvancedPct: number;
  tutorMaybeAdvancedPct: number;
  // Scam Detector — usage from ai_search_logs
  scamQuickTotal: number;
  scamDeepTotal: number;
  // Scam Detector — survey
  scamTotal: number;
  scamIdentifiedRiskPct: number;
  scamNotSurePct: number;
  scamAvoidedPct: number;
  scamCautiousPct: number;
  scamContinuedPct: number;
  scamMoreConfidentPct: number;
  scamSlightlyConfidentPct: number;
  scamNoDifferencePct: number;
  // Survey response rate (surveys / ai_search_logs)
  surveyResponseRatePct: number;
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
  const [aiImpact, setAIImpact] = useState<AIImpact>({
    tutorTotal: 0,
    tutorCompletionRate: 0,
    tutorPartialRate: 0,
    tutorNotCompletedRate: 0,
    tutorLearningImprovedPct: 0,
    tutorPreWellPct: 0,
    tutorPreSlightlyPct: 0,
    tutorPreNotAtAllPct: 0,
    tutorPostWellPct: 0,
    tutorHelpfulPct: 0,
    tutorSomewhatHelpfulPct: 0,
    tutorNotHelpfulPct: 0,
    tutorWantsAdvancedPct: 0,
    tutorMaybeAdvancedPct: 0,
    scamQuickTotal: 0,
    scamDeepTotal: 0,
    scamTotal: 0,
    scamIdentifiedRiskPct: 0,
    scamNotSurePct: 0,
    scamAvoidedPct: 0,
    scamCautiousPct: 0,
    scamContinuedPct: 0,
    scamMoreConfidentPct: 0,
    scamSlightlyConfidentPct: 0,
    scamNoDifferencePct: 0,
    surveyResponseRatePct: 0,
  });
  const [aiImpactLoading, setAIImpactLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    fetchAIImpact();
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
        referralsResult,
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
        supabase.from('referral_commissions').select('*', { count: 'exact', head: true }),
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

  // Separate fetch for AI impact — isolated so survey table absence never breaks main stats
  const fetchAIImpact = async () => {
    setAIImpactLoading(true);
    try {
      const [tutorSurveysResult, scamSurveysResult, aiLogsResult] = await Promise.all([
        supabase.from('tutor_survey_responses').select(
          'pre_understanding, post_understanding, helpfulness, completed, wants_advanced'
        ),
        supabase.from('scam_detector_survey_responses').select(
          'identified_risk, action_taken, confidence_after'
        ),
        supabase.from('ai_search_logs').select('search_type'),
      ]);

      const tutorRows = tutorSurveysResult.data || [];
      const scamRows = scamSurveysResult.data || [];
      const logRows = aiLogsResult.data || [];

      const tt = tutorRows.length;
      const st = scamRows.length;
      const totalSearches = logRows.length;

      const pct = (count: number, total: number) =>
        total > 0 ? Math.round((count / total) * 100) : 0;

      // Tutor: "improved" = pre was not_at_all or slightly AND post is well
      const startedLow = tutorRows.filter(
        r => r.pre_understanding === 'not_at_all' || r.pre_understanding === 'slightly'
      );
      const improved = startedLow.filter(r => r.post_understanding === 'well').length;

      // Scam detector search types (logged via ai_search_logs)
      const scamQuickTotal = logRows.filter(r => r.search_type === 'quick').length;
      const scamDeepTotal = logRows.filter(r => r.search_type === 'deep').length;

      // Survey response rate: survey responses vs total scam searches
      const totalSurveys = tt + st;
      const surveyResponseRatePct = pct(totalSurveys, totalSearches || 1);

      setAIImpact({
        tutorTotal: tt,
        tutorCompletionRate: pct(tutorRows.filter(r => r.completed === 'yes').length, tt),
        tutorPartialRate: pct(tutorRows.filter(r => r.completed === 'partially').length, tt),
        tutorNotCompletedRate: pct(tutorRows.filter(r => r.completed === 'no').length, tt),
        tutorLearningImprovedPct: pct(improved, startedLow.length),
        tutorPreWellPct: pct(tutorRows.filter(r => r.pre_understanding === 'well').length, tt),
        tutorPreSlightlyPct: pct(tutorRows.filter(r => r.pre_understanding === 'slightly').length, tt),
        tutorPreNotAtAllPct: pct(tutorRows.filter(r => r.pre_understanding === 'not_at_all').length, tt),
        tutorPostWellPct: pct(tutorRows.filter(r => r.post_understanding === 'well').length, tt),
        tutorHelpfulPct: pct(tutorRows.filter(r => r.helpfulness === 'very_helpful').length, tt),
        tutorSomewhatHelpfulPct: pct(tutorRows.filter(r => r.helpfulness === 'somewhat_helpful').length, tt),
        tutorNotHelpfulPct: pct(tutorRows.filter(r => r.helpfulness === 'not_helpful').length, tt),
        tutorWantsAdvancedPct: pct(tutorRows.filter(r => r.wants_advanced === 'yes').length, tt),
        tutorMaybeAdvancedPct: pct(tutorRows.filter(r => r.wants_advanced === 'maybe').length, tt),
        scamQuickTotal,
        scamDeepTotal,
        scamTotal: st,
        scamIdentifiedRiskPct: pct(scamRows.filter(r => r.identified_risk === 'yes').length, st),
        scamNotSurePct: pct(scamRows.filter(r => r.identified_risk === 'not_sure').length, st),
        scamAvoidedPct: pct(scamRows.filter(r => r.action_taken === 'avoided').length, st),
        scamCautiousPct: pct(scamRows.filter(r => r.action_taken === 'cautious').length, st),
        scamContinuedPct: pct(scamRows.filter(r => r.action_taken === 'continued').length, st),
        scamMoreConfidentPct: pct(scamRows.filter(r => r.confidence_after === 'more_confident').length, st),
        scamSlightlyConfidentPct: pct(scamRows.filter(r => r.confidence_after === 'slightly_confident').length, st),
        scamNoDifferencePct: pct(scamRows.filter(r => r.confidence_after === 'no_difference').length, st),
        surveyResponseRatePct,
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Error fetching AI impact:', error);
    } finally {
      setAIImpactLoading(false);
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

      {/* ── AI Learning Impact Section ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-foreground">AI Tool Impact</h2>
          {aiImpactLoading && <span className="text-xs text-muted-foreground animate-pulse">Loading survey data...</span>}
        </div>
        <p className="text-sm text-muted-foreground mb-4">Insights from user feedback surveys on the Financial Tutor &amp; Scam Detector.</p>

        {/* Top KPI cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
          {[
            { label: "Tutor Feedback", value: aiImpact.tutorTotal, sub: "survey responses", icon: BookOpen, color: "text-primary" },
            { label: "Scam Survey Feedback", value: aiImpact.scamTotal, sub: "survey responses", icon: Shield, color: "text-accent" },
            { label: "Quick Searches", value: aiImpact.scamQuickTotal, sub: "scam detector uses", icon: Zap, color: "text-amber-500" },
            { label: "Deep Analyses", value: aiImpact.scamDeepTotal, sub: "scam detector uses", icon: BarChart3, color: "text-indigo-600" },
            { label: "Learning Improved", value: `${aiImpact.tutorLearningImprovedPct}%`, sub: "low → well understanding", icon: Brain, color: "text-indigo-600" },
            { label: "Risk Identified", value: `${aiImpact.scamIdentifiedRiskPct}%`, sub: "users spotted a risk", icon: AlertTriangle, color: "text-destructive" },
          ].map((card, i) => (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground leading-tight">{card.label}</CardTitle>
                  <card.icon className={`w-4 h-4 flex-shrink-0 ${card.color}`} />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
                  <p className="text-xs text-muted-foreground">{card.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Financial Tutor — full breakdown */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="w-4 h-4 text-primary" /> Financial Tutor
              </CardTitle>
              <CardDescription>Lesson feedback &amp; learning outcomes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Completion */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Lesson Completion</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Completed", value: aiImpact.tutorCompletionRate, color: "bg-green-500", text: "text-green-600" },
                    { label: "Partial", value: aiImpact.tutorPartialRate, color: "bg-amber-400", text: "text-amber-500" },
                    { label: "Did not finish", value: aiImpact.tutorNotCompletedRate, color: "bg-red-400", text: "text-red-500" },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`font-semibold ${r.text}`}>{r.value}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pre vs Post understanding */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Understanding: Before → After</p>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-secondary p-2">
                    <p className="text-muted-foreground mb-1">Pre: "Not at all"</p>
                    <p className="text-lg font-bold text-red-500">{aiImpact.tutorPreNotAtAllPct}%</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-2">
                    <p className="text-muted-foreground mb-1">Post: "Well"</p>
                    <p className="text-lg font-bold text-green-600">{aiImpact.tutorPostWellPct}%</p>
                  </div>
                </div>
                <p className="text-xs text-center text-muted-foreground mt-2 font-medium">
                  Improved: <span className="text-indigo-600 font-bold">{aiImpact.tutorLearningImprovedPct}%</span> of low-knowledge users
                </p>
              </div>

              {/* Helpfulness */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Lesson Helpfulness</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Very helpful", value: aiImpact.tutorHelpfulPct, color: "bg-primary", text: "text-primary" },
                    { label: "Somewhat helpful", value: aiImpact.tutorSomewhatHelpfulPct, color: "bg-blue-400", text: "text-blue-500" },
                    { label: "Not helpful", value: aiImpact.tutorNotHelpfulPct, color: "bg-red-400", text: "text-red-500" },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`font-semibold ${r.text}`}>{r.value}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wants advanced */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Interest in Advanced Tools</p>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-2 text-center text-xs">
                    <p className="text-muted-foreground">Yes</p>
                    <p className="text-lg font-bold text-indigo-600">{aiImpact.tutorWantsAdvancedPct}%</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-secondary p-2 text-center text-xs">
                    <p className="text-muted-foreground">Maybe</p>
                    <p className="text-lg font-bold text-muted-foreground">{aiImpact.tutorMaybeAdvancedPct}%</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scam Detector — full breakdown */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="w-4 h-4 text-accent" /> Scam Detector
              </CardTitle>
              <CardDescription>Usage &amp; behavioral outcomes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search type split */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Search Type Breakdown</p>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2">
                    <p className="text-muted-foreground">Quick searches</p>
                    <p className="text-lg font-bold text-amber-500">{aiImpact.scamQuickTotal}</p>
                  </div>
                  <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-2">
                    <p className="text-muted-foreground">Deep analyses</p>
                    <p className="text-lg font-bold text-indigo-600">{aiImpact.scamDeepTotal}</p>
                  </div>
                </div>
              </div>

              {/* Risk identification */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Did Tool Identify Risk?</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Yes, identified risk", value: aiImpact.scamIdentifiedRiskPct, color: "bg-destructive", text: "text-destructive" },
                    { label: "Not sure", value: aiImpact.scamNotSurePct, color: "bg-amber-400", text: "text-amber-500" },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`font-semibold ${r.text}`}>{r.value}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action taken */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Action Taken After Detection</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Avoided opportunity", value: aiImpact.scamAvoidedPct, color: "bg-destructive", text: "text-destructive" },
                    { label: "Proceeded with caution", value: aiImpact.scamCautiousPct, color: "bg-amber-400", text: "text-amber-500" },
                    { label: "Continued as planned", value: aiImpact.scamContinuedPct, color: "bg-blue-400", text: "text-blue-500" },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`font-semibold ${r.text}`}>{r.value}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Protected (avoided + cautious): <span className="text-accent font-bold">{aiImpact.scamAvoidedPct + aiImpact.scamCautiousPct}%</span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Confidence Change */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="w-4 h-4 text-green-600" /> Confidence &amp; Engagement
              </CardTitle>
              <CardDescription>User confidence after Scam Detector</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Confidence */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Confidence Change</p>
                <div className="space-y-1.5">
                  {[
                    { label: "More confident", value: aiImpact.scamMoreConfidentPct, color: "bg-green-500", text: "text-green-600" },
                    { label: "Slightly confident", value: aiImpact.scamSlightlyConfidentPct, color: "bg-blue-400", text: "text-blue-500" },
                    { label: "No difference", value: aiImpact.scamNoDifferencePct, color: "bg-secondary", text: "text-muted-foreground" },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`font-semibold ${r.text}`}>{r.value}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-center">
                  <p className="text-xs text-muted-foreground">Overall confidence boost</p>
                  <p className="text-xl font-bold text-green-600">
                    {aiImpact.scamMoreConfidentPct + aiImpact.scamSlightlyConfidentPct}%
                  </p>
                </div>
              </div>

              {/* Survey response rate */}
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-foreground mb-2">Survey Engagement Rate</p>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(aiImpact.surveyResponseRatePct, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  <span className="font-semibold text-primary">{aiImpact.surveyResponseRatePct}%</span> of sessions left feedback
                </p>
              </div>

              {/* Headline summary */}
              <div className="pt-2 border-t space-y-2">
                <p className="text-xs font-semibold text-foreground">Impact Summary</p>
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3 text-xs text-indigo-700 dark:text-indigo-300">
                  Understanding improved from{" "}
                  <span className="font-bold">{aiImpact.tutorPreNotAtAllPct}%</span> "not at all" →{" "}
                  <span className="font-bold">{aiImpact.tutorPostWellPct}%</span> "well"
                </div>
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 text-xs text-green-700 dark:text-green-300">
                  <span className="font-bold">{aiImpact.scamAvoidedPct + aiImpact.scamCautiousPct}%</span> of users protected from potential scams
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
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
