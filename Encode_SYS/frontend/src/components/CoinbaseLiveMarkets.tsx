import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";

const DEFAULT_PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD", "AVAX-USD"] as const;

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  const digits = n >= 1000 ? 2 : n >= 1 ? 2 : 4;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct24h(price: number, open: number) {
  if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(price)) return null;
  return ((price - open) / open) * 100;
}

function shortSymbol(productId: string) {
  return productId.replace("-USD", "");
}

type Props = {
  productIds?: readonly string[];
  /** Wider dashboard layout vs compact landing strip */
  variant?: "full" | "compact";
  className?: string;
};

const CoinbaseLiveMarkets = ({
  productIds = DEFAULT_PRODUCTS,
  variant = "full",
  className,
}: Props) => {
  const ids = useMemo(() => [...productIds], [productIds]);
  const { ticks, status, lastError } = useCoinbaseTicker(ids);

  const idsWithData = useMemo(() => ids.filter((id) => Boolean(ticks[id])), [ids, ticks]);

  const live = status === "live";
  const pending = status === "connecting" || status === "reconnecting";

  return (
    <section
      className={cn(
        "relative rounded-2xl border border-border bg-vigil-surface overflow-hidden",
        variant === "compact" ? "py-0" : "",
        className,
      )}
      aria-label="Coinbase live spot prices"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              live ? "bg-vigil-green animate-pulse" : pending ? "bg-amber-500/80" : "bg-muted-foreground/50",
            )}
          />
          <div className="min-w-0">
            <div className="font-mono text-sm font-medium truncate">Live markets</div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
              Coinbase spot · USD pairs
            </p>
          </div>
        </div>
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {live ? "Exchange feed" : pending ? "Connecting…" : lastError ?? "Offline"}
        </span>
      </div>

      <div className="grid gap-px bg-border grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {idsWithData.length === 0 ? (
          <div className="bg-vigil-surface-elevated px-4 py-8 sm:col-span-2 md:col-span-3 lg:col-span-full">
            <p className="font-mono text-sm text-muted-foreground text-center">
              {pending ? "Waiting for quotes…" : live ? "No data for these pairs yet." : lastError ?? "Feed offline."}
            </p>
          </div>
        ) : (
          idsWithData.map((id) => {
            const t = ticks[id]!;
            const label = shortSymbol(id);
            const change = pct24h(t.price, t.open24h);
            const up = change != null && change >= 0;

            return (
              <div
                key={id}
                className="bg-vigil-surface-elevated px-4 py-4 flex flex-col justify-center min-h-[5.5rem]"
              >
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  {label}
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums tracking-tight">{fmtUsd(t.price)}</div>
                <div
                  className={cn(
                    "font-mono text-xs tabular-nums mt-0.5",
                    change == null ? "text-muted-foreground" : up ? "text-vigil-green" : "text-vigil-red",
                  )}
                >
                  {change == null ? "24h —" : `${up ? "+" : "−"}${Math.abs(change).toFixed(2)}%`}
                </div>
                {variant === "full" && Number.isFinite(t.bestBid) && Number.isFinite(t.bestAsk) ? (
                  <div className="font-mono text-[10px] text-muted-foreground mt-2 tabular-nums">
                    Bid {fmtUsd(t.bestBid)} · Ask {fmtUsd(t.bestAsk)}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default CoinbaseLiveMarkets;
