import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <VigilUserProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/demo" element={<LiveDemo />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/callback" element={<CivicCallback />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <StrategyChatWidget />
        </VigilUserProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
