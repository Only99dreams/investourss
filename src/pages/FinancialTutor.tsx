import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, ArrowLeft, Loader2, LogIn, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Footer } from "@/components/ui/Footer";
import investoursLogo from "@/assets/investours-logo.png";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Keywords that indicate vetting/scam detection intent
const vettingKeywords = [
  "scam", "fraud", "legitimate", "legit", "real", "fake", "trust", "safe to invest",
  "is this company", "should i invest", "check this", "verify", "analyze investment",
  "is it safe", "ponzi", "pyramid", "mlm", "returns guaranteed", "too good to be true",
  "red flags", "warning signs", "due diligence"
];

const isVettingQuery = (query: string): boolean => {
  const lowerQuery = query.toLowerCase();
  return vettingKeywords.some(keyword => lowerQuery.includes(keyword));
};

const suggestedQuestions = [
  "What is compound interest?",
  "How do I start investing with little money?",
  "What's the difference between stocks and bonds?",
  "How do I create a budget?",
  "What is diversification?",
  "How do emergency funds work?"
];

const FinancialTutor = () => {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showVettingPrompt, setShowVettingPrompt] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Handle initial query from URL
  useEffect(() => {
    if (initialQuery && messages.length === 0) {
      handleSend(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText) return;

    // Check for vetting intent
    if (isVettingQuery(messageText)) {
      if (!user) {
        setShowVettingPrompt(true);
        setInput("");
        return;
      } else {
        // Redirect to vetting page with query
        navigate(`/vetting?q=${encodeURIComponent(messageText)}`);
        return;
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('financial-tutor', {
        body: { 
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          userId: user?.id || null
        }
      });

      if (error) throw error;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response || "I apologize, but I couldn't generate a response. Please try again."
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Tutor error:', error);
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              to="/home" 
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <div className="flex items-center gap-2">
              <img src={investoursLogo} alt="Investours" className="w-8 h-8" />
              <div>
                <h1 className="font-semibold text-foreground text-sm sm:text-base">AI Financial Tutor</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Your personal finance educator</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/vetting">
              <Button variant="outline" size="sm">
                AI Vetting
              </Button>
            </Link>
            {!user && (
              <Link to="/auth?mode=login">
                <Button variant="outline" size="sm">
                  <LogIn className="w-4 h-4 mr-2" />
                  Login
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        <ScrollArea ref={scrollRef} className="flex-1 p-4">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Welcome to AI Financial Tutor</h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                Ask me anything about personal finance, investing basics, budgeting, and more!
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {suggestedQuestions.map((question, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="text-left justify-start h-auto py-3 px-4"
                    onClick={() => handleSend(question)}
                  >
                    <span className="line-clamp-2 text-sm">{question}</span>
                  </Button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-4 pb-4">
              <AnimatePresence mode="popLayout">
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <Card className={`max-w-[80%] p-4 ${
                      message.role === "user" 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-card"
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </Card>
                    {message.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-accent" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <Card className="p-4 bg-card">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </Card>
                </motion.div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Vetting Prompt Modal */}
        <AnimatePresence>
          {showVettingPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowVettingPrompt(false)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Card className="p-6 max-w-md">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                      <LogIn className="w-8 h-8 text-accent" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">Login Required</h3>
                    <p className="text-muted-foreground mb-6">
                      To analyze investments and check for scams, please login to access our AI Vetting tool.
                    </p>
                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" onClick={() => setShowVettingPrompt(false)}>
                        Cancel
                      </Button>
                      <Link to="/auth?mode=login">
                        <Button variant="default">
                          Login Now
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Area */}
        <div className="border-t border-border p-4 bg-card/50 backdrop-blur-sm">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about personal finance, budgeting, investing basics..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button 
              onClick={() => handleSend()} 
              disabled={!input.trim() || isLoading}
              size="icon"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            For investment analysis & scam detection, use our{" "}
            <Link to="/vetting" className="text-primary hover:underline">AI Vetting tool</Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default FinancialTutor;
