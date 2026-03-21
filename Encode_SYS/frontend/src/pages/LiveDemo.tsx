import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import DemoAiNewsPanel from "@/components/DemoAiNewsPanel";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import OvernightLearningSection from "@/components/OvernightLearningSection";

const LiveDemo = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <div className="container mx-auto max-w-5xl px-6 pt-28 pb-4">
          <CoinbaseLiveMarkets variant="full" />
        </div>
        <DemoAiNewsPanel />
        <OvernightLearningSection />
      </main>
      <Footer />
    </div>
  );
};

export default LiveDemo;
