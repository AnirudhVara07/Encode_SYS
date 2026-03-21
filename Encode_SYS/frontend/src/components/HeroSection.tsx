import { Link } from "react-router-dom";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import { HERO_TICKER_PAIRS, pctChange24h } from "@/lib/coinbaseTickerItems";
import VigilEye from "./VigilEye";

const STRIP_COUNT = 8;

function TickerStrip() {
  const ids = HERO_TICKER_PAIRS.map((p) => p.productId);
  const { ticks, status } = useCoinbaseTicker(ids);

  const visible = HERO_TICKER_PAIRS.filter((p) => Boolean(ticks[p.productId]));

  if (visible.length === 0) {
    const msg = status === "live" ? "No quotes for selected pairs" : "Connecting to exchange…";
    return (
      <>
        {[...Array(STRIP_COUNT)].map((_, i) => (
          <div key={i} className="flex shrink-0 gap-8 px-4 font-mono text-xs text-muted-foreground">
            <span>{msg}</span>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {[...Array(STRIP_COUNT)].map((_, i) => (
        <div key={i} className="flex shrink-0 gap-8 px-4 font-mono text-xs text-muted-foreground">
          {visible.map(({ productId, label }) => {
            const t = ticks[productId]!;
            const pct = pctChange24h(t.price, t.open24h);
            const up = pct != null && pct >= 0;
            return (
              <span key={`${i}-${productId}`}>
                {label}{" "}
                {pct == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={up ? "text-vigil-green" : "text-vigil-red"}>
                    {up ? "+" : "−"}
                    {Math.abs(pct).toFixed(2)}%
                  </span>
                )}
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
}

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-28 overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />

      {/* Radial glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, hsl(var(--vigil-glow) / 0.3), transparent 70%)' }} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
        <div className="opacity-0 animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <VigilEye size={100} />
        </div>

        <div className="mt-10 opacity-0 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Always Watching</span>
        </div>

        <h1 className="mt-5 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.95] opacity-0 animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
          Your trading strategy<br />
          <span className="text-glow text-primary">never sleeps.</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed opacity-0 animate-fade-in-up" style={{ animationDelay: '0.7s' }}>
          Vigil learns how you trade, then trades like you while you sleep — and makes you better when you wake up.
        </p>

        <div className="mt-10 flex justify-center opacity-0 animate-fade-in-up" style={{ animationDelay: '0.9s' }}>
          <Link
            to="/demo"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-base font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] box-glow"
          >
            Use Vigil
          </Link>
        </div>
      </div>

      {/* Ticker: fixed to viewport so it stays put while scrolling; 8 strips + -12.5% keeps the loop seamless on very wide viewports */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-vigil-surface/80 backdrop-blur py-3 overflow-hidden opacity-0 animate-fade-in"
        style={{ animationDelay: "1.2s" }}
        aria-label="Live Coinbase spot 24h change"
      >
        <div className="flex w-max animate-ticker-8 whitespace-nowrap will-change-transform">
          <TickerStrip />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
