import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

const Premium = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container mx-auto max-w-lg px-6 pt-28 pb-20">
        <h1 className="text-2xl font-semibold tracking-tight">Premium</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Vigil Premium isn’t available yet. This page is a placeholder for upcoming paid features.
        </p>
        <Button asChild className="mt-8">
          <Link to="/demo">Back to Back testing</Link>
        </Button>
      </main>
      <Footer />
    </div>
  );
};

export default Premium;
