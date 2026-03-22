import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { startCivicLogin } from "@/lib/civicOAuth";
import { cn } from "@/lib/utils";

type VigilAccessGateProps = {
  title: string;
  description: string;
  /** Where to send the user after successful Civic OAuth (internal path only). */
  returnTo: string;
  className?: string;
  /** Chat panel: tighter card; full page: centered default width. */
  variant?: "page" | "panel";
};

export function VigilAccessGate({ title, description, returnTo, className, variant = "page" }: VigilAccessGateProps) {
  const navigate = useNavigate();

  const goCivic = () => {
    void startCivicLogin({ returnTo }).catch((e) =>
      window.alert(e instanceof Error ? e.message : "Could not start Civic login. Is the backend running?"),
    );
  };

  return (
    <Card
      className={cn(
        variant === "page" && "mx-auto w-full max-w-md border-primary/15 shadow-lg",
        variant === "panel" && "border-border/80 bg-muted/20 shadow-none",
        className,
      )}
    >
      <CardHeader className={cn(variant === "panel" && "space-y-1 px-4 py-3")}>
        <CardTitle className={cn(variant === "panel" && "text-base")}>{title}</CardTitle>
        <CardDescription className={cn(variant === "panel" && "text-xs leading-relaxed")}>{description}</CardDescription>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-3", variant === "panel" && "px-4 pb-4 pt-0")}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size={variant === "panel" ? "sm" : "default"} onClick={goCivic}>
            Log in
          </Button>
          <Button type="button" size={variant === "panel" ? "sm" : "default"} variant="outline" onClick={goCivic}>
            Sign up
          </Button>
        </div>
        <Button type="button" size={variant === "panel" ? "sm" : "default"} variant="secondary" onClick={() => navigate("/premium")}>
          We need Premium
        </Button>
      </CardContent>
    </Card>
  );
}
