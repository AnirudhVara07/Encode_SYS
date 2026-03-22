import type { CSSProperties, ReactNode } from "react";

export function FadeIn({
  delay,
  className,
  animation = "fade-in-up",
  children,
}: {
  delay: string;
  className?: string;
  animation?: "fade-in" | "fade-in-up";
  children: ReactNode;
}) {
  const animClass = animation === "fade-in" ? "animate-fade-in" : "animate-fade-in-up";
  const style: CSSProperties = { animationDelay: delay };
  return (
    <div className={`opacity-0 ${animClass} ${className ?? ""}`.trim()} style={style}>
      {children}
    </div>
  );
}
