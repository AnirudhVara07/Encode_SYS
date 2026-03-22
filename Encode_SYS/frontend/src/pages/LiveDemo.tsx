import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { PaperBacktestPanel } from "@/components/trading/PaperBacktestPanel";
import { VigilAccessGate } from "@/components/VigilAccessGate";
import { useVigilUser } from "@/context/VigilUserContext";

const LiveDemo = () => {
  const { bearer } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());

  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        {!loggedIn ? (
          <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16 flex justify-center">
            <VigilAccessGate
              variant="page"
              title="Sign in to backtest"
              description="You need a Civic account to run historical backtests here. After you log in, you’ll return automatically."
              returnTo="/demo"
            />
          </div>
        ) : (
          <div className="container mx-auto max-w-6xl px-6 pt-28 pb-20 space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Back testing</h1>
              <p className="text-muted-foreground mt-1 max-w-2xl">
                Replay Vigil’s voting logic on past hourly candles. Results are simulated history, not your live paper
                book.                 For paper trading, streaming, and the full agent, open{" "}
                <span className="text-foreground font-medium">Paper Trading</span> in the nav.
              </p>
            </div>
            <PaperBacktestPanel bearer={bearer} />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default LiveDemo;
