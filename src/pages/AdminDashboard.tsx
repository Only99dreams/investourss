import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminHeader from "@/components/admin/AdminHeader";
import UsersTab from "@/components/admin/tabs/UsersTab";
import GroupsTab from "@/components/admin/tabs/GroupsTab";
import GFEsTab from "@/components/admin/tabs/GFEsTab";
import FirmsTab from "@/components/admin/tabs/FirmsTab";
import InvestmentsTab from "@/components/admin/tabs/InvestmentsTab";
import AIToolsTab from "@/components/admin/tabs/AIToolsTab";
import EducationTab from "@/components/admin/tabs/EducationTab";
import CommunityTab from "@/components/admin/tabs/CommunityTab";
import WalletsTab from "@/components/admin/tabs/WalletsTab";
import PayoutsTab from "@/components/admin/tabs/PayoutsTab";
import ReferralsTab from "@/components/admin/tabs/ReferralsTab";
import CampaignsTab from "@/components/admin/tabs/CampaignsTab";
import ResourcesTab from "@/components/admin/tabs/ResourcesTab";
import MessagesTab from "@/components/admin/tabs/MessagesTab";
import SupportTab from "@/components/admin/tabs/SupportTab";
import AdvertisingTab from "@/components/admin/tabs/AdvertisingTab";
import AdminOverview from "@/components/admin/AdminOverview";
import { Loader2 } from "lucide-react";


const AdminDashboard = () => {
  const { user, roles, isLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isAdmin = roles?.includes('admin');

  if (!user || !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className={`transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-16'}`}>
        <AdminHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="p-6">
          <Routes>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<UsersTab />} />
            <Route path="groups" element={<GroupsTab />} />
            <Route path="gfes" element={<GFEsTab />} />
            <Route path="firms" element={<FirmsTab />} />
            <Route path="investments" element={<InvestmentsTab />} />
            <Route path="ai-tools" element={<AIToolsTab />} />
            <Route path="education" element={<EducationTab />} />
            <Route path="community" element={<CommunityTab />} />
            <Route path="wallets" element={<WalletsTab />} />
            <Route path="payouts" element={<PayoutsTab />} />
            <Route path="referrals" element={<ReferralsTab />} />
            <Route path="campaigns" element={<CampaignsTab />} />
            <Route path="resources" element={<ResourcesTab />} />
            <Route path="messages" element={<MessagesTab />} />
            <Route path="support" element={<SupportTab />} />
            <Route path="advertising" element={<AdvertisingTab />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
