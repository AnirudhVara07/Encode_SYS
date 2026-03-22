import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/layout/AppShell";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StrategyChatWidget } from "@/components/StrategyChatWidget";
import { VigilUserProvider } from "@/context/VigilUserContext";
import Index from "./pages/Index.tsx";
import LiveDemo from "./pages/LiveDemo.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import NotFound from "./pages/NotFound.tsx";
import CivicCallback from "./pages/CivicCallback.tsx";
import Premium from "./pages/Premium.tsx";
import HowItWorksPage from "./pages/HowItWorksPage.tsx";
import RealTradingPage from "./pages/RealTradingPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <VigilUserProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Index />} />
              <Route path="/demo" element={<LiveDemo />} />
              <Route path="/paper-trading" element={<Dashboard />} />
              <Route path="/dashboard" element={<Navigate to="/paper-trading" replace />} />
              <Route path="/real-trading" element={<RealTradingPage />} />
              <Route path="/callback" element={<CivicCallback />} />
              <Route path="/premium" element={<Premium />} />
              <Route path="/how-it-works" element={<HowItWorksPage />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          <StrategyChatWidget />
        </VigilUserProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
