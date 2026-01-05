import { useState } from "react";
import { motion } from "framer-motion";
import { 
  BookOpen, 
  Shield, 
  TrendingUp, 
  Users, 
  Leaf,
  ArrowRight,
  Search,
  Lock,
  Globe,
  Sparkles
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Header from "@/components/Header";
import { Footer } from "@/components/ui/Footer";
import CommunitySection from "@/components/home/CommunitySection";

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

const Home = () => {
  const [tutorQuery, setTutorQuery] = useState("");
  const navigate = useNavigate();

  const handleTutorSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (tutorQuery.trim()) {
      navigate(`/tutor?q=${encodeURIComponent(tutorQuery.trim())}`);
    } else {
      navigate("/tutor");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-24 md:pt-32 pb-16 gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6">
              A Daily Financial, {" "}
              <span className="text-primary">Safety Companion</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
            AI Tutor and Scam Detector, Community and Safe Offers.
            </p>
            
            {/* AI Financial Tutor Search Bar */}
            <motion.form 
              onSubmit={handleTutorSearch}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="max-w-xl mx-auto mb-8"
            >
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-full blur-xl group-hover:blur-2xl transition-all opacity-50" />
                <div className="relative flex gap-2 bg-card/80 backdrop-blur-sm rounded-full p-2 border border-border shadow-lg">
                  <div className="flex items-center gap-2 pl-4 text-primary">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <Input
                    value={tutorQuery}
                    onChange={(e) => setTutorQuery(e.target.value)}
                    placeholder="Ask our AI Financial Tutor anything..."
                    className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70"
                  />
                  <Button type="submit" variant="hero" className="rounded-full px-6">
                    <Search className="w-4 h-4 mr-2" />
                    Ask
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Try: "What is budgeting?"
              </p>
            </motion.form>

            <div className="flex flex-wrap justify-center gap-4">
              <Link to="/dashboard">
                <Button variant="hero" size="lg">
                  Start Learning Free
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Link to="/vetting">
                <Button variant="outline" size="lg">
                Use Scam Detector
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Community Section - After Hero */}
      <CommunitySection />

      {/* Feature Sections */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {/* Learning */}
            <motion.div variants={fadeInUp}>
              <Card variant="feature" className="h-full group">
                <CardHeader>
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <BookOpen className="w-7 h-7 text-primary" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Learning
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription>
                    Financial education modules, mentorship, and certification programs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Access courses on investing, budgeting, and building wealth. Earn certifications and connect with mentors.
                  </p>
                  <Link to="/auth?mode=login">
                    <Button variant="ghost" size="sm" className="group-hover:text-primary">
                      Login to Access <ArrowRight className="ml-1 w-4 h-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            {/* Vetting */}
            <motion.div variants={fadeInUp}>
              <Card variant="feature" className="h-full group border-accent/30">
                <CardHeader>
                  <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                    <Shield className="w-7 h-7 text-accent" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    AI Vetting
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription>
                    AI-powered scam detection and investment analysis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 mb-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Search className="w-4 h-4 text-accent" />
                      <span>Search & Analyze - Login required</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Lock className="w-4 h-4" />
                      <span>Support - Premium only</span>
                    </div>
                  </div>
                  <Link to="/auth?mode=login">
                    <Button variant="accent" size="sm">
                      Login to Vet <ArrowRight className="ml-1 w-4 h-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            {/* Safe Investing */}
            <motion.div variants={fadeInUp}>
              <Card variant="feature" className="h-full group">
                <CardHeader>
                  <div className="w-14 h-14 rounded-2xl bg-investours-gold/10 flex items-center justify-center mb-4 group-hover:bg-investours-gold/20 transition-colors">
                    <TrendingUp className="w-7 h-7 text-investours-gold" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Safe Investing
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription>
                    Access vetted investment opportunities from licensed firms
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Browse verified investments in agriculture, renewable energy, real estate, and more.
                  </p>
                  <Link to="/auth?mode=login">
                    <Button variant="ghost" size="sm" className="group-hover:text-primary">
                      Login to Invest <ArrowRight className="ml-1 w-4 h-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            {/* Community */}
            <motion.div variants={fadeInUp}>
              <Card variant="feature" className="h-full group">
                <CardHeader>
                  <div className="w-14 h-14 rounded-2xl bg-investours-coral/10 flex items-center justify-center mb-4 group-hover:bg-investours-coral/20 transition-colors">
                    <Users className="w-7 h-7 text-investours-coral" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Community
                    <Leaf className="w-4 h-4 text-accent" />
                  </CardTitle>
                  <CardDescription>
                    Connect, share, and build climate resilience together
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-foreground">12.5K</div>
                      <div className="text-xs text-muted-foreground">Members</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-foreground">3.2K</div>
                      <div className="text-xs text-muted-foreground">All Posts</div>
                    </div>
                  </div>
                  <Link to="/community">
                    <Button variant="ghost" size="sm" className="group-hover:text-primary">
                      Explore Community <ArrowRight className="ml-1 w-4 h-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 bg-secondary/50">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-2xl mx-auto mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Why Choose Investours?
            </h2>
            <p className="text-muted-foreground">
            AI-powered financial learning, scam protection, and safe access to licensed investments and microinsurance — all in one platform.
            </p>
          </motion.div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">AI-Powered Protection</h3>
              <p className="text-sm text-muted-foreground">
              Our AI tutor and scam detector help you identify potential scams and make safer financial decisions.
              </p>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <Globe className="w-8 h-8 text-accent" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Direct Access</h3>
              <p className="text-sm text-muted-foreground">
              Connect directly with vetted investment and microinsurance opportunities from licensed partners.
              </p>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-investours-gold/10 flex items-center justify-center mx-auto mb-4">
                <Leaf className="w-8 h-8 text-investours-gold" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Community & Learning</h3>
              <p className="text-sm text-muted-foreground">
              Join a growing network of users and Grassroots Financial Educators to learn, share, and build lasting financial resilience.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="gradient-primary rounded-3xl p-8 md:p-12 text-center text-primary-foreground"
          >
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Ready to Start Your Journey?
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
             Join thousands of youth, women, and microenterprises learning, protecting their money, and accessing trusted investment and microinsurance opportunities.
            </p>
            <Link to="/signup">
              <Button variant="glass" size="lg">
                Get Started for Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default Home;
