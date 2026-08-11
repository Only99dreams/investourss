import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Crown, Loader2, Package, User, Building2, Repeat, Wallet, TrendingUp, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNaira } from "@/lib/ambassadorTiers";

interface BucketStat {
  users: number;
  commission: number;
}

interface CategoryCard {
  buckets: Record<string, BucketStat>;
  total_users: number;
  total_commission: number;
}

interface FHAPortfolioData {
  has_ambassador: boolean;
  packs: {
    individuals: CategoryCard;
    businesses: CategoryCard;
  };
  subscribers: {
    individuals: CategoryCard;
    businesses: CategoryCard;
  };
  total_earned_individuals: number;
  total_earned_businesses: number;
  current_portfolio_value: number;
}

interface PortfolioCardConfig {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  bucketLabels: Record<string, string>;
  data: CategoryCard;
  note?: string;
}

const PortfolioCard = ({ title, subtitle, icon: Icon, accent, bucketLabels, data, note }: PortfolioCardConfig) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <span className={cn("w-9 h-9 rounded-full flex items-center justify-center", accent)}>
          <Icon className="w-5 h-5" />
        </span>
        <div>
          <span className="block leading-tight">{title}</span>
          <span className="block text-sm font-normal text-muted-foreground">{subtitle}</span>
        </div>
      </CardTitle>
      <CardDescription>{note}</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Object.entries(bucketLabels).map(([key, label]) => {
          const stat = data?.buckets?.[key] ?? { users: 0, commission: 0 };
          return (
            <div key={key} className="rounded-xl border border-border bg-background/60 p-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">{label}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-2xl font-bold">{stat.users}</p>
                  <p className="text-[11px] text-muted-foreground">Active Users</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{formatNaira(stat.commission)}</p>
                  <p className="text-[11px] text-muted-foreground">Amount Earned</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
        <span className="text-sm font-medium">Total Amount Earned</span>
        <span className="text-lg font-bold text-primary">{formatNaira(data?.total_commission ?? 0)}</span>
      </div>
    </CardContent>
  </Card>
);

export function FHAPortfolioSection() {
  const { user, isLoading } = useAuth();
  const [data, setData] = useState<FHAPortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchPortfolio = async () => {
      try {
        const { data: result, error: rpcError } = await supabase.rpc("get_fha_portfolio");
        if (rpcError) throw rpcError;
        setData((result ?? null) as FHAPortfolioData | null);
      } catch (err) {
        console.error("Failed to load FHA portfolio:", err);
        setError("We could not load your FHA portfolio. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolio();
  }, [user]);

  if (isLoading || loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data?.has_ambassador) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-primary" />
                Become a Financial Health Ambassador
              </CardTitle>
              <CardDescription>
                Your FHA Portfolio tracks the active users you refer, the commissions you earn, and your
                progress toward the Quarterly Reward. Become an ambassador to unlock it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="hero">
                <Link to="/ambassador">Become an Ambassador</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const { packs, subscribers, total_earned_individuals, total_earned_businesses, current_portfolio_value } = data;

  const cards: PortfolioCardConfig[] = [
    {
      title: "Active Audit Credit Pack Users",
      subtitle: "Individuals",
      icon: Package,
      accent: "bg-primary/10 text-primary",
      bucketLabels: { "30": "30 Days", "90": "90 Days", "360": "360 Days" },
      data: packs.individuals,
    },
    {
      title: "Active Audit Credit Pack Users",
      subtitle: "Businesses",
      icon: Building2,
      accent: "bg-accent/10 text-accent",
      bucketLabels: { "30": "30 Days", "90": "90 Days", "360": "360 Days" },
      data: packs.businesses,
    },
    {
      title: "Active Subscribers",
      subtitle: "Individuals",
      icon: Repeat,
      accent: "bg-primary/10 text-primary",
      bucketLabels: {
        monthly: "Monthly",
        quarterly: "Quarterly",
        biennial: "Bi-annual",
        annual: "Annual",
      },
      data: subscribers.individuals,
    },
    {
      title: "Active Subscribers",
      subtitle: "Businesses",
      icon: Building2,
      accent: "bg-accent/10 text-accent",
      bucketLabels: {
        monthly: "Monthly",
        quarterly: "Quarterly",
        biennial: "Bi-annual",
        annual: "Annual",
      },
      data: subscribers.businesses,
      note: "B2B Annual plans are counted under Annual.",
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-primary" />
              FHA Portfolio
            </CardTitle>
            <CardDescription>
              Track the active users you refer, the commissions they generate, and your total portfolio value.
              This determines your qualification for our Quarterly Reward.
            </CardDescription>
          </CardHeader>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {cards.map((card) => (
          <PortfolioCard key={`${card.title}-${card.subtitle}`} {...card} />
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold">{formatNaira(total_earned_individuals)}</p>
              <p className="text-xs text-muted-foreground">Total Earned from Individuals</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-lg font-bold">{formatNaira(total_earned_businesses)}</p>
              <p className="text-xs text-muted-foreground">Total Earned from Businesses</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/30">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-primary">{formatNaira(current_portfolio_value)}</p>
              <p className="text-xs text-muted-foreground">Current Portfolio Value</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <Card className="border-primary/20">
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm text-muted-foreground">
              Your current portfolio value is the combined commission earned from active Individuals and
              Businesses you referred. Top portfolios qualify for our Quarterly Reward.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
