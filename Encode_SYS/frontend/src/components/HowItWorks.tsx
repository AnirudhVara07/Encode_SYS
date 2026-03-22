import { cn } from "@/lib/utils";
import { useScrollReveal } from "./useScrollReveal";

const steps = [
  {
    n: "01",
    title: "Teach Vigil your style",
    body: "Sync a strategy profile from past trades or upload a Vigil-tagged Pine template. The demo learns parameters against BTC-GBP candles.",
  },
  {
    n: "02",
    title: "Paper Vigil runs the rules",
    body: "Majority-vote automation and agent guardrails evaluate every simulated order, same gates you’d use before going live.",
  },
  {
    n: "03",
    title: "Wake up to the debrief",
    body: "Overnight optimization rewrites Pine, surfaces metrics, and suggests what to try next, without promising returns.",
  },
];

type HowItWorksProps = {
  className?: string;
};

const HowItWorks = ({ className }: HowItWorksProps) => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="how-it-works" className={cn("relative py-32 px-6 scroll-mt-24", className)} ref={ref}>
      <div className="container mx-auto max-w-5xl">
        <div
          className={`text-center mb-16 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">How it works</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Three beats</h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            From template or profile to simulated execution and morning report, all in the demo stack.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`rounded-2xl border border-border bg-vigil-surface/80 p-8 backdrop-blur transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
              style={{ transitionDelay: `${(i + 1) * 120}ms` }}
            >
              <span className="font-mono text-xs tracking-widest text-primary">{s.n}</span>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
