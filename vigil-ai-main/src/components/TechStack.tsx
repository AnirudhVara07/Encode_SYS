import { useScrollReveal } from "./useScrollReveal";

const TechStack = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="stack" className="relative py-32 px-6" ref={ref}>
      <div className="container mx-auto max-w-4xl">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Under the Hood</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Built on trust</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          {[
            { name: "Base", via: "Coinbase AgentKit", color: "bg-[hsl(220,70%,55%)]" },
            { name: "Civic", via: "Identity & Guardrails", color: "bg-vigil-green" },
          ].map((tech, i) => (
            <div
              key={tech.name}
              className={`rounded-2xl border border-border bg-vigil-surface p-8 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}
              style={{ transitionDelay: `${(i + 1) * 150}ms` }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-3 h-3 rounded-full ${tech.color}`} />
                <span className="text-xl font-semibold">{tech.name}</span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{tech.via}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TechStack;
