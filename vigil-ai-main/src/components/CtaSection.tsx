import { useScrollReveal } from "./useScrollReveal";
import VigilEye from "./VigilEye";

const CtaSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="cta" className="relative py-32 px-6" ref={ref}>
      <div className="container mx-auto max-w-3xl text-center">
        <div className={`transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <div className="flex justify-center mb-8">
            <VigilEye size={80} />
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Your strategy deserves<br />
            <span className="text-primary text-glow">to never sleep.</span>
          </h2>

          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Sign in to start building your trading shadow.
          </p>

          <div className="mt-10">
            <button
              onClick={() => {
                // TODO: Implement login/signup flow
                console.log("Login clicked — implement auth here");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-10 py-3.5 text-base font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] box-glow"
            >
              Log In / Sign Up
            </button>
          </div>

          <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Your keys. Your strategy. Your shadow.
          </p>
        </div>
      </div>
    </section>
  );
};

export default CtaSection;
