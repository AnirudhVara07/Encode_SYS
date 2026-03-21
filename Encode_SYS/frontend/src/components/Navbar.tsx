import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sun, Moon, User } from "lucide-react";
import { startCivicLogin } from "@/lib/civicOAuth";
import { useVigilUser } from "@/context/VigilUserContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Navbar = () => {
  const navigate = useNavigate();
  const { bearer, setBearer } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openAccountMenu = useCallback(() => {
    if (accountCloseTimer.current) {
      window.clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    setAccountOpen(true);
  }, []);

  const scheduleCloseAccountMenu = useCallback(() => {
    if (accountCloseTimer.current) window.clearTimeout(accountCloseTimer.current);
    accountCloseTimer.current = window.setTimeout(() => setAccountOpen(false), 160);
  }, []);

  useEffect(() => {
    return () => {
      if (accountCloseTimer.current) window.clearTimeout(accountCloseTimer.current);
    };
  }, []);
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
    setOpen(false);
    void (async () => {
      try {
        await startCivicLogin();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Could not start Civic login. Is the backend running?");
      }
    })();
  };

  const handleLogout = () => {
    setBearer("");
    setAccountOpen(false);
    setOpen(false);
    navigate("/", { replace: true });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center gap-3 px-6 py-4 min-w-0">
        <div className="flex flex-1 min-w-0 justify-start items-center gap-2 sm:gap-3">
          <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-90 shrink-0">
            <img
              src="/vigil-logo.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-primary/20"
              decoding="async"
            />
            <span className="text-lg font-semibold tracking-tight">Vigil</span>
          </Link>
        </div>

        <div className="flex items-center justify-center gap-3 sm:gap-8 text-xs sm:text-sm text-muted-foreground shrink-0 whitespace-nowrap">
          <Link to="/dashboard" className="transition-colors hover:text-foreground">
            Paper trade
          </Link>
          <Link to="/demo" className="transition-colors hover:text-foreground">
            Use Vigil
          </Link>
        </div>

        <div className="flex flex-1 min-w-0 justify-end items-center gap-3">
          <div className="hidden md:flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setDark(!dark)}
              className="rounded-lg p-2.5 text-muted-foreground transition-colors hover:text-foreground active:scale-[0.95]"
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {loggedIn ? (
              <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen} modal={false}>
                <div
                  className="relative flex"
                  onPointerEnter={openAccountMenu}
                  onPointerLeave={scheduleCloseAccountMenu}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Account menu"
                      aria-haspopup="menu"
                      aria-expanded={accountOpen}
                    >
                      <User className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </DropdownMenuTrigger>
                </div>
                <DropdownMenuContent
                  className="w-40"
                  align="end"
                  side="bottom"
                  sideOffset={4}
                  onPointerEnter={openAccountMenu}
                  onPointerLeave={scheduleCloseAccountMenu}
                >
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => handleLogout()}>
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {!loggedIn ? (
              <>
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
              </>
            ) : null}
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="md:hidden shrink-0 text-foreground p-1"
            aria-label="Menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M18 6L6 18M6 6l12 12" /> : <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl px-6 py-4 flex flex-col gap-4">
          <button onClick={() => setDark(!dark)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          {loggedIn ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                handleLogout();
              }}
              className="text-sm text-muted-foreground hover:text-foreground text-left"
            >
              Log out
            </button>
          ) : (
            <>
              <button onClick={() => { setOpen(false); handleLogin(); }} className="text-sm text-muted-foreground hover:text-foreground text-left">Log In</button>
              <button onClick={() => { setOpen(false); handleLogin(); }} className="inline-flex items-center justify-center rounded-lg border border-foreground/20 bg-background px-5 py-2.5 text-sm font-medium text-foreground">Sign Up</button>
            </>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
