import { Outlet } from "react-router-dom";
import { VigilAmbientBackground } from "@/components/VigilAmbientBackground";

/** Shared page chrome: base fill + hero-style grid/glow behind all routes. */
export function AppShell() {
  return (
    <div className="relative min-h-dvh bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <VigilAmbientBackground />
      </div>
      <div className="relative z-[1] min-h-dvh">
        <Outlet />
      </div>
    </div>
  );
}
