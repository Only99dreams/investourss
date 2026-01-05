import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { ProfileSection } from "@/components/dashboard/sections/ProfileSection";
import { WalletsSection } from "@/components/dashboard/sections/WalletsSection";
import { EducationSection } from "@/components/dashboard/sections/EducationSection";
import { InvestmentsSection } from "@/components/dashboard/sections/InvestmentsSection";
import { ReferralsSection } from "@/components/dashboard/sections/ReferralsSection";
import { MessagesSection } from "@/components/dashboard/sections/MessagesSection";
import { SettingsSection } from "@/components/dashboard/sections/SettingsSection";
import { NotificationsSection } from "@/components/dashboard/sections/NotificationsSection";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";

const Dashboard = () => {
  const { user, profile, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      // Check for referral code and store it before redirect
      const refCode = searchParams.get("ref");
      if (refCode) {
        sessionStorage.setItem("referral_code", refCode);
      }
      navigate("/auth");
    }
  }, [user, isLoading, navigate, searchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <DashboardSidebar />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <DashboardSidebar />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <Routes>
          <Route index element={<Navigate to="/dashboard/education" replace />} />
          <Route path="/profile" element={
            <>
              <DashboardHeader title="Profile" onMenuClick={() => setSidebarOpen(true)} />
              <ProfileSection />
            </>
          } />
          <Route path="/wallets" element={
            <>
              <DashboardHeader title="Wallets" onMenuClick={() => setSidebarOpen(true)} />
              <WalletsSection />
            </>
          } />
          <Route path="/education" element={
            <>
              <DashboardHeader title="Education & Mentorship" onMenuClick={() => setSidebarOpen(true)} />
              <EducationSection />
            </>
          } />
          <Route path="/investments" element={
            <>
              <DashboardHeader title="My Investments" onMenuClick={() => setSidebarOpen(true)} />
              <InvestmentsSection />
            </>
          } />
          <Route path="/referrals" element={
            <>
              <DashboardHeader title="Referrals & Performance" onMenuClick={() => setSidebarOpen(true)} />
              <ReferralsSection />
            </>
          } />
          <Route path="/messages" element={
            <>
              <DashboardHeader title="Messages" onMenuClick={() => setSidebarOpen(true)} />
              <MessagesSection />
            </>
          } />
          <Route path="/settings" element={
            <>
              <DashboardHeader title="Settings" onMenuClick={() => setSidebarOpen(true)} />
              <SettingsSection />
            </>
          } />
          <Route path="/notifications" element={
            <>
              <DashboardHeader title="Notifications" onMenuClick={() => setSidebarOpen(true)} />
              <NotificationsSection />
            </>
          } />
          <Route path="/ai-reports" element={
            <>
              <DashboardHeader title="AI Reports" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">AI Reports - Searches & Scam Checks. Coming soon...</p>
              </div>
            </>
          } />
          <Route path="/microinsurance" element={
            <>
              <DashboardHeader title="Microinsurance" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">Microinsurance. Coming soon...</p>
              </div>
            </>
          } />
          <Route path="/leaderboard" element={
            <>
              <DashboardHeader title="Leaderboard" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">Leaderboard. Coming soon...</p>
              </div>
            </>
          } />
          <Route path="/sdg" element={
            <>
              <DashboardHeader title="SDG Impact" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">SDG Impact. Coming soon...</p>
              </div>
            </>
          } />
          <Route path="/complaints" element={
            <>
              <DashboardHeader title="Complaints" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">Complaints. Coming soon...</p>
              </div>
            </>
          } />
          <Route path="/*" element={
            <>
              <DashboardHeader title="Dashboard" onMenuClick={() => setSidebarOpen(true)} />
              <div className="p-6">
                <p className="text-muted-foreground">Coming soon...</p>
              </div>
            </>
          } />
        </Routes>
      </div>
    </div>
  );
};

export default Dashboard;
