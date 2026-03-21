/** Spot pairs for the hero footer ticker (Coinbase Exchange product IDs). */
export const HERO_TICKER_PAIRS = [
  { productId: "ETH-USD", label: "ETH" },
  { productId: "BTC-USD", label: "BTC" },
  { productId: "SOL-USD", label: "SOL" },
  { productId: "LINK-USD", label: "LINK" },
  { productId: "ARB-USD", label: "ARB" },
  { productId: "MATIC-USD", label: "MATIC" },
  { productId: "OP-USD", label: "OP" },
  { productId: "AVAX-USD", label: "AVAX" },
] as const;

export function pctChange24h(price: number, open24h: number): number | null {
  if (!Number.isFinite(open24h) || open24h <= 0 || !Number.isFinite(price)) return null;
  return ((price - open24h) / open24h) * 100;
}
