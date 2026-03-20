import { useScrollReveal } from "./useScrollReveal";

const features = [
  { title: "Behavioral Fingerprint", accent: "vigil-glow" },
  { title: "Bounded Autonomy", accent: "vigil-green" },
  { title: "Morning Debrief", accent: "vigil-glow" },
  { title: "On-chain Execution", accent: "vigil-green" },
  { title: "Identity Guardrails", accent: "vigil-glow" },
  { title: "Strategy Evolution", accent: "vigil-green" },
];

const FeaturesSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="features" className="relative py-32 px-6" ref={ref}>
      <div className="absolute right-0 top-1/4 w-[400px] h-[400px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, hsl(var(--vigil-glow) / 0.4), transparent 70%)' }} />

      <div className="container mx-auto max-w-6xl relative z-10">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Capabilities</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Built different</h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`group relative rounded-2xl border border-border bg-vigil-surface p-7 transition-all duration-500 hover:border-primary/30 hover:bg-vigil-surface-elevated ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}
              style={{ transitionDelay: `${(i + 1) * 100}ms` }}
            >
              <div className={`w-1.5 h-8 rounded-full mb-5 ${f.accent === 'vigil-green' ? 'bg-vigil-green' : 'bg-primary'}`} />
              <h3 className="text-lg font-semibold">{f.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
