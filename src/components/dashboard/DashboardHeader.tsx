import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Menu, Search, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

export function DashboardHeader({ title, onMenuClick }: DashboardHeaderProps) {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!user) return;
      
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false);

        if (error) throw error;

        setUnreadCount(count || 0);
      } catch (error) {
        console.error('Error fetching unread count:', error);
      }
    };

    if (user) {
      fetchUnreadCount();
      
      // Subscribe to realtime updates
      const channel = supabase
        .channel('notifications-count')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        }, () => {
          fetchUnreadCount();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex items-center justify-between h-full px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
            <Menu className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">
              Welcome, {profile?.full_name || "User"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:block relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search..." 
              className="pl-9 w-64 bg-muted/50"
            />
          </div>

          <Button 
            variant="ghost" 
            size="icon" 
            className="relative"
            onClick={() => navigate('/dashboard/notifications')}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1.5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>

          {profile?.user_tier === "free" && (
            <Button 
              variant="default" 
              size="sm"
              onClick={() => navigate('/subscribe')}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <Crown className="w-4 h-4 mr-2" />
              Upgrade
            </Button>
          )}

          {profile?.user_tier === "premium" && profile?.subscription_type !== "annual" && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/subscribe')}
              className="border-primary/50 text-primary hover:bg-primary/10"
            >
              <Crown className="w-4 h-4 mr-2" />
              Upgrade Plan
            </Button>
          )}

          <div className={cn(
            "px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1",
            profile?.user_tier === "premium" ? 
              profile?.subscription_type === "annual" ? "bg-investours-gold/20 text-investours-gold" :
              profile?.subscription_type === "quarterly" ? "bg-accent/20 text-accent" :
              "bg-primary/20 text-primary" :
            profile?.user_tier === "exclusive" ? "bg-primary/20 text-primary" :
            "bg-muted text-muted-foreground"
          )}>
            {profile?.user_tier?.toUpperCase() || "FREE"}
            {profile?.user_tier === "premium" && profile?.subscription_type && (
              <span className="text-xs opacity-75">
                ({profile.subscription_type})
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
