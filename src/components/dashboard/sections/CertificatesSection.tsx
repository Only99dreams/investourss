import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Award, Download, Loader2, Medal, Trophy, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import investoursLogo from "@/assets/investours-logo.png";

interface Certificate {
  id: string;
  level: string;
  level_label: string;
  xp_earned: number | null;
  certificate_id: string;
  issued_at: string | null;
  created_at: string | null;
  download_count: number | null;
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

async function generateCertificatePNG(
  cert: Certificate,
  userName: string
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1000, 720);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 8;
  ctx.strokeRect(30, 30, 940, 660);

  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(50, 50, 900, 620);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  const corners = [
    [50, 50], [950, 50], [950, 670], [50, 670]
  ];
  corners.forEach(([x, y], i) => {
    ctx.beginPath();
    if (i === 0) { ctx.moveTo(x + 20, y); ctx.lineTo(x + 20, y + 20); ctx.lineTo(x, y + 20); }
    if (i === 1) { ctx.moveTo(x - 20, y); ctx.lineTo(x - 20, y + 20); ctx.lineTo(x, y + 20); }
    if (i === 2) { ctx.moveTo(x, y - 20); ctx.lineTo(x - 20, y - 20); ctx.lineTo(x - 20, y); }
    if (i === 3) { ctx.moveTo(x + 20, y); ctx.lineTo(x + 20, y - 20); ctx.lineTo(x, y - 20); }
    ctx.stroke();
  });

  const logo = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = investoursLogo;
  });
  ctx.drawImage(logo, 410, 68, 180, 55);

  ctx.fillStyle = "#888888";
  ctx.font = "bold 13px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.fillText("AI-Powered Platform Advancing Financial Intelligence and Income Mobility", 500, 138);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(250, 155);
  ctx.lineTo(750, 155);
  ctx.stroke();

  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 52px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.fillText("Certificate of Completion", 500, 215);

  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.moveTo(500, 232);
  ctx.lineTo(508, 240);
  ctx.lineTo(500, 248);
  ctx.lineTo(492, 240);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#555555";
  ctx.font = "20px Georgia, 'Times New Roman', serif";
  ctx.fillText("This certifies that", 500, 290);

  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 40px Georgia, 'Times New Roman', serif";
  ctx.fillText(userName || "User", 500, 350);

  ctx.fillStyle = "#555555";
  ctx.font = "18px Georgia, 'Times New Roman', serif";
  ctx.fillText("has successfully completed the", 500, 400);

  ctx.fillStyle = "#7c3aed";
  ctx.font = "bold 32px Georgia, 'Times New Roman', serif";
  ctx.fillText(`${cert.level_label} Stage`, 500, 455);

  ctx.fillStyle = "#888888";
  ctx.font = "15px Arial, sans-serif";
  const issueDate = cert.issued_at
    ? new Date(cert.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  ctx.fillText(`Total XP Earned: ${cert.xp_earned ?? 0}  |  Issued: ${issueDate}`, 500, 505);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(300, 550);
  ctx.lineTo(700, 550);
  ctx.stroke();

  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(360, 600);
  ctx.lineTo(640, 600);
  ctx.stroke();

  ctx.fillStyle = "#1a1a2e";
  ctx.font = "italic 24px Georgia, 'Times New Roman', serif";
  ctx.fillText("Olusegun Emmanuel", 500, 593);

  ctx.fillStyle = "#888888";
  ctx.font = "13px Arial, sans-serif";
  ctx.fillText("Founder & CEO, Investours", 500, 630);

  ctx.fillStyle = "#aaaaaa";
  ctx.font = "10px Arial, sans-serif";
  ctx.fillText(`Certificate ID: ${cert.certificate_id}`, 500, 670);

  return canvas.toDataURL("image/png");
}

export function CertificatesSection() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  const handleDownload = async (cert: Certificate) => {
    if (!user || !profile) return;

    const isFree = profile.user_tier === "free";
    const currentDownloads = cert.download_count ?? 0;

    if (isFree && currentDownloads >= 1) {
      toast({
        title: "Upgrade to Download Again",
        description: "Free users can download each certificate once. Upgrade to Premium to download unlimited times.",
        variant: "destructive",
      });
      return;
    }

    setDownloadingId(cert.id);

    try {
      const dataUrl = await generateCertificatePNG(cert, profile.full_name || "User");

      const link = document.createElement("a");
      link.download = `Investours-${cert.level_label}-Certificate.png`;
      link.href = dataUrl;
      link.click();

      const newCount = (cert.download_count ?? 0) + 1;
      await supabase
        .from("user_certificates")
        .update({ download_count: newCount })
        .eq("id", cert.id);

      setCertificates((prev) =>
        prev.map((c) => (c.id === cert.id ? { ...c, download_count: newCount } : c))
      );

      toast({
        title: "Certificate Downloaded!",
        description: `Your ${cert.level_label} certificate has been downloaded.`,
      });
    } catch (error) {
      console.error("Error downloading certificate:", error);
      toast({
        title: "Download Failed",
        description: "Could not generate certificate. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

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
            const isFree = profile?.user_tier === "free";
            const remaining = isFree ? 1 - (cert.download_count ?? 0) : Infinity;

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
                          {isFree && (
                            <span className={remaining > 0 ? "text-amber-500" : "text-red-500"}>
                              {remaining > 0 ? `${remaining} download${remaining !== 1 ? "s" : ""} left` : "No downloads left"}
                            </span>
                          )}
                        </div>

                        <Button
                          variant={remaining <= 0 && isFree ? "default" : "outline"}
                          size="sm"
                          className={cn("text-xs", remaining <= 0 && isFree && "bg-primary text-primary-foreground")}
                          onClick={() => {
                            if (remaining <= 0 && isFree) {
                              navigate("/pricing");
                            } else {
                              handleDownload(cert);
                            }
                          }}
                          disabled={downloadingId === cert.id}
                        >
                          {downloadingId === cert.id ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3 mr-1" />
                          )}
                          {downloadingId === cert.id
                            ? "Downloading..."
                            : remaining <= 0 && isFree
                              ? "Upgrade to Download"
                              : "Download Certificate"}
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
