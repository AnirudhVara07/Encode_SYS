export type TradingGuardConfig = {
  captcha_required: boolean;
  turnstile_site_key: string;
};

export async function fetchTradingGuard(authHeader: string): Promise<TradingGuardConfig> {
  const r = await fetch("/api/coinbase-live/trading-guard", {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `Trading guard config failed (${r.status})`);
  }
  return r.json() as Promise<TradingGuardConfig>;
}
