import { useScrollReveal } from "./useScrollReveal";

const items = [
  {
    title: "Overnight Pine learning",
    blurb: "Upload a template, optimize params on historical BTC-GBP, download rewritten script.",
  },
  {
    title: "Paper portfolio & fills",
    blurb: "Long-only simulator with stops, leverage sizing, and a clear fill ledger.",
  },
  {
    title: "Agent guardrails",
    blurb: "Session-aware rules block trades that violate your configured limits and news posture.",
  },
  {
    title: "Civic-ready dashboard",
    blurb: "Bearer session hooks for Pro flows, backtests, and personalized strategy chat context.",
  },
];

const FeaturesSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="features" className="relative scroll-mt-24 pt-6 pb-16 w-full" ref={ref}>
      <div className="mx-auto max-w-5xl">
        <div
          className={`text-center mb-16 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Features</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">What’s in the demo</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          {items.map((f, i) => (
            <div
              key={f.title}
              className={`rounded-2xl border border-border bg-vigil-surface/60 p-6 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
              style={{ transitionDelay: `${(i + 1) * 100}ms` }}
            >
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
