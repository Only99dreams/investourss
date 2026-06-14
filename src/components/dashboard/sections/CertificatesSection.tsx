import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Award, Download, Loader2, Medal, Trophy, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface Certificate {
  id: string;
  level: string;
  level_label: string;
  xp_earned: number | null;
  certificate_id: string;
  issued_at: string | null;
  created_at: string | null;
}

const levelIcons: Record<string, typeof Award> = {
  beginner: Star,
  intermediate: Medal,
  advanced: Trophy,
};

const levelColors: Record<string, string> = {
  beginner: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  intermediate: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  advanced: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

export function CertificatesSection() {
  const { user, profile } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCertificates = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from("user_certificates")
          .select("*")
          .eq("user_id", user.id)
          .order("issued_at", { ascending: false });

        if (error) throw error;
        setCertificates(data || []);
      } catch (error) {
        console.error("Error fetching certificates:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (user) fetchCertificates();
  }, [user]);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-2xl font-bold">My Certificates</h2>
          <p className="text-sm text-muted-foreground">
            {certificates.length > 0
              ? `${certificates.length} certificate${certificates.length !== 1 ? "s" : ""} earned`
              : "Complete AI Tutor stages to earn certificates"}
          </p>
        </div>
      </motion.div>

      {certificates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Award className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No certificates yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Complete stages in the AI Financial Tutor to earn certificates of completion.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {certificates.map((cert, index) => {
            const IconComponent = levelIcons[cert.level] || Award;

            return (
              <motion.div
                key={cert.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "w-14 h-14 rounded-xl flex items-center justify-center shrink-0",
                        levelColors[cert.level] || "bg-muted text-muted-foreground"
                      )}>
                        <IconComponent className="w-7 h-7" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground mb-1">
                          {cert.level_label}
                        </h3>
                        <p className="text-xs text-muted-foreground mb-3">
                          Certificate ID: {cert.certificate_id}
                        </p>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                          {cert.xp_earned != null && (
                            <span>{cert.xp_earned} XP earned</span>
                          )}
                          {cert.issued_at && (
                            <span>Issued {formatDistanceToNow(new Date(cert.issued_at), { addSuffix: true })}</span>
                          )}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          asChild
                        >
                          <a
                            href={`/tutor`}
                            className="flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            View Certificate
                          </a>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
