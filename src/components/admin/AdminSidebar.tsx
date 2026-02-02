import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Users,
  UsersRound,
  Award,
  Building2,
  TrendingUp,
  Brain,
  GraduationCap,
  MessageSquare,
  Wallet,
  CreditCard,
  Share2,
  Megaphone,
  FileText,
  Mail,
  HeadphonesIcon,
  LayoutDashboard,
  ChevronLeft,
  Radio,
  Settings,
  Banknote,
  Tag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AdminSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/admin" },
  { icon: Users, label: "Users", path: "/admin/users" },
  { icon: UsersRound, label: "Groups", path: "/admin/groups" },
  { icon: Award, label: "GFEs", path: "/admin/gfes" },
  { icon: Building2, label: "Firms", path: "/admin/firms" },
  { icon: TrendingUp, label: "Investments", path: "/admin/investments" },
  { icon: Brain, label: "AI Tools", path: "/admin/ai-tools" },
  { icon: GraduationCap, label: "Education", path: "/admin/education" },
  { icon: MessageSquare, label: "Community", path: "/admin/community" },
  { icon: Wallet, label: "Wallets", path: "/admin/wallets" },
  { icon: Banknote, label: "Deposit Requests", path: "/admin/deposit-requests" },
  { icon: CreditCard, label: "Payouts", path: "/admin/payouts" },
  { icon: Share2, label: "Referrals", path: "/admin/referrals" },
  { icon: Megaphone, label: "Campaigns", path: "/admin/campaigns" },
  { icon: Tag, label: "Promo Codes", path: "/admin/promo-codes" },
  { icon: FileText, label: "Resources", path: "/admin/resources" },
  { icon: Mail, label: "Messages", path: "/admin/messages" },
  { icon: HeadphonesIcon, label: "Support", path: "/admin/support" },
  { icon: Radio, label: "Advertising", path: "/admin/advertising" },
  { icon: Settings, label: "Settings", path: "/admin/settings" },
];

const AdminSidebar = ({ isOpen, onToggle }: AdminSidebarProps) => {
  const location = useLocation();

  return (
    <motion.aside
      initial={false}
      animate={{ width: isOpen ? 256 : 64 }}
      className="fixed left-0 top-0 h-full bg-card border-r border-border z-50 flex flex-col"
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2"
          >
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <LayoutDashboard className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Admin Panel</span>
          </motion.div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="ml-auto"
        >
          <ChevronLeft className={cn("w-4 h-4 transition-transform", !isOpen && "rotate-180")} />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path || 
              (item.path !== "/admin" && location.pathname.startsWith(item.path));
            
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {isOpen && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-medium truncate"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      {isOpen && (
        <div className="p-4 border-t border-border">
          <Link to="/dashboard">
            <Button variant="outline" className="w-full">
              Back to Dashboard
            </Button>
          </Link>
        </div>
      )}
    </motion.aside>
  );
};

export default AdminSidebar;
