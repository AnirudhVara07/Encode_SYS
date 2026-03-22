export type HeroTickerMeta = {
  productId: string;
  coinName: string;
  symbol: string;
};

/** Always included first on the landing ticker (Coinbase product ids, GBP quote). */
export const HERO_ANCHOR_PAIRS: readonly HeroTickerMeta[] = [
  { productId: "BTC-GBP", coinName: "Bitcoin", symbol: "BTC" },
  { productId: "ETH-GBP", coinName: "Ethereum", symbol: "ETH" },
] as const;

/**
 * Alts eligible for the three rotating slots (positive 24h change preferred, else market-cap order).
 * All ids must exist as online *-GBP products on Coinbase Exchange or the WS subscribe can fail.
 */
export const HERO_ALT_ROTATION_POOL: readonly HeroTickerMeta[] = [
  { productId: "SOL-GBP", coinName: "Solana", symbol: "SOL" },
  { productId: "LINK-GBP", coinName: "Chainlink", symbol: "LINK" },
  { productId: "ADA-GBP", coinName: "Cardano", symbol: "ADA" },
  { productId: "DOT-GBP", coinName: "Polkadot", symbol: "DOT" },
  { productId: "DOGE-GBP", coinName: "Dogecoin", symbol: "DOGE" },
  { productId: "UNI-GBP", coinName: "Uniswap", symbol: "UNI" },
  { productId: "LTC-GBP", coinName: "Litecoin", symbol: "LTC" },
  { productId: "ATOM-GBP", coinName: "Cosmos", symbol: "ATOM" },
  { productId: "AAVE-GBP", coinName: "Aave", symbol: "AAVE" },
  { productId: "ALGO-GBP", coinName: "Algorand", symbol: "ALGO" },
  { productId: "BCH-GBP", coinName: "Bitcoin Cash", symbol: "BCH" },
  { productId: "CRV-GBP", coinName: "Curve", symbol: "CRV" },
  { productId: "ETC-GBP", coinName: "Ethereum Classic", symbol: "ETC" },
  { productId: "FIL-GBP", coinName: "Filecoin", symbol: "FIL" },
  { productId: "GRT-GBP", coinName: "The Graph", symbol: "GRT" },
  { productId: "ICP-GBP", coinName: "Internet Computer", symbol: "ICP" },
  { productId: "MASK-GBP", coinName: "Mask Network", symbol: "MASK" },
  { productId: "SHIB-GBP", coinName: "Shiba Inu", symbol: "SHIB" },
  { productId: "SNX-GBP", coinName: "Synthetix", symbol: "SNX" },
  { productId: "XTZ-GBP", coinName: "Tezos", symbol: "XTZ" },
  { productId: "1INCH-GBP", coinName: "1inch", symbol: "1INCH" },
  { productId: "CHZ-GBP", coinName: "Chiliz", symbol: "CHZ" },
] as const;

/** Rough market-cap priority within `HERO_ALT_ROTATION_POOL` for fallback picks. */
export const HERO_ALT_MARKET_CAP_PRIORITY: readonly string[] = [
  "SOL-GBP",
  "ADA-GBP",
  "DOGE-GBP",
  "LINK-GBP",
  "DOT-GBP",
  "UNI-GBP",
  "LTC-GBP",
  "ATOM-GBP",
  "BCH-GBP",
  "SHIB-GBP",
  "ICP-GBP",
  "AAVE-GBP",
  "ETC-GBP",
  "FIL-GBP",
  "GRT-GBP",
  "ALGO-GBP",
  "MASK-GBP",
  "SNX-GBP",
  "XTZ-GBP",
  "CRV-GBP",
  "CHZ-GBP",
  "1INCH-GBP",
];

const _poolIds = new Set(HERO_ALT_ROTATION_POOL.map((p) => p.productId));
const _priorityFiltered = HERO_ALT_MARKET_CAP_PRIORITY.filter((id) => _poolIds.has(id));

/** All product ids subscribed for the hero bottom ticker. */
export const HERO_TICKER_ALL_PRODUCT_IDS: readonly string[] = [
  ...HERO_ANCHOR_PAIRS.map((p) => p.productId),
  ...HERO_ALT_ROTATION_POOL.map((p) => p.productId),
];

const _metaById: Record<string, HeroTickerMeta> = {};
for (const p of HERO_ANCHOR_PAIRS) _metaById[p.productId] = p;
for (const p of HERO_ALT_ROTATION_POOL) _metaById[p.productId] = p;

export function heroTickerMetaForProduct(productId: string): HeroTickerMeta | undefined {
  return _metaById[productId];
}

export function pctChange24h(price: number | undefined, open24h: number | undefined): number | null {
  if (price == null || open24h == null || open24h === 0) return null;
  return ((price - open24h) / open24h) * 100;
}

export type HeroTickSlice = { price: number; open24h: number };

/**
 * Pick three alt product ids: prefer strictly positive 24h change (strongest first), then market-cap order.
 */
export function pickHeroAltProductIds(ticks: Record<string, HeroTickSlice | undefined>): string[] {
  const scored: { id: string; pct: number }[] = [];
  for (const p of HERO_ALT_ROTATION_POOL) {
    const t = ticks[p.productId];
    if (!t) continue;
    const pct = pctChange24h(t.price, t.open24h);
    if (pct == null || pct <= 0) continue;
    scored.push({ id: p.productId, pct });
  }
  scored.sort((a, b) => b.pct - a.pct);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { id } of scored) {
    if (out.length >= 3) break;
    if (seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }

  for (const id of _priorityFiltered) {
    if (out.length >= 3) break;
    if (seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }

  for (const p of HERO_ALT_ROTATION_POOL) {
    if (out.length >= 3) break;
    if (seen.has(p.productId)) continue;
    out.push(p.productId);
    seen.add(p.productId);
  }

  return out.slice(0, 3);
}
