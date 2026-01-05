import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { 
  User, Wallet, GraduationCap, TrendingUp, FileText, Users, 
  Settings, Bell, MessageSquare, AlertCircle, Share2, Trophy,
  Target, LogOut, Shield, Umbrella
} from "lucide-react";
import investoursLogo from "@/assets/investours-logo.png";

const sidebarItems = [
  { icon: GraduationCap, label: "Education", path: "/dashboard/education" },
  { icon: User, label: "Profile", path: "/dashboard" },
  { icon: Bell, label: "Notifications", path: "/dashboard/notifications" },
  { icon: FileText, label: "AI Reports", path: "/dashboard/ai-reports", subtitle: "Searches & Scam Checks" },
  { icon: TrendingUp, label: "Investments", path: "/dashboard/investments" },
  { icon: Umbrella, label: "Microinsurance", path: "/dashboard/microinsurance" },
  { icon: Share2, label: "Referrals", path: "/dashboard/referrals" },
  { icon: Trophy, label: "Leaderboard", path: "/dashboard/leaderboard" },
  { icon: Wallet, label: "Wallets", path: "/dashboard/wallets" },
  { icon: Target, label: "SDG Impact", path: "/dashboard/sdg" },
  { icon: MessageSquare, label: "Messages", path: "/dashboard/messages" },
  { icon: AlertCircle, label: "Complaints", path: "/dashboard/complaints" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
];

export function DashboardSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isAdmin } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <aside className="w-64 bg-card border-r border-border min-h-screen flex flex-col">
      <div className="p-4 border-b border-border">
        <Link to="/home" className="flex items-center gap-2">
          <img src={investoursLogo} alt="Investours" className="w-8 h-8" />
          <span className="font-bold text-lg">Investours</span>
        </Link>
      </div>

      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{profile?.full_name || "User"}</p>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              profile?.user_tier === "premium" ? "bg-gold/20 text-gold" :
              profile?.user_tier === "exclusive" ? "bg-primary/20 text-primary" :
              "bg-muted text-muted-foreground"
            )}>
              {profile?.user_tier?.toUpperCase() || "FREE"}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {sidebarItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{item.label}</div>
                {item.subtitle && (
                  <div className="text-xs opacity-70 truncate">{item.subtitle}</div>
                )}
              </div>
            </Link>
          );
        })}
        
        {/* Admin Panel - Only visible to admin users */}
        {isAdmin && (
          <Link
            to="/admin"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              location.pathname.startsWith("/admin")
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Shield className="w-4 h-4 shrink-0" />
            <span>Admin Panel</span>
          </Link>
        )}
      </nav>

      <div className="p-2 border-t border-border">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
