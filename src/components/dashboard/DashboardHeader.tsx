import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarClock, Menu, Search, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getBookmakerEntitlement, BOOKMAKER_CREDITS_CHANGED } from "@/lib/bookmakerApi";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

export function DashboardHeader({ title, onMenuClick }: DashboardHeaderProps) {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [credits, setCredits] = useState<{
    total: number;
    subscription: number;
    packs: number;
  } | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  // Credits shown in the header are the same balance Bookmaker spends:
  // subscription credits plus unexpired pack credits. Refetch on focus so a
  // purchase made in another tab is reflected here.
  useEffect(() => {
    const uid = user?.id ?? profile?.id;
    if (!uid) {
      setCredits(null);
      setPeriodEnd(null);
      return;
    }
    let cancelled = false;
    const loadCredits = async () => {
      const entitlement = await getBookmakerEntitlement();
      if (cancelled) return;
      setCredits({
        total: entitlement.total_available,
        subscription: entitlement.subscription_credits_remaining,
        packs: entitlement.pack_credits_remaining,
      });
      setPeriodEnd(entitlement.subscription_period_end ?? null);
    };
    void loadCredits();
    window.addEventListener("focus", loadCredits);
    window.addEventListener(BOOKMAKER_CREDITS_CHANGED, loadCredits);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadCredits);
      window.removeEventListener(BOOKMAKER_CREDITS_CHANGED, loadCredits);
    };
  }, [user?.id, profile?.id]);

  const expiryValue = profile?.subscription_expires_at ?? periodEnd;
  const expiryDate = expiryValue ? new Date(expiryValue) : null;
  const daysLeft = expiryDate
    ? Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000)
    : null;
  const expiryLabel = expiryDate
    ? expiryDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const expired = daysLeft !== null && daysLeft < 0;

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
    <header className="min-h-20 md:min-h-16 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex items-center justify-between gap-3 min-h-20 md:min-h-16 px-4 md:px-6 py-2 flex-wrap">
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

        <div className="flex items-center gap-1 sm:gap-3 flex-wrap justify-end">
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
              className="inline-flex bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <Crown className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Upgrade</span>
            </Button>
          )}

          {profile?.user_tier === "premium" && profile?.subscription_type !== "annual" && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate('/subscribe')}
              className="inline-flex border-primary/50 text-primary hover:bg-primary/10"
            >
              <Crown className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Upgrade Plan</span>
            </Button>
          )}

          <div className={cn(
            "px-2 sm:px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1",
            profile?.user_tier === "premium" ?
              profile?.subscription_type === "annual" ? "bg-investours-gold/20 text-investours-gold" :
              profile?.subscription_type === "biennial" ? "bg-accent/20 text-accent" :
              profile?.subscription_type === "quarterly" ? "bg-primary/20 text-primary" :
              "bg-primary/20 text-primary" :
            profile?.user_tier === "exclusive" ? "bg-primary/20 text-primary" :
            "bg-muted text-muted-foreground"
          )}>
            {profile?.user_tier?.toUpperCase() || "FREE"}
            {profile?.user_tier === "premium" && profile?.subscription_type && (
              <span className="hidden sm:inline text-xs opacity-75">
                ({profile.subscription_type})
              </span>
            )}
          </div>

          {credits && (
            <div
              className="px-2 sm:px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 bg-gold/10 text-gold"
              title={`${credits.subscription} subscription credit${credits.subscription === 1 ? "" : "s"} + ${credits.packs} pack credit${credits.packs === 1 ? "" : "s"}`}
            >
              <Coins className="w-3.5 h-3.5 shrink-0" />
              {credits.total} credit{credits.total === 1 ? "" : "s"}
            </div>
          )}

          {expiryLabel && (
            <div
              className={cn(
                "px-2 sm:px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1",
                expired
                  ? "bg-destructive/10 text-destructive"
                  : daysLeft !== null && daysLeft <= 7
                    ? "bg-amber-100 text-amber-800"
                    : "bg-muted text-muted-foreground",
              )}
              title={
                expired
                  ? `Subscription expired on ${expiryLabel}`
                  : `Subscription ends ${expiryLabel}${daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}`
              }
            >
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{expired ? "Expired " : "Ends "}</span>
              {expiryLabel}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
