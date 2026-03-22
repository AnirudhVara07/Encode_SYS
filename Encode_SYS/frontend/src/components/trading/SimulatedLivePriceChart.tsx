import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTimeGb } from "@/lib/dateFormat";
import { fmtGbpSpot } from "@/lib/formatGbp";

type Point = { t: number; p: number };

const MAX_POINTS = 90;
const TICK_MS = 2800;

type Props = {
  /** When set, simulated path anchors to this mid price (GBP per BTC). */
  liveSpotGbp?: number | null;
  className?: string;
};

/**
 * Motion chart: appends price points on a timer with small random walk,
 * biased toward the live ticker when available. Uses theme tokens for light/dark.
 */
export function SimulatedLivePriceChart({ liveSpotGbp, className }: Props) {
  const [series, setSeries] = useState<Point[]>([]);
  const lastRef = useRef<number | null>(null);
  const liveSpotRef = useRef<number | null>(null);
  const seededFromTickerRef = useRef(false);

  if (liveSpotGbp != null && Number.isFinite(liveSpotGbp) && liveSpotGbp > 0) {
    liveSpotRef.current = liveSpotGbp;
  }

  // First valid ticker price: seed an empty chart, or only attach anchor if we already have synthetic points.
  useEffect(() => {
    if (seededFromTickerRef.current) return;
    const v = liveSpotGbp;
    if (v == null || !Number.isFinite(v) || v <= 0) return;
    seededFromTickerRef.current = true;
    setSeries((prev) => {
      if (prev.length > 0) return prev;
      lastRef.current = v;
      return [{ t: Date.now(), p: v }];
    });
  }, [liveSpotGbp]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeries((prev) => {
        const last = lastRef.current ?? prev[prev.length - 1]?.p ?? 95_000;
        const spot = liveSpotRef.current;
        const anchor = spot != null && Number.isFinite(spot) && spot > 0 ? spot : last;
        const meanRevert = (anchor - last) * 0.08;
        const noise = (Math.random() - 0.5) * Math.max(anchor * 0.00035, 2.5);
        let next = last + meanRevert + noise;
        if (next <= 0) next = last;
        lastRef.current = next;
        const row = { t: Date.now(), p: next };
        const merged = [...prev, row];
        return merged.length > MAX_POINTS ? merged.slice(-MAX_POINTS) : merged;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const current = series.length ? series[series.length - 1]!.p : null;

  const domain = useMemo(() => {
    if (series.length < 2) return undefined;
    const vals = series.map((x) => x.p);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.12, hi * 0.0008, 1);
    return [lo - pad, hi + pad] as [number, number];
  }, [series]);

  return (
    <div
      className={`rounded-xl border border-border bg-card/90 p-4 shadow-sm ring-1 ring-border/40 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Simulated live path</p>
          <p className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground tracking-tight">
            {current != null ? fmtGbpSpot(current) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Updates every few seconds · auto-scroll</p>
        </div>
      </div>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ts) => formatTimeGb(Number(ts))}
              stroke="hsl(var(--border))"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
            />
            <YAxis
              domain={domain ?? ["auto", "auto"]}
              tickFormatter={(v) => fmtGbpSpot(Number(v))}
              stroke="hsl(var(--border))"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              width={72}
              axisLine={{ stroke: "hsl(var(--border))" }}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
                color: "hsl(var(--popover-foreground))",
              }}
              labelFormatter={(ts) => formatTimeGb(Number(ts))}
              formatter={(v: number) => [fmtGbpSpot(v), "Price"]}
            />
            <Line
              type="monotone"
              dataKey="p"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
