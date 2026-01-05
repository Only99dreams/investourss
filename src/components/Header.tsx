import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Menu, X, User, LogOut, Settings, LayoutDashboard, ChevronDown, Shield, Building } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import investoursLogo from "@/assets/Investours1b.png";
import { useAuth } from "@/hooks/useAuth";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, profile, roles, signOut, isLoading } = useAuth();
  const navigate = useNavigate();

  const isAdmin = roles?.includes('admin');
  const isFirmOwner = roles?.includes('firm_admin') || roles?.includes('firm_staff');

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getTierBadge = (tier: string | null) => {
    if (!tier || tier === 'free') return null;
    return (
      <Badge variant={tier === 'exclusive' ? 'default' : 'secondary'} className="text-xs">
        {tier}
      </Badge>
    );
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <img 
              src={investoursLogo} 
              alt="Investours" 
              className="w-10 h-10 md:w-12 md:h-12"
            />
            <span className="text-xl font-bold text-primary hidden sm:block">
              Investours
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link 
              to="/home" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Home
            </Link>
            <Link 
              to="/learning" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Learning
            </Link>
            <Link 
              to="/vetting" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Scam Detector
            </Link>
            <Link 
              to="/investing" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Safe Offers
            </Link>
            <Link 
              to="/community" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Community
            </Link>
            <Link 
              to="/pricing" 
              className="text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Pricing
            </Link>
          </nav>

          {/* Auth Section */}
          <div className="hidden md:flex items-center gap-3">
            {isLoading ? (
              <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            ) : user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={profile?.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-sm">
                        {getInitials(profile?.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground hidden lg:block max-w-[120px] truncate">
                        {profile?.full_name || 'User'}
                      </span>
                      {getTierBadge(profile?.user_tier)}
                    </div>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span>{profile?.full_name || 'User'}</span>
                      <span className="text-xs text-muted-foreground font-normal">{profile?.email}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/dashboard/profile')}>
                    <User className="w-4 h-4 mr-2" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/dashboard/settings')}>
                    <Settings className="w-4 h-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate('/admin')}>
                        <Shield className="w-4 h-4 mr-2" />
                        Admin Panel
                      </DropdownMenuItem>
                    </>
                  )}
                  {isFirmOwner && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate('/firm')}>
                        <Building className="w-4 h-4 mr-2" />
                        Firm Dashboard
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link to="/auth?mode=login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link to="/auth?mode=signup">
                  <Button variant="default">Sign Up</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 text-foreground"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="md:hidden absolute top-full left-0 right-0 bg-card border-b border-border shadow-lg"
        >
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-2">
            {user && (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border mb-2">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={profile?.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getInitials(profile?.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{profile?.full_name || 'User'}</span>
                      {getTierBadge(profile?.user_tier)}
                    </div>
                    <span className="text-sm text-muted-foreground">{profile?.email}</span>
                  </div>
                </div>
                <Link 
                  to="/dashboard" 
                  className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors flex items-center gap-2"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
              </>
            )}
            <Link 
              to="/home" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Home
            </Link>
            <Link 
              to="/learning" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Learning
            </Link>
            <Link 
              to="/vetting" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Scam Detector
            </Link>
            <Link 
              to="/investing" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Safe Offers
            </Link>
            <Link 
              to="/community" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Community
            </Link>
            <Link 
              to="/pricing" 
              className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Pricing
            </Link>
            {user && isAdmin && (
              <Link 
                to="/admin" 
                className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors flex items-center gap-2"
                onClick={() => setIsMenuOpen(false)}
              >
                <Shield className="w-4 h-4" />
                Admin Panel
              </Link>
            )}
            {user && isFirmOwner && (
              <Link 
                to="/firm" 
                className="py-2 px-4 rounded-lg text-foreground hover:bg-secondary transition-colors flex items-center gap-2"
                onClick={() => setIsMenuOpen(false)}
              >
                <Building className="w-4 h-4" />
                Firm Dashboard
              </Link>
            )}
            <div className="border-t border-border my-2" />
            {user ? (
              <div className="px-2">
                <Button 
                  variant="destructive" 
                  className="w-full"
                  onClick={() => {
                    handleSignOut();
                    setIsMenuOpen(false);
                  }}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            ) : (
              <div className="flex gap-2 px-2">
                <Link to="/auth?mode=login" className="flex-1" onClick={() => setIsMenuOpen(false)}>
                  <Button variant="outline" className="w-full">Login</Button>
                </Link>
                <Link to="/signup" className="flex-1" onClick={() => setIsMenuOpen(false)}>
                  <Button variant="default" className="w-full">Sign Up</Button>
                </Link>
              </div>
            )}
          </nav>
        </motion.div>
      )}
    </header>
  );
};

export default Header;
