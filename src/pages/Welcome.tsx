import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Twitter, Instagram, Youtube, MessageCircle } from "lucide-react";
import investoursLogo from "@/assets/investours-logo.png";

const gains = [
  "Turn your knowledge, skills or useful ideas into ebooks and audio versions.",
  "Generate complete manuscripts with professionally designed interiors.",
  "Download your finished ebook as a PDF, ready to prepare for sale.",
  "Learn how to identify buyers, promote your products and fulfil orders.",
  "Reach customers and sell your digital books around the world.",
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

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="text-sm sm:text-base text-muted-foreground mb-2 sm:mb-3"
          >
            Welcome to Investours
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-[1.9rem] leading-tight min-[380px]:text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-3 sm:mb-4 text-balance"
          >
            BookMaker <span className="text-primary">AI</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-lg sm:text-xl md:text-2xl font-medium text-foreground mb-3 sm:mb-4 text-balance"
          >
            Turn Your Knowledge Into Digital Income.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="text-sm sm:text-base md:text-lg text-muted-foreground mb-2 leading-relaxed text-pretty"
          >
            Create professional ebooks with AI, complete with audio versions.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            className="text-sm sm:text-base md:text-lg text-foreground font-medium mb-8 sm:mb-10 leading-relaxed text-pretty"
          >
            Get started with AI credits for as low as ₦2,720.
          </motion.p>

          {/* Primary CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="mb-5 sm:mb-6"
          >
            <Link to="/bookmaker" className="block w-full sm:inline-block">
              <Button variant="hero" size="xl" className="group w-full sm:w-auto px-6 min-[380px]:px-8 sm:px-10">
                Start Now
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

          {/* What you gain */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.1 }}
            className="mb-10 sm:mb-12"
          >
            <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 sm:mb-5 text-center">
              What You Gain
            </h2>
            <ul className="space-y-3 text-sm sm:text-base text-muted-foreground text-left">
              {gains.map((gain) => (
                <li key={gain} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="leading-relaxed">{gain}</span>
                </li>
              ))}
            </ul>
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
