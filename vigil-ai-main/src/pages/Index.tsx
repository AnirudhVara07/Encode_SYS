import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import HowItWorks from "@/components/HowItWorks";
import FeaturesSection from "@/components/FeaturesSection";
import PerformanceReport from "@/components/PerformanceReport";
import TechStack from "@/components/TechStack";
import Footer from "@/components/Footer";

const Index = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <HeroSection />
    <HowItWorks />
    <FeaturesSection />
    <PerformanceReport />
    <TechStack />
    <Footer />
  </div>
);

export default Index;
