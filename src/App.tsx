import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Welcome from "./pages/Welcome";
import Auth from "./pages/Auth";
import SignupTypeSelection from "./pages/SignupTypeSelection";
import AmbassadorApply from "./pages/Ambassador";
import FHAChatroom from "./pages/FHAChatroom";
import AuditorLanding from "./pages/AuditorLanding";
import AuditorConnect from "./pages/AuditorConnect";
import AuditorDashboard from "./pages/AuditorDashboard";
import AuditorPacks from "./pages/AuditorPacks";
import AuditorMonitoring from "./pages/AuditorMonitoring";
import CompleteProfile from "./pages/CompleteProfile";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Vetting from "./pages/Vetting";
import Community from "./pages/Community";
import FinancialTutor from "./pages/FinancialTutor";
import BusinessPlanGenerator from "./pages/BusinessPlanGenerator";
import Pricing from "./pages/Pricing";
import SubscriptionPage from "./pages/SubscriptionPage";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/home" element={<AuditorLanding />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/signup" element={<SignupTypeSelection />} />
            <Route path="/ambassador" element={<AmbassadorApply />} />
            <Route path="/fha-chatroom" element={<FHAChatroom />} />
            <Route path="/auditor" element={<ProtectedRoute><AuditorLanding /></ProtectedRoute>} />
            <Route path="/auditor/connect" element={<ProtectedRoute><AuditorConnect /></ProtectedRoute>} />
            <Route path="/auditor/audit" element={<ProtectedRoute><AuditorDashboard /></ProtectedRoute>} />
            <Route path="/auditor/packs" element={<ProtectedRoute><AuditorPacks /></ProtectedRoute>} />
            <Route path="/auditor/monitoring" element={<ProtectedRoute><AuditorMonitoring /></ProtectedRoute>} />
            <Route path="/complete-profile" element={<CompleteProfile />} />
            <Route path="/dashboard/*" element={<Dashboard />} />
            <Route path="/admin/*" element={<AdminDashboard />} />
            <Route path="/vetting" element={<ProtectedRoute><Vetting /></ProtectedRoute>} />
            <Route path="/community" element={<Community />} />
            <Route path="/tutor" element={<FinancialTutor />} />
            <Route path="/business-plan" element={<BusinessPlanGenerator />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/subscribe" element={<SubscriptionPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;