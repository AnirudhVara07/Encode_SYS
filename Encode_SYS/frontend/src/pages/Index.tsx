import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import FeaturesSection from "@/components/FeaturesSection";
import Footer from "@/components/Footer";
import HeroSection from "@/components/HeroSection";
import HowItWorks from "@/components/HowItWorks";
import MarketNewsSection from "@/components/MarketNewsSection";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";

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
    <div className="min-h-screen bg-background pb-16">
      <Navbar />
      <HeroSection />
      <section className="px-6 -mt-4 pb-4" aria-label="Live market prices">
        <div className="container mx-auto max-w-5xl space-y-5">
          <CoinbaseLiveMarkets variant="compact" />
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              className="w-full max-w-sm sm:w-auto font-medium"
              onClick={scrollToMarketNewsSection}
            >
              Marketing current news
            </Button>
          </div>
        </div>
      </section>
      <MarketNewsSection className="pt-10 pb-32" />
      <HowItWorks />
      <FeaturesSection />
      <Footer />
    </div>
  );
};

export default Index;
