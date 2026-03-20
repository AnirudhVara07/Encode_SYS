import { useScrollReveal } from "./useScrollReveal";

const steps = [
  {
    num: "01",
    title: "Trade like you always do",
    detail: "Pattern Recognition Active",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="16" cy="16" r="12" />
        <circle cx="16" cy="16" r="4" fill="currentColor" opacity="0.3" />
        <line x1="16" y1="4" x2="16" y2="8" /><line x1="16" y1="24" x2="16" y2="28" />
        <line x1="4" y1="16" x2="8" y2="16" /><line x1="24" y1="16" x2="28" y2="16" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "Set your guardrails, then rest",
    detail: "Guardrails Engaged",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="6" y="10" width="20" height="14" rx="3" />
        <path d="M11 10V7a5 5 0 0 1 10 0v3" />
        <circle cx="16" cy="18" r="2" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Vigil mirrors your strategy",
    detail: "Autonomous Mode",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 16h4l3-8 4 16 3-8h4" />
      </svg>
    ),
  },
  {
    num: "04",
    title: "Wake up smarter",
    detail: "Feedback Loop Active",
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 24V12l10-6 10 6v12l-10 6z" />
        <path d="M16 18v-4" /><circle cx="16" cy="21" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

const HowItWorks = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="how-it-works" className="relative py-32 px-6" ref={ref}>
      <div className="container mx-auto max-w-5xl">
        <div className={`text-center mb-20 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">The Loop</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">
            Not replacing you.<br />
            <span className="text-muted-foreground">Extending you.</span>
          </h2>
        </div>

        <div className="relative">
          <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border to-transparent hidden md:block" />

          <div className="space-y-12">
            {steps.map((step, i) => (
              <div
                key={step.num}
                className={`relative flex flex-col md:flex-row gap-6 md:gap-12 items-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}
                style={{ transitionDelay: `${(i + 1) * 150}ms` }}
              >
                <div className="relative flex-shrink-0 w-16 h-16 rounded-2xl bg-vigil-surface-elevated border border-border flex items-center justify-center text-primary">
                  {step.icon}
                  <div className="absolute -left-[4.5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary hidden md:block" style={{ left: '-21px' }} />
                </div>

                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-primary">{step.num}</span>
                  <h3 className="text-xl sm:text-2xl font-semibold">{step.title}</h3>
                  <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground px-2 py-0.5 rounded-full border border-border hidden sm:inline">{step.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
