import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import Footer from "@/components/Footer";
import HeroSection from "@/components/HeroSection";
import MarketNewsSection from "@/components/MarketNewsSection";
import Navbar from "@/components/Navbar";
function scrollToMarketNewsSection() {
  document.getElementById("market-news")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const Index = () => {
  const location = useLocation();

  useEffect(() => {
    const st = location.state as { scrollToMarketNews?: boolean } | null;
    if (!st?.scrollToMarketNews) return;
    const id = window.setTimeout(() => {
      scrollToMarketNewsSection();
      window.history.replaceState({}, document.title);
    }, 120);
    return () => window.clearTimeout(id);
  }, [location.state]);

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      <HeroSection />
      <section className="px-6 -mt-4 pb-4" aria-label="Live market prices">
        <div className="container mx-auto max-w-5xl">
          <CoinbaseLiveMarkets variant="compact" />
        </div>
      </section>
      <MarketNewsSection className="pt-8 pb-10" />
      <Footer />
    </div>
  );
};

export default Index;
