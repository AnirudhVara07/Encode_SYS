import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import {
  HERO_ALT_ROTATION_POOL,
  HERO_ANCHOR_PAIRS,
  HERO_TICKER_ALL_PRODUCT_IDS,
  heroTickerMetaForProduct,
  pctChange24h,
  pickHeroAltProductIds,
} from "@/lib/coinbaseTickerItems";
import VigilEye from "./VigilEye";

const STRIP_COUNT = 8;

function TickerStrip() {
  const { ticks, status } = useCoinbaseTicker(HERO_TICKER_ALL_PRODUCT_IDS);

  /** Recompute alt slots when the positive set changes, not on every tick price wiggle. */
  const positiveSetKey = useMemo(() => {
    const ids: string[] = [];
    for (const p of HERO_ALT_ROTATION_POOL) {
      const t = ticks[p.productId];
      const pct = t ? pctChange24h(t.price, t.open24h) : null;
      if (pct != null && pct > 0) ids.push(p.productId);
    }
    ids.sort();
    return ids.join(",");
  }, [ticks]);

  const lastKeyRef = useRef<string | null>(null);
  const [altIds, setAltIds] = useState<string[]>(() => pickHeroAltProductIds({}));

  useEffect(() => {
    if (lastKeyRef.current === positiveSetKey) return;
    lastKeyRef.current = positiveSetKey;
    setAltIds(pickHeroAltProductIds(ticks));
  }, [positiveSetKey, ticks]);

  const stripMetas = useMemo(() => {
    const row: NonNullable<ReturnType<typeof heroTickerMetaForProduct>>[] = [];
    for (const p of HERO_ANCHOR_PAIRS) row.push(p);
    for (const id of altIds) {
      const m = heroTickerMetaForProduct(id);
      if (m) row.push(m);
    }
    return row;
  }, [altIds]);

  const showGlobalMsg = stripMetas.every((p) => !ticks[p.productId]) && status !== "live";

  if (showGlobalMsg) {
    const msg = "Connecting to exchange…";
    return (
      <>
        {[...Array(STRIP_COUNT)].map((_, i) => (
          <div key={i} className="flex shrink-0 items-center font-mono text-xs text-muted-foreground">
            <div className="flex gap-6 pr-8">
              <span>{msg}</span>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {[...Array(STRIP_COUNT)].map((_, i) => (
        <div key={i} className="flex shrink-0 items-center gap-8 pr-10 font-mono text-sm">
          {stripMetas.map(({ productId, symbol }) => {
            const t = ticks[productId];
            const pct = t ? pctChange24h(t.price, t.open24h) : null;
            const up = pct != null && pct >= 0;
            return (
              <span key={`${i}-${productId}`} className="inline-flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="font-semibold text-foreground">{symbol}</span>
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
      <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
        <div className="opacity-0 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <VigilEye size={100} />
        </div>

        <div className="mt-10 opacity-0 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Always Watching</span>
        </div>

        <h1
          className="mt-5 text-5xl sm:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.5s" }}
        >
          Your trading strategy
          <br />
          <span className="text-glow text-primary">never sleeps.</span>
        </h1>

        <p
          className="mt-6 text-xl sm:text-2xl text-muted-foreground max-w-2xl leading-relaxed opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.7s" }}
        >
          Vigil learns how you trade, then trades like you while you sleep.
        </p>

        <div className="mt-10 flex justify-center opacity-0 animate-fade-in-up" style={{ animationDelay: "0.9s" }}>
          <Link
            to="/demo"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-lg font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] box-glow"
          >
            Back testing
          </Link>
        </div>
      </div>

      {/* Ticker: fixed to viewport; 8 duplicate strips + -12.5% keeps the loop seamless */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-vigil-surface/80 backdrop-blur px-4 py-3 overflow-hidden opacity-0 animate-fade-in"
        style={{ animationDelay: "1.2s" }}
        aria-label="Live Coinbase 24h percent change by symbol"
      >
        <div className="flex w-max animate-ticker-8 whitespace-nowrap will-change-transform">
          <TickerStrip />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
