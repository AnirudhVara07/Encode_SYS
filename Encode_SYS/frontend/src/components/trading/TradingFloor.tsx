import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import { pctChange24h } from "@/lib/coinbaseTickerItems";
import { formatDateTimeGb, formatTimeGb } from "@/lib/dateFormat";
import { fmtGbp, fmtGbpAxis0, fmtGbpSpot } from "@/lib/formatGbp";
import { cn } from "@/lib/utils";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PaperSnapshot = {
  started?: boolean;
  usd_cash?: number;
  btc_balance?: number;
  last_btc_price_usd?: number;
  usd_equity_mark?: number;
};

type CandleBar = {
  start?: number;
  close?: number;
};

type VigilTickPayload = {
  t?: number;
  action?: string;
  buy_edges?: number;
  sell_edges?: number;
  per_strategy?: Array<{
    id?: string;
    name?: string;
    signal?: string | null;
    diagnostics?: Record<string, number> | null;
    params?: Record<string, number | string>;
    error?: string | null;
  }>;
  trade_error?: string | null;
  order_routing?: string;
  rule_code?: string | null;
  guardrail_message?: string | null;
};

type Props = {
  paper: PaperSnapshot | null;
  onRefreshPaper: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  /** Coinbase product id for spot ticker + price chart (e.g. BTC-GBP). */
  spotProductId?: string;
  /** Lifted for Agent Guardrails demo panel on Dashboard (same SSE stream). */
  paperKillSwitch: boolean;
  setPaperKillSwitch: Dispatch<SetStateAction<boolean>>;
  guardrailsNonce: number;
  setGuardrailsNonce: Dispatch<SetStateAction<number>>;
};

