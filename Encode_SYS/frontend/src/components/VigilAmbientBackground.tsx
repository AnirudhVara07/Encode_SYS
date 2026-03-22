/** Site-wide grid + soft glow (matches hero); render inside a `relative` ancestor with `overflow-hidden`. */
export function VigilAmbientBackground() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-[22vh] left-1/2 h-[min(600px,90vw)] w-[min(600px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18]"
        style={{
          background: "radial-gradient(circle, hsl(var(--vigil-glow) / 0.3), transparent 70%)",
        }}
        aria-hidden
      />
    </>
  );
}
