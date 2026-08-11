import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageSquare, Send, Plus, Mail, MailOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function MessagesSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [messages, setMessages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newMessage, setNewMessage] = useState({
    recipient_team: "",
    subject: "",
    content: ""
  });

  useEffect(() => {
    const fetchMessages = async () => {
      if (!user) return;

      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order("created_at", { ascending: false });

      setMessages(data || []);
      setIsLoading(false);
    };

    fetchMessages();
  }, [user]);

  const handleSendMessage = async () => {
    if (!newMessage.recipient_team || !newMessage.content) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase.from("messages").insert({
      sender_id: user?.id,
      recipient_team: newMessage.recipient_team,
      subject: newMessage.subject,
      content: newMessage.content
    });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Sent!",
        description: "Your message has been sent to the team"
      });
      setNewMessage({ recipient_team: "", subject: "", content: "" });
      setIsDialogOpen(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Messages</h2>
          <p className="text-muted-foreground">Communicate with our support teams</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Message
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send a Message</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Send to</label>
                <Select 
                  value={newMessage.recipient_team}
                  onValueChange={(v) => setNewMessage({ ...newMessage, recipient_team: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer_service">Customer Service</SelectItem>
                    <SelectItem value="finance">Finance Team</SelectItem>
                    <SelectItem value="technical">Technical Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Subject</label>
                <Input 
                  placeholder="Message subject"
                  value={newMessage.subject}
                  onChange={(e) => setNewMessage({ ...newMessage, subject: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Textarea 
                  placeholder="Type your message..."
                  rows={5}
                  value={newMessage.content}
                  onChange={(e) => setNewMessage({ ...newMessage, content: e.target.value })}
                />
              </div>
              <Button className="w-full" onClick={handleSendMessage}>
                <Send className="w-4 h-4 mr-2" />
                Send Message
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {messages.length > 0 ? (
        <div className="space-y-4">
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className={message.is_read ? "" : "border-primary/50"}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      message.is_read ? "bg-muted" : "bg-primary/10"
                    }`}>
                      {message.is_read ? (
                        <MailOpen className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <Mail className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium">
                          {message.subject || "No Subject"}
                        </h4>
                        <span className="text-xs text-muted-foreground">
                          {new Date(message.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {message.content}
                      </p>
                      {message.recipient_team && (
                        <Badge variant="outline" className="mt-2 text-xs">
                          To: {message.recipient_team.replace("_", " ")}
                        </Badge>
                      )}
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
            <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Messages Yet</h3>
            <p className="text-muted-foreground mb-4">
              Start a conversation with our support team
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Message
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