const fmtNum = (n: unknown) => {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const PRICE_CHART_REFRESH_MS = 60_000;

export function TradingFloor({
  paper,
  onRefreshPaper,
  busy,
  setBusy,
  spotProductId = "BTC-GBP",
  paperKillSwitch,
  setPaperKillSwitch,
  guardrailsNonce,
  setGuardrailsNonce,
}: Props) {
  const [feedLines, setFeedLines] = useState<string[]>([]);
  const [lastTick, setLastTick] = useState<VigilTickPayload | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [priceCandles, setPriceCandles] = useState<CandleBar[]>([]);

  const productIds = useMemo(() => [spotProductId], [spotProductId]);
  const { ticks } = useCoinbaseTicker(productIds);
  const spot = ticks[spotProductId];

  const syncAutopilotUi = useCallback(async () => {
    try {
      const r = await fetch("/api/paper/autopilot");
      if (!r.ok) return;
      const ap = (await r.json()) as {
        running?: boolean;
        kill_switch?: boolean;
        last_tick_diagnostics?: VigilTickPayload;
      };
      setPaperKillSwitch(Boolean(ap.kill_switch));
      setAutoRunning(Boolean(ap.running));
      if (ap.last_tick_diagnostics) setLastTick(ap.last_tick_diagnostics);
    } catch {
      /* ignore */
    }
  }, [setPaperKillSwitch]);

  useEffect(() => {
    const es = new EventSource("/api/paper/events");
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { event?: string; data?: unknown };
        const evName = parsed.event;
        const data = parsed.data as Record<string, unknown> | undefined;
        if (evName === "snapshot" && data) {
          setPaperKillSwitch(Boolean(data.kill_switch));
          const ap = data.autopilot as { running?: boolean; last_tick_diagnostics?: VigilTickPayload } | undefined;
          setAutoRunning(Boolean(ap?.running));
          if (ap?.last_tick_diagnostics) setLastTick(ap.last_tick_diagnostics);
        }
        if (evName === "vigil_tick" && data) {
          const tick = data as VigilTickPayload;
          setLastTick(tick);
          const tsSec = tick.t ?? Date.now() / 1000;
          const rc = tick.rule_code ? ` · ${tick.rule_code}` : "";
          const line = `${formatTimeGb(tsSec * 1000)} · ${tick.action ?? "-"}${rc}`;
          setFeedLines((prev) => [line, ...prev].slice(0, 50));
          setGuardrailsNonce((n) => n + 1);
          void onRefreshPaper();
        }
        if (evName === "trading_halt") {
          setPaperKillSwitch(true);
          setAutoRunning(false);
          setFeedLines((prev) => [`${formatTimeGb(Date.now())} · Paper trades blocked`, ...prev].slice(0, 50));
        }
        if (evName === "trading_resume") {
          setPaperKillSwitch(false);
          setFeedLines((prev) => [`${formatTimeGb(Date.now())} · Paper trades allowed`, ...prev].slice(0, 50));
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [onRefreshPaper, setPaperKillSwitch, setGuardrailsNonce]);

  useEffect(() => {
    void syncAutopilotUi();
  }, [syncAutopilotUi]);

  useEffect(() => {
    let cancelled = false;
    const loadCandles = async () => {
      try {
        const q = new URLSearchParams({
          product_id: spotProductId,
          granularity: "ONE_HOUR",
          limit: "24",
        });
        const r = await fetch(`/api/paper/market/candles?${q.toString()}`);
        if (!r.ok || cancelled) return;
        const body = (await r.json()) as { candles?: CandleBar[] };
        const list = Array.isArray(body.candles) ? body.candles : [];
        if (!cancelled) setPriceCandles(list);
      } catch {
        if (!cancelled) setPriceCandles([]);
      }
    };
    void loadCandles();
    const t = setInterval(() => void loadCandles(), PRICE_CHART_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [spotProductId]);

  const postJson = async (path: string) => {
    setBusy(true);
    try {
      const r = await fetch(path, { method: "POST" });
      await r.json().catch(() => ({}));
      await onRefreshPaper();
      await syncAutopilotUi();
    } finally {
      setBusy(false);
    }
  };

  const priceChartData = useMemo(
    () =>
      priceCandles
        .map((c) => {
          const t = Number(c.start);
          const price = Number(c.close);
          if (!Number.isFinite(t) || !Number.isFinite(price)) return null;
          return { t: t * 1000, price };
        })
        .filter((row): row is { t: number; price: number } => row != null)
        .sort((a, b) => a.t - b.t),
    [priceCandles],
  );

  const pctTicker = pctChange24h(spot?.price, spot?.open24h);
  const pctFromBars =
    priceChartData.length >= 2
      ? ((priceChartData[priceChartData.length - 1].price - priceChartData[0].price) / priceChartData[0].price) * 100
      : null;
  const pct24 = pctTicker ?? (pctFromBars != null && Number.isFinite(pctFromBars) ? pctFromBars : null);

  const priceLineStroke =
    pct24 == null || Number.isNaN(pct24)
      ? "hsl(var(--muted-foreground))"
      : pct24 > 0
        ? "hsl(var(--vigil-green))"
        : pct24 < 0
          ? "hsl(var(--destructive))"
          : "hsl(var(--muted-foreground))";

  const started = Boolean(paper?.started);

  return (
    <Card className="border-primary/25 bg-card/80">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Paper trading floor</CardTitle>
            <CardDescription className="mt-2 max-w-2xl text-base leading-relaxed">
              <strong>Step 3:</strong> live {spotProductId} ticker and 24h price chart, paper balances, block / automation
              controls, tick diagnostics, and activity log. Configure templates and Paper Vigil in{" "}
              <strong>step 2 · 2C</strong> on this page.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wide",
                paperKillSwitch
                  ? "border-destructive/60 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              {paperKillSwitch ? "Paper blocked" : "Paper allowed"}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wide",
                autoRunning ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {autoRunning ? "Automation on" : "Automation off"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void postJson("/api/paper/halt")}>
            Block Paper trade and auto.
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void postJson("/api/paper/resume")}>
            Allow Paper trade no auto.
          </Button>
          <Button
            type="button"
            disabled={busy || !started || autoRunning || paperKillSwitch}
            onClick={() => void postJson("/api/paper/autopilot/start")}
          >
            Start automation
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !autoRunning}
            onClick={() => void postJson("/api/paper/autopilot/stop")}
          >
            Stop automation
          </Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          <div className="space-y-3 min-w-0 rounded-lg border border-border p-5 bg-background/50">
            <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
              {spotProductId}
            </h3>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 font-mono text-sm">
              <div>
                <span className="text-muted-foreground text-xs block">Exchange ticker</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight">
                  {spot?.price != null ? fmtGbpSpot(spot.price) : "—"}
                </span>
              </div>
              {pct24 != null ? (
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    pct24 > 0
                      ? "text-vigil-green"
                      : pct24 < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                  aria-label={`24 hour change ${pct24 >= 0 ? "up" : "down"} ${Math.abs(pct24).toFixed(2)} percent`}
                >
                  {pct24 > 0 ? "+" : ""}
                  {pct24.toFixed(2)}% <span className="text-muted-foreground font-normal font-mono">24h</span>
                </span>
              ) : null}
            </div>
            <div className="h-[168px] w-full pt-1">
              {priceChartData.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={priceChartData} margin={{ top: 4, right: 12, left: 4, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(ts) => formatTimeGb(Number(ts))}
                      className="text-[10px]"
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                      padding={{ left: 12, right: 12 }}
                    />
                    <YAxis
                      className="text-[10px]"
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => fmtGbpAxis0(Number(v))}
                      width={56}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                    />
                    <Tooltip
                      labelFormatter={(ts) => formatDateTimeGb(Number(ts))}
                      formatter={(v: number) => [fmtGbpSpot(v), "Price"]}
                    />
                    <Line type="monotone" dataKey="price" stroke={priceLineStroke} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div
                  className="flex h-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/15 px-3 py-4 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <span className="text-xs font-medium text-foreground">Loading price history</span>
                  <span className="text-[11px] text-muted-foreground">Coinbase candles will plot here shortly.</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
              Balances
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm font-mono">
              <div>
                <span className="text-muted-foreground text-xs block">GBP cash</span>
                {fmtGbp(paper?.usd_cash)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">BTC</span>
                {paper?.btc_balance != null ? Number(paper.btc_balance).toFixed(8) : "-"}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Equity</span>
                {fmtGbp(paper?.usd_equity_mark)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Mark (book)</span>
                {paper?.last_btc_price_usd != null ? fmtGbpSpot(paper.last_btc_price_usd) : "-"}
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
              Latest automation tick
            </h3>
            {lastTick ? (
              <div className="space-y-2 text-xs font-mono rounded-lg border border-border p-3 bg-background/60">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Action:{" "}
                    <span
                      className={cn(
                        "font-semibold",
                        lastTick.action === "buy"
                          ? "text-vigil-green"
                          : lastTick.action === "sell"
                            ? "text-vigil-amber"
                            : lastTick.action === "blocked" || lastTick.action === "order_failed"
                              ? "text-destructive"
                              : "text-foreground",
                      )}
                      aria-label={
                        lastTick.action
                          ? `Automation action ${lastTick.action}`
                          : "Automation action unknown"
                      }
                    >
                      {lastTick.action ?? "-"}
                    </span>
                  </span>
                  <span>Buy edges: {lastTick.buy_edges ?? "-"}</span>
                  <span>Sell edges: {lastTick.sell_edges ?? "-"}</span>
                  <span>Route: {lastTick.order_routing ?? "-"}</span>
                  {lastTick.rule_code ? <span className="text-destructive">Rule: {lastTick.rule_code}</span> : null}
                </div>
                {lastTick.guardrail_message ? (
                  <p className="text-destructive/90 text-[11px] break-words">{lastTick.guardrail_message}</p>
                ) : null}
                {lastTick.trade_error ? (
                  <p className="text-destructive break-words">{String(lastTick.trade_error)}</p>
                ) : null}
                <div className="space-y-3 max-h-[200px] overflow-y-auto">
                  {(lastTick.per_strategy ?? []).map((row) => (
                    <div key={row.id ?? row.name} className="border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
                      <div className="font-medium text-foreground">{row.name ?? row.id}</div>
                      <div className="text-muted-foreground">
                        Signal:{" "}
                        <span
                          className={cn(
                            "font-semibold",
                            row.signal === "BUY"
                              ? "text-vigil-green"
                              : row.signal === "SELL"
                                ? "text-vigil-amber"
                                : "text-foreground",
                          )}
                          aria-label={
                            row.signal
                              ? `Strategy signal ${row.signal}`
                              : row.error
                                ? `Strategy error ${row.error}`
                                : "No strategy signal"
                          }
                        >
                          {row.signal ?? row.error ?? "-"}
                        </span>
                      </div>
                      {row.params ? (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Params: {JSON.stringify(row.params)}
                        </div>
                      ) : null}
                      {row.diagnostics ? (
                        <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 text-[10px]">
                          {Object.entries(row.diagnostics).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-muted-foreground truncate">{k}</dt>
                              <dd>{fmtNum(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div
                className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-5 text-center"
                role="status"
                aria-live="polite"
              >
                <p className="text-sm font-medium text-foreground">Waiting for automation stream</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect Paper Vigil or start automation to see tick diagnostics.
                </p>
              </div>
            )}

            <Separator />

            <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">Activity</h3>
            <ul className="text-xs font-mono space-y-1 max-h-[140px] overflow-y-auto rounded-md border border-border p-2 bg-background/40">
              {feedLines.length === 0 ? (
                <li className="text-muted-foreground" role="status">
                  No events yet — ticks append here when automation runs.
                </li>
              ) : (
                feedLines.map((l, i) => (
                  <li key={`${i}-${l}`} className="truncate">
                    {l}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
