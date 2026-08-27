import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Twitter, Instagram, Youtube, MessageCircle } from "lucide-react";
import investoursLogo from "@/assets/investours-logo.png";

const doctorSteps = [
  { emoji: "🩺", label: "Examines your finances", emojiLabel: "stethoscope" },
  { emoji: "🔍", label: "Detects problems", emojiLabel: "magnifying glass" },
  { emoji: "📊", label: "Explains your financial health", emojiLabel: "bar chart" },
  { emoji: "💡", label: "Guides your next step", emojiLabel: "lightbulb" },
];

const Welcome = () => {
  return (
    <div className="min-h-screen min-h-[100svh] flex flex-col relative overflow-hidden gradient-hero">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/3 rounded-full blur-2xl animate-float" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center z-10 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto w-full py-10 sm:py-14 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center w-full"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mb-6 sm:mb-8"
          >
            <img
              src={investoursLogo}
              alt="Investours Logo"
              className="w-20 h-20 min-[380px]:w-24 min-[380px]:h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 mx-auto drop-shadow-lg"
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-[1.9rem] leading-tight min-[380px]:text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-3 sm:mb-4 text-balance"
          >
            Welcome to <span className="text-primary">Investours</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-lg sm:text-xl md:text-2xl text-primary font-medium mb-1 sm:mb-1.5"
          >
            AI Financial Auditor
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            className="text-sm sm:text-base md:text-lg text-foreground mb-3 sm:mb-4"
          >
            <em>Your Financial Doctor</em>
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="text-sm sm:text-base md:text-lg text-muted-foreground mb-8 sm:mb-10 leading-relaxed text-pretty"
          >
            Understand your money. Detect financial leakages. Improve your financial health.
          </motion.p>

          {/* Primary CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="mb-5 sm:mb-6"
          >
            <Link to="/auth" className="block w-full sm:inline-block">
              <Button variant="hero" size="xl" className="group w-full sm:w-auto px-6 min-[380px]:px-8 sm:px-10">
                Get Started Now
                <motion.span
                  className="ml-2 inline-block"
                  animate={{ x: [0, 4, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                >
                  →
                </motion.span>
              </Button>
            </Link>
          </motion.div>

          {/* What your Financial Doctor does */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.0 }}
            className="mb-10 sm:mb-12"
          >
            <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 sm:mb-5">
              What your Financial Doctor does
            </h2>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 sm:gap-3 text-muted-foreground text-left">
              {doctorSteps.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 sm:gap-3 rounded-xl bg-secondary/70 border border-border/50 px-3.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm"
                >
                  <span className="text-base sm:text-lg shrink-0" aria-label={item.emojiLabel}>
                    {item.emoji}
                  </span>
                  <span className="leading-snug">{item.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Social Media Links */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <p className="text-sm text-muted-foreground mb-4">Follow us on social media</p>
            <div className="flex items-center justify-center gap-3">
              <a href="https://x.com/Investoursworld" target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-secondary/80 hover:bg-primary/20 flex items-center justify-center text-muted-foreground hover:text-primary transition-all">
                <Twitter className="w-4 h-4 sm:w-5 sm:h-5" />
              </a>
              <a href="https://www.instagram.com/investoursworld/" target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-secondary/80 hover:bg-primary/20 flex items-center justify-center text-muted-foreground hover:text-primary transition-all">
                <Instagram className="w-4 h-4 sm:w-5 sm:h-5" />
              </a>
              <a href="https://chat.whatsapp.com/Go5HpKeLiqz5NpPWLcVy1Q" target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-secondary/80 hover:bg-primary/20 flex items-center justify-center text-muted-foreground hover:text-primary transition-all">
                <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              </a>
              <a href="https://www.youtube.com/@Investoursworld" target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-secondary/80 hover:bg-primary/20 flex items-center justify-center text-muted-foreground hover:text-primary transition-all">
                <Youtube className="w-4 h-4 sm:w-5 sm:h-5" />
              </a>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Welcome;
