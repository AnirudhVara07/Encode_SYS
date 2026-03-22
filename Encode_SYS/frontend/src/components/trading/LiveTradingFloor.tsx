import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import { formatDateGb, formatDateTimeGb, formatTimeGb } from "@/lib/dateFormat";
import { fmtGbp, fmtGbpSpot } from "@/lib/formatGbp";
import { cn } from "@/lib/utils";
import { GuardrailsPanel } from "@/components/trading/GuardrailsPanel";
import { SimulatedLivePriceChart } from "@/components/trading/SimulatedLivePriceChart";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
    params?: Record<string, number>;
    error?: string | null;
  }>;
  trade_error?: string | null;
  product_id?: string;
  data_source?: string;
  rule_code?: string | null;
  guardrail_message?: string | null;
};

type Props = {
  bearer: string;
  running: boolean;
  fills: Array<Record<string, unknown>>;
  onRefresh: () => Promise<void>;
  onStop: () => Promise<void>;
};

const fmtNum = (n: unknown) => {
  if (n == null || typeof n !== "number" || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

export function LiveTradingFloor({ bearer, running, fills, onRefresh, onStop }: Props) {
  const [feedLines, setFeedLines] = useState<string[]>([]);
  const [lastTick, setLastTick] = useState<VigilTickPayload | null>(null);
  const [killSwitch, setKillSwitch] = useState(false);
  const [clearingKillSwitch, setClearingKillSwitch] = useState(false);
  const [guardrailsNonce, setGuardrailsNonce] = useState(0);

  const { ticks } = useCoinbaseTicker(["BTC-GBP"] as const);
  const spot = ticks["BTC-GBP"];

  const headers = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };

  const guardrailsHeaders = useMemo(() => ({ Authorization: `Bearer ${bearer}` }), [bearer]);

  // Fetch initial kill-switch state
  const fetchKillSwitch = useCallback(async () => {
    try {
      const r = await fetch("/api/coinbase-live/kill-switch", { headers: { Authorization: `Bearer ${bearer}` } });
      if (!r.ok) return;
      const d = await r.json();
      setKillSwitch(Boolean(d.kill_switch));
    } catch {
      /* ignore */
    }
  }, [bearer]);

  const clearKillSwitch = async () => {
    setClearingKillSwitch(true);
    try {
      const r = await fetch("/api/coinbase-live/kill-switch/clear", { method: "POST", headers });
      if (!r.ok) return;
      const d = await r.json();
      setKillSwitch(Boolean(d.kill_switch));
    } catch {
      /* ignore */
    } finally {
      setClearingKillSwitch(false);
    }
  };

  // SSE stream for live tick events
  useEffect(() => {
    if (!bearer) return;
    let es: EventSource | null = null;

    const connect = () => {
      // SSE with auth: pass token as query param since EventSource doesn't support headers
      es = new EventSource(`/api/coinbase-live/events?token=${encodeURIComponent(bearer)}`);
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as { event?: string; data?: unknown };
          const evName = parsed.event;
          const data = parsed.data as Record<string, unknown> | undefined;

          if (evName === "snapshot" && data) {
            setKillSwitch(Boolean(data.kill_switch));
            const ap = data.autopilot as { last_tick_diagnostics?: VigilTickPayload } | undefined;
            if (ap?.last_tick_diagnostics) setLastTick(ap.last_tick_diagnostics);
          }

          if (evName === "vigil_tick" && data) {
            const tick = data as VigilTickPayload;
            setLastTick(tick);
            const tsSec = tick.t ?? Date.now() / 1000;
            const actionLabel = tick.action ?? "-";
            const rc = tick.rule_code ? ` · ${tick.rule_code}` : "";
            const line = `${formatTimeGb(tsSec * 1000)} · ${actionLabel}${rc}`;
            setFeedLines((prev) => [line, ...prev].slice(0, 50));
            setGuardrailsNonce((n) => n + 1);
            void onRefresh();
          }

          if (evName === "kill_switch_cleared") {
            setKillSwitch(false);
            setFeedLines((prev) => [`${formatTimeGb(Date.now())} · Kill switch cleared`, ...prev].slice(0, 50));
          }
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    void fetchKillSwitch();

    return () => {
      es?.close();
    };
  }, [bearer, fetchKillSwitch, onRefresh]);

  const fNum = (f: Record<string, unknown>, key: string) => {
    const v = f[key];
    return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
  };
  const fStr = (f: Record<string, unknown>, key: string) => {
    const v = f[key];
    return v != null ? String(v) : undefined;
  };

  // Build a cumulative fills chart: each fill plotted as running GBP spent (buys) or received (sells)
  const fillsChartData = (() => {
    const sorted = [...fills]
      .filter((f) => fNum(f, "ts") != null)
      .sort((a, b) => (fNum(a, "ts") ?? 0) - (fNum(b, "ts") ?? 0));
    let runningNet = 0;
    return sorted.map((f) => {
      const usd = fNum(f, "usd") ?? 0;
      const side = fStr(f, "side");
      if (side === "buy") runningNet += usd;
      else if (side === "sell") runningNet -= usd;
      return { t: (fNum(f, "ts") ?? 0) * 1000, eq: runningNet };
    });
  })();

  return (
    <Card className="border-primary/25 bg-card/80">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Live trading floor</CardTitle>
            <CardDescription className="mt-2 max-w-2xl text-base leading-relaxed">
              Real-time BTC-GBP ticker, kill-switch controls, Vigil tick diagnostics, activity log, and fills history.
              Orders execute directly on Coinbase via your linked API key.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wide",
                killSwitch
                  ? "border-destructive/60 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              {killSwitch ? "Kill switch ON" : "Kill switch off"}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wide",
                running ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {running ? "Vigil running" : "Vigil stopped"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SimulatedLivePriceChart
          liveSpotGbp={spot?.price != null && Number.isFinite(Number(spot.price)) ? Number(spot.price) : null}
        />

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          {killSwitch && (
            <Button
              type="button"
              variant="outline"
              disabled={clearingKillSwitch}
              onClick={() => void clearKillSwitch()}
            >
              Clear kill switch
            </Button>
          )}
          {running && (
            <Button type="button" variant="destructive" onClick={() => void onStop()}>
              Stop live Vigil
            </Button>
          )}
        </div>

        {killSwitch && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <strong>Kill switch is ON</strong> — all trades are blocked. Clear it above to allow Vigil to place orders.
          </div>
        )}

        <div className="space-y-3 min-w-0 rounded-lg border border-border p-5 bg-background/50">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-widest text-muted-foreground">BTC-GBP</h3>
          <div className="font-mono text-sm">
            <span className="text-muted-foreground text-xs block">Exchange ticker</span>
            <span className="text-2xl font-semibold tabular-nums tracking-tight">
              {spot?.price != null ? fmtGbpSpot(spot.price) : "—"}
            </span>
          </div>
        </div>

        {/* Latest tick diagnostics */}
        <div className="space-y-2">
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
                {lastTick.product_id ? <span>Pair: {lastTick.product_id}</span> : null}
                {lastTick.rule_code ? <span className="text-destructive">Rule: {lastTick.rule_code}</span> : null}
              </div>
              {lastTick.data_source ? (
                <p className="text-[10px] text-muted-foreground break-all">
                  Data: {lastTick.data_source}
                </p>
              ) : null}
              {lastTick.guardrail_message ? (
                <p className="text-destructive/90 text-[11px] break-words">{lastTick.guardrail_message}</p>
              ) : null}
              {lastTick.trade_error ? (
                <p className="text-destructive break-words">{String(lastTick.trade_error)}</p>
              ) : null}
              <div className="space-y-3 max-h-[220px] overflow-y-auto">
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
              className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-center"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-foreground">
                {running ? "Waiting for first Vigil tick" : "Tick diagnostics idle"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {running
                  ? "Events appear on the interval set in Live Vigil config."
                  : "Start Live Vigil above to stream automation diagnostics here."}
              </p>
            </div>
          )}
        </div>

        {/* Activity log */}
        <div className="space-y-2">
          <Separator />
          <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
            Activity log
          </h3>
          <ul className="text-xs font-mono space-y-1 max-h-[160px] overflow-y-auto rounded-md border border-border p-2 bg-background/40">
            {feedLines.length === 0 ? (
              <li className="text-muted-foreground" role="status">
                No events yet — Vigil ticks will append here in real time.
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

        <GuardrailsPanel
          fetchUrl="/api/coinbase-live/guardrails"
          headers={guardrailsHeaders}
          refreshNonce={guardrailsNonce}
          localKillSwitch={killSwitch}
        />

        {/* Recent fills */}
        {fills.length > 0 ? (
          <div className="space-y-2">
            <Separator />
            <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
              Recent fills
            </h3>
            <div className="text-xs font-mono space-y-2 max-h-56 overflow-auto rounded-md border border-border p-2 bg-background/40">
              {fills.map((f, i) => {
                const side = fStr(f, "side");
                const ts = fNum(f, "ts");
                const usd = fNum(f, "usd");
                const btc = fNum(f, "btc");
                const price = fNum(f, "price");
                const execMode = fStr(f, "execution_mode") || "coinbase_live";
                const rawAtt = f.attestation;
                const att =
                  rawAtt && typeof rawAtt === "object" && !Array.isArray(rawAtt)
                    ? (rawAtt as Record<string, unknown>)
                    : null;
                const attExplorer = att && typeof att.explorer_url === "string" ? att.explorer_url : null;
                const attOk = att?.ok === true;
                const attErr = att?.ok === false && typeof att.error === "string" ? att.error : null;
                return (
                  <div key={String(f.id ?? i)} className="border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0">
                    <div
                      className={cn(
                        "font-medium",
                        side === "buy"
                          ? "text-vigil-green"
                          : side === "sell"
                            ? "text-vigil-amber"
                            : "text-foreground",
                      )}
                      aria-label={`Fill side ${String(side ?? "unknown")}`}
                    >
                      {String(side ?? "-").toUpperCase()} · {execMode}
                      {ts ? <span className="text-muted-foreground font-normal"> · {formatDateTimeGb(ts * 1000)}</span> : null}
                    </div>
                    <div className="text-muted-foreground">
                      GBP {fmtGbp(usd)} · BTC {btc != null ? btc.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "-"}
                      {price != null ? ` · @ ${fmtGbpSpot(price)}` : ""}
                    </div>
                    {attOk && attExplorer ? (
                      <a
                        href={attExplorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[11px] text-primary underline underline-offset-2"
                      >
                        On-chain receipt
                      </a>
                    ) : null}
                    {attErr ? (
                      <p className="mt-1 text-[10px] text-destructive/90 leading-snug">
                        On-chain attestation failed: {attErr}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Cumulative fills chart */}
            {fillsChartData.length > 1 ? (
              <div className="space-y-2 pt-2">
                <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-widest">
                  Cumulative net GBP flow (buys − sells)
                </p>
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fillsChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(ts) => formatDateGb(ts)}
                        className="text-[10px]"
                      />
                      <YAxis className="text-[10px]" domain={["auto", "auto"]} />
                      <Tooltip
                        labelFormatter={(ts) => formatDateTimeGb(Number(ts))}
                        formatter={(v: number) => [fmtGbp(v), "Net GBP flow"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="eq"
                        stroke="hsl(var(--primary))"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
