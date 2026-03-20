import VigilEye from "./VigilEye";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 overflow-hidden">
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

        <div className="mt-10 flex flex-col sm:flex-row gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '0.9s' }}>
          <button onClick={() => console.log("Login clicked — implement auth here")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-base font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] box-glow">
            Sign Up
          </button>
          <a href="#how-it-works" className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-8 py-3.5 text-base font-medium text-foreground transition-all hover:bg-secondary active:scale-[0.97]">
            See how it works
          </a>
        </div>
      </div>

      {/* Ticker */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border/50 bg-vigil-surface/80 backdrop-blur py-3 overflow-hidden opacity-0 animate-fade-in" style={{ animationDelay: '1.2s' }}>
        <div className="flex animate-ticker whitespace-nowrap">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-8 px-4 font-mono text-xs text-muted-foreground">
              <span>ETH <span className="text-vigil-green">+2.34%</span></span>
              <span>BTC <span className="text-vigil-green">+0.87%</span></span>
              <span>SOL <span className="text-vigil-red">-1.12%</span></span>
              <span>LINK <span className="text-vigil-green">+4.56%</span></span>
              <span>ARB <span className="text-vigil-green">+1.23%</span></span>
              <span>MATIC <span className="text-vigil-red">-0.45%</span></span>
              <span>OP <span className="text-vigil-green">+3.78%</span></span>
              <span>AVAX <span className="text-vigil-green">+1.91%</span></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
