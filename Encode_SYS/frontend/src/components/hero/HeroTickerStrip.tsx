import { useEffect, useMemo, useRef, useState } from "react";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import {
  HERO_ALT_ROTATION_POOL,
  HERO_ANCHOR_PAIRS,
  HERO_TICKER_ALL_PRODUCT_IDS,
  heroTickerMetaForProduct,
  pctChange24h,
  pickHeroAltProductIds,
} from "@/lib/coinbaseTickerItems";

const STRIP_COUNT = 8;
const CONNECTING_MSG = "Connecting to exchange…";

function TickerCell({
  symbol,
  tick,
}: {
  symbol: string;
  tick: { price: string; open24h: string } | undefined;
}) {
  const pct = tick ? pctChange24h(tick.price, tick.open24h) : null;
  const up = pct != null && pct >= 0;
  return (
    <span className="inline-flex shrink-0 items-baseline gap-2 tabular-nums">
      <span className="font-semibold text-foreground">{symbol}</span>
      {pct == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={up ? "text-vigil-green" : "text-vigil-red"}>
          {up ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export function HeroTickerStrip() {
  const { ticks, status } = useCoinbaseTicker(HERO_TICKER_ALL_PRODUCT_IDS);

  const positiveSetKey = useMemo(() => {
    const ids: string[] = [];
    for (const p of HERO_ALT_ROTATION_POOL) {
      const t = ticks[p.productId];
      const pct = t ? pctChange24h(t.price, t.open24h) : null;
      if (pct != null && pct > 0) ids.push(p.productId);
    }
    ids.sort();
    return ids.join(",");
  }, [ticks]);

  const lastKeyRef = useRef<string | null>(null);
  const [altIds, setAltIds] = useState<string[]>(() => pickHeroAltProductIds({}));

  useEffect(() => {
    if (lastKeyRef.current === positiveSetKey) return;
    lastKeyRef.current = positiveSetKey;
    setAltIds(pickHeroAltProductIds(ticks));
  }, [positiveSetKey, ticks]);

  const stripMetas = useMemo(() => {
    const row: NonNullable<ReturnType<typeof heroTickerMetaForProduct>>[] = [];
    for (const p of HERO_ANCHOR_PAIRS) row.push(p);
    for (const id of altIds) {
      const m = heroTickerMetaForProduct(id);
      if (m) row.push(m);
    }
    return row;
  }, [altIds]);

  const showGlobalMsg = stripMetas.every((p) => !ticks[p.productId]) && status !== "live";

  if (showGlobalMsg) {
    return (
      <>
        {Array.from({ length: STRIP_COUNT }, (_, i) => (
          <div key={i} className="flex shrink-0 items-center font-mono text-xs text-muted-foreground">
            <div className="flex gap-6 pr-8">
              <span>{CONNECTING_MSG}</span>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: STRIP_COUNT }, (_, stripIndex) => (
        <div key={stripIndex} className="flex shrink-0 items-center gap-8 pr-10 font-mono text-sm">
          {stripMetas.map(({ productId, symbol }) => (
            <TickerCell key={`${stripIndex}-${productId}`} symbol={symbol} tick={ticks[productId]} />
          ))}
        </div>
      ))}
    </>
  );
}
