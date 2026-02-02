import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Sparkles } from "lucide-react";

export function InvestmentsSection() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Investments Coming Soon</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              We're working hard to bring you vetted investment opportunities.
              Stay tuned for exciting investment options that will help you grow your wealth safely.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4" />
              <span>Launching soon with licensed partners</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
