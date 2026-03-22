import { Link } from "react-router-dom";
import VigilEye from "./VigilEye";
import { FadeIn } from "./hero/FadeIn";
import { HeroTickerStrip } from "./hero/HeroTickerStrip";

const HERO_ANIMATION = {
  eye: "0.1s",
  tagline: "0.3s",
  headline: "0.5s",
  subhead: "0.7s",
  cta: "0.9s",
  tickerBar: "1.2s",
} as const;

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-28 overflow-hidden">
      <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
        <FadeIn delay={HERO_ANIMATION.eye} animation="fade-in">
          <VigilEye size={100} />
        </FadeIn>

        <FadeIn delay={HERO_ANIMATION.tagline} className="mt-10">
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Always Watching</span>
        </FadeIn>

        <FadeIn delay={HERO_ANIMATION.headline} className="mt-5 text-5xl sm:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95]">
          <h1>
            Your trading strategy
            <br />
            <span className="text-glow text-primary">never sleeps.</span>
          </h1>
        </FadeIn>

        <FadeIn delay={HERO_ANIMATION.subhead} className="mt-6 text-xl sm:text-2xl text-muted-foreground max-w-2xl leading-relaxed">
          <p>Vigil learns how you trade, then trades like you while you sleep.</p>
        </FadeIn>

        <FadeIn delay={HERO_ANIMATION.cta} className="mt-10 flex justify-center">
          <Link
            to="/real-trading"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-lg font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] box-glow"
          >
            Real trading
          </Link>
        </FadeIn>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-vigil-surface/80 backdrop-blur px-4 py-3 overflow-hidden opacity-0 animate-fade-in"
        style={{ animationDelay: HERO_ANIMATION.tickerBar }}
        aria-label="Live Coinbase 24h percent change by symbol"
      >
        <div className="flex w-max animate-ticker-8 whitespace-nowrap will-change-transform">
          <HeroTickerStrip />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
