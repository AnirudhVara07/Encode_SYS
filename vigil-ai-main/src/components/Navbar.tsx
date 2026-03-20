import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") === "dark" ||
        (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    return true;
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  const handleLogin = () => {
    // TODO: Implement login/signup flow
    console.log("Login clicked — implement auth here");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-primary animate-breathe" />
          <span className="text-lg font-semibold tracking-tight">Vigil</span>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="transition-colors hover:text-foreground cursor-pointer">Home</a>
          <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#stack" className="transition-colors hover:text-foreground">Tech</a>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => setDark(!dark)}
            className="rounded-lg p-2.5 text-muted-foreground transition-colors hover:text-foreground active:scale-[0.95]"
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
          >
            Log In
          </button>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-2 rounded-lg border border-foreground/20 bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-foreground/40 active:scale-[0.97]"
          >
            Sign Up
          </button>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden text-foreground p-1" aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M18 6L6 18M6 6l12 12" /> : <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl px-6 py-4 flex flex-col gap-4">
          <a href="#" onClick={(e) => { e.preventDefault(); setOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-sm text-muted-foreground hover:text-foreground cursor-pointer">Home</a>
          <a href="#how-it-works" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#features" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Features</a>
          <a href="#stack" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Tech</a>
          <button onClick={() => setDark(!dark)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button onClick={() => { setOpen(false); handleLogin(); }} className="text-sm text-muted-foreground hover:text-foreground text-left">Log In</button>
          <button onClick={() => { setOpen(false); handleLogin(); }} className="inline-flex items-center justify-center rounded-lg border border-foreground/20 bg-background px-5 py-2.5 text-sm font-medium text-foreground">Sign Up</button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
