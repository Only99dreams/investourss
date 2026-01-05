import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, ExternalLink, Clock, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function InvestmentsSection() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [investments, setInvestments] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      // Fetch user's investments
      const { data: investData } = await supabase
        .from("user_investments")
        .select(`
          *,
          opportunity:investment_opportunities(*)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setInvestments(investData || []);

      // Fetch available opportunities
      const { data: oppData } = await supabase
        .from("investment_opportunities")
        .select("*, firm:firms(firm_name)")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(6);

      setOpportunities(oppData || []);
      setIsLoading(false);
    };

    fetchData();
  }, [user]);

  const totalInvested = investments.reduce((sum, inv) => sum + Number(inv.amount), 0);
  const totalGains = investments.reduce((sum, inv) => sum + Number(inv.gains || 0), 0);
  const activeInvestments = investments.filter(inv => inv.status === "active");

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Invested</p>
                  <p className="text-2xl font-bold">₦{totalInvested.toLocaleString()}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Gains</p>
                  <p className="text-2xl font-bold text-emerald">₦{totalGains.toLocaleString()}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-emerald/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Investments</p>
                  <p className="text-2xl font-bold">{activeInvestments.length}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-gold" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Investment Tabs */}
      <Tabs defaultValue="my-investments">
        <TabsList>
          <TabsTrigger value="my-investments">My Investments</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
        </TabsList>

        <TabsContent value="my-investments" className="mt-6">
          {investments.length > 0 ? (
            <div className="space-y-4">
              {investments.map((investment, index) => (
                <motion.div
                  key={investment.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold">
                              {investment.opportunity?.title || "Investment"}
                            </h3>
                            <Badge variant={
                              investment.status === "active" ? "default" :
                              investment.status === "completed" ? "secondary" :
                              "destructive"
                            }>
                              {investment.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Invested: ₦{Number(investment.amount).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Gains</p>
                          <p className={cn(
                            "text-lg font-semibold",
                            Number(investment.gains) >= 0 ? "text-emerald" : "text-coral"
                          )}>
                            ₦{Number(investment.gains || 0).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Investments Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Explore vetted investment opportunities to get started.
                </p>
                <Button>Browse Opportunities</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="opportunities" className="mt-6">
          {opportunities.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {opportunities.map((opp, index) => (
                <motion.div
                  key={opp.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="h-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <Badge variant="outline">{opp.category}</Badge>
                        <Badge className={cn(
                          opp.risk_level === "low" ? "bg-emerald/20 text-emerald" :
                          opp.risk_level === "medium" ? "bg-gold/20 text-gold" :
                          "bg-coral/20 text-coral"
                        )}>
                          {opp.risk_level} risk
                        </Badge>
                      </div>
                      <CardTitle className="text-base mt-2">{opp.title}</CardTitle>
                      <CardDescription>
                        by {opp.firm?.firm_name || "Licensed Firm"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Min. Investment</span>
                          <span className="font-medium">₦{Number(opp.minimum_amount).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expected ROI</span>
                          <span className="font-medium text-emerald">{opp.expected_roi}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Duration</span>
                          <span className="font-medium">{opp.duration}</span>
                        </div>
                      </div>
                      <Button className="w-full mt-4" size="sm">
                        View Details <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                No opportunities available at the moment
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
