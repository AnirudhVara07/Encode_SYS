import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { TradingGuardConfig } from "@/lib/tradingGuard";

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement | string, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function ensureTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
      if (existing) {
        if (window.turnstile) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Turnstile script failed")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Turnstile script failed"));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guard: TradingGuardConfig | null;
  onConfirm: (opts: { captchaToken?: string }) => void | Promise<void>;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  /** Replaces the default Civic + Coinbase explanation when set. */
  subcopy?: ReactNode;
  /** Checkbox label when captcha is not configured (acknowledgment only). */
  ackLabel?: string;
};

export function LiveTradingConfirmDialog({
  open,
  onOpenChange,
  guard,
  onConfirm,
  title,
  confirmLabel,
  busy = false,
  subcopy,
  ackLabel = "I understand this will submit real trades on Coinbase using my linked API keys.",
}: Props) {
  const ackId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  const siteKey = guard?.captcha_required ? (guard.turnstile_site_key || "").trim() : "";
  const misconfigured = Boolean(guard?.captcha_required && !siteKey);
  const needsCaptcha = Boolean(guard?.captcha_required && siteKey);
  const needsAck = Boolean(guard && !guard.captcha_required);
  const guardReady = guard !== null;

  const resetLocal = useCallback(() => {
    setCaptchaToken(null);
    setAck(false);
    const w = widgetIdRef.current;
    widgetIdRef.current = null;
    if (w && window.turnstile) {
      try {
        window.turnstile.remove(w);
      } catch {
        /* ignore */
      }
    }
    hostRef.current?.replaceChildren();
  }, []);

  useEffect(() => {
    if (!open) {
      resetLocal();
      return;
    }
    if (!needsCaptcha || !siteKey) return;

    let cancelled = false;
    const el = hostRef.current;
    if (!el) return;

    void (async () => {
      try {
        await ensureTurnstileScript();
      } catch {
        return;
      }
      if (cancelled || !el || !window.turnstile) return;
      try {
        const id = window.turnstile.render(el, {
          sitekey: siteKey,
          callback: (token: string) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(null),
          "error-callback": () => setCaptchaToken(null),
          theme: "auto",
        });
        widgetIdRef.current = id;
      } catch {
        setCaptchaToken(null);
      }
    })();

    return () => {
      cancelled = true;
      const w = widgetIdRef.current;
      widgetIdRef.current = null;
      if (w && window.turnstile) {
        try {
          window.turnstile.remove(w);
        } catch {
          /* ignore */
        }
      }
      el.replaceChildren();
      setCaptchaToken(null);
    };
  }, [open, needsCaptcha, siteKey, resetLocal]);

  const canConfirm =
    guardReady &&
    !misconfigured &&
    !busy &&
    (needsCaptcha ? Boolean(captchaToken) : needsAck ? ack : true);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    await onConfirm({ captchaToken: captchaToken || undefined });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-semibold tracking-tight text-foreground">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-base leading-relaxed text-muted-foreground">
              {subcopy ?? (
                <p>
                  You are signed in with Civic. Complete the check below so we know a person is confirming — then we will
                  place real Coinbase orders under your linked keys.
                </p>
              )}
              {!guardReady ? (
                <p className="text-xs font-mono text-muted-foreground">Loading verification options…</p>
              ) : null}
              {misconfigured ? (
                <p className="text-destructive font-medium">
                  Live trading captcha is enabled on the server but <code className="text-xs">TURNSTILE_SITE_KEY</code>{" "}
                  is missing. Set both site and secret keys in backend <code className="text-xs">.env</code>.
                </p>
              ) : null}
              {needsCaptcha ? (
                <div className="flex min-h-[72px] items-center justify-center rounded-md border border-border/80 bg-muted/30 p-2">
                  <div ref={hostRef} className="min-h-[65px]" />
                </div>
              ) : needsAck ? (
                <div className="flex items-start gap-3 rounded-md border border-border/80 bg-muted/20 p-3">
                  <Checkbox id={ackId} checked={ack} onCheckedChange={(v) => setAck(v === true)} disabled={busy} />
                  <Label htmlFor={ackId} className="text-sm font-normal leading-snug cursor-pointer">
                    {ackLabel}
                  </Label>
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={!canConfirm} onClick={() => void handleConfirm()}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
