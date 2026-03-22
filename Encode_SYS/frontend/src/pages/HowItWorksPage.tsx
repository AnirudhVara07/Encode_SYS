import FeaturesSection from "@/components/FeaturesSection";
import Footer from "@/components/Footer";
import HowItWorks from "@/components/HowItWorks";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";

/**
 * On-page copy is aligned with the product overview PDF (vigil-how-it-works.pdf).
 * Download the PDF from /vigil-how-it-works.pdf when served from the app.
 */
const HowItWorksPage = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="container mx-auto px-6 pt-28 pb-20 space-y-12">
        <div className="mx-auto max-w-3xl space-y-12">
          <header className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-primary">Overview</p>
            <h1 className="text-3xl font-bold tracking-tight">How Vigil works</h1>
            <p className="text-muted-foreground leading-relaxed max-w-2xl">
              Crypto markets run 24/7. You don&apos;t. Vigil watches how you trade, mirrors your strategy when you step
              away, and helps you improve with clear feedback.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <a href="/vigil-how-it-works.pdf" download="Vigil-overview.pdf">
                  <Download className="h-4 w-4 mr-2" aria-hidden />
                  Download overview
                </a>
              </Button>
            </div>
          </header>
        </div>

        <FeaturesSection />

        <HowItWorks className="py-20 md:py-24" />

        <div className="mx-auto max-w-3xl space-y-12">
        <section className="space-y-4" aria-labelledby="problem-heading">
          <h2 id="problem-heading" className="text-xl font-semibold">
            The problem
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground leading-relaxed">
            <li>Busy people miss trades while they sleep.</li>
            <li>Existing bots rarely match your personal style and rules.</li>
          </ul>
        </section>

        <section className="space-y-4" aria-labelledby="what-heading">
          <h2 id="what-heading" className="text-xl font-semibold">
            What Vigil does
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-muted-foreground leading-relaxed">
            <li>Watches how you trade and learns your strategy profile.</li>
            <li>Mimics your strategy when you are inactive (paper and, for Pro, autonomous flows).</li>
            <li>Gives you feedback to improve discipline and configuration.</li>
          </ul>
        </section>

        <section className="space-y-4" aria-labelledby="arch-heading">
          <h2 id="arch-heading" className="text-xl font-semibold">
            System architecture (demo stack)
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The live app wires together sign-in (Civic), a simulated GBP portfolio, Coinbase public spot data,
            optional MarketAux headlines, template-based signals (Pine-style Vigil templates), majority-vote Paper
            Vigil, overnight optimization on uploaded scripts, and an optional full agent path when you are ready.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Plans at a glance</CardTitle>
            <CardDescription>As described in the Vigil overview. Features expand as you move from free to Pro.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 pr-4 font-semibold text-foreground">Free</th>
                  <th className="py-3 font-semibold text-foreground">Pro</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <td className="py-3 pr-4">Paper trading</td>
                  <td className="py-3">Live autonomous trading (stub / roadmap execution layer)</td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="py-3 pr-4">Strategy backtest</td>
                  <td className="py-3">Overnight agent and extended replay where enabled</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4">AI recommendations</td>
                  <td className="py-3">Performance reports and deeper automation</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-4 font-mono">
              Exact limits depend on your session and server configuration. Use Simulate Pro in the account menu to
              preview Pro-only paths in this demo.
            </p>
          </CardContent>
        </Card>

        <section
          className="rounded-xl border border-primary/40 bg-primary px-6 py-8 text-center"
          aria-label="Closing message"
        >
          <p className="text-base font-bold text-white">Now go to sleep. Vigil&apos;s got it from here.</p>
        </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default HowItWorksPage;
