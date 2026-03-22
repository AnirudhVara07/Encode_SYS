import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCoinbaseTicker } from "@/hooks/useCoinbaseTicker";
import { fmtGbp, fmtGbpSpot } from "@/lib/formatGbp";
import { cn } from "@/lib/utils";

const TEMPLATES = ["RSIThresholdReversion", "RSICrossTrendFilter", "EMACrossover"] as const;

const DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  RSIThresholdReversion: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70 },
  RSICrossTrendFilter: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70, ema_len: 50 },
  EMACrossover: { ema_fast: 10, ema_slow: 30 },
};

const PARAM_LABELS: Record<string, string> = {
  rsi_len: "RSI length",
  rsi_lower: "RSI oversold",
  rsi_upper: "RSI overbought",
  ema_len: "EMA length",
  ema_fast: "Fast EMA",
  ema_slow: "Slow EMA",
};

const QUOTE_POLL_MS = 60_000;

function paramStep(key: string): number {
  if (key.includes("frac") || key === "sell_fraction") return 0.05;
  return 1;
}

function StepNum({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const s = step ?? 1;
  const n = Number.parseFloat(value);
  const bump = (dir: number) => {
    const base = Number.isFinite(n) ? n : 0;
    let next = base + dir * s;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(String(next));
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-stretch rounded-md border border-border/80 bg-muted/25 overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 rounded-none border-r border-border/60 px-0 text-lg leading-none"
          disabled={disabled}
          onClick={() => bump(-1)}
          aria-label="Decrease"
        >
          −
        </Button>
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 border-0 rounded-none text-center font-mono text-sm shadow-none focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 rounded-none border-l border-border/60 px-0 text-lg leading-none"
          disabled={disabled}
          onClick={() => bump(1)}
          aria-label="Increase"
        >
          +
        </Button>
      </div>
    </div>
  );
}

export type PaperSnapshot = {
  started?: boolean;
  usd_cash?: number;
  btc_balance?: number;
  last_btc_price_usd?: number;
  usd_equity_mark?: number;
};

type AutopilotStrategy = {
  id: string;
  name: string;
  template_type: string;
  params: Record<string, number>;
  enabled: boolean;
  last_signal?: string | null;
};

type AutopilotSnapshot = {
  running?: boolean;
  interval_sec?: number;
  lookback_hours?: number;
  buy_usd?: number;
  sell_fraction?: number;
  order_routing?: string;
  strategies?: AutopilotStrategy[];
  last_error?: string | null;
};

type Props = {
  paper: PaperSnapshot | null;
  onRefreshPaper: () => Promise<void>;
  onRefreshPerf: () => Promise<void>;
  setBanner: (s: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  agentAutopilotHint?: boolean;
  onPaperVigilRunningChange?: (running: boolean) => void;
  strategyRefreshEpoch?: number;
  paperStrategyInject?: { seq: number; strategies: AutopilotStrategy[] } | null;
};

export function PaperTradingWorkspace({
  paper,
  onRefreshPaper,
  onRefreshPerf,
  setBanner,
  busy,
  setBusy,
  agentAutopilotHint,
  onPaperVigilRunningChange,
  strategyRefreshEpoch = 0,
  paperStrategyInject = null,
}: Props) {
  const [startingUsdc, setStartingUsdc] = useState("10000");
  const [ap, setAp] = useState<AutopilotSnapshot | null>(null);
  const [apInterval, setApInterval] = useState("60");
  const [apLookback, setApLookback] = useState("168");
  const [apBuyUsd, setApBuyUsd] = useState("1000");
  const [apSellFrac, setApSellFrac] = useState("0.25");
  const [apOrderRouting, setApOrderRouting] = useState<"internal" | "coinbase_sandbox">("internal");
  const [strategies, setStrategies] = useState<AutopilotStrategy[]>([]);

  const loadAutopilot = useCallback(async () => {
    try {
      const r = await fetch("/api/paper/autopilot");
      if (!r.ok) {
        onPaperVigilRunningChange?.(false);
        return;
      }
      const d = (await r.json()) as AutopilotSnapshot;
      setAp(d);
      onPaperVigilRunningChange?.(Boolean(d.running));
      setApInterval(String(Math.round(d.interval_sec ?? 60)));
      setApLookback(String(d.lookback_hours ?? 168));
      setApBuyUsd(String(d.buy_usd ?? 1000));
      setApSellFrac(String(d.sell_fraction ?? 0.25));
      const routing = d.order_routing === "coinbase_sandbox" ? "coinbase_sandbox" : "internal";
      setApOrderRouting(routing);
      if (d.strategies?.length) {
        setStrategies(
          d.strategies.map((s) => ({
            ...s,
            params: { ...s.params },
          })),
        );
      } else {
        setStrategies([
          {
            id: `st-${Date.now()}`,
            name: "RSI reversion",
            template_type: "RSIThresholdReversion",
            params: { ...DEFAULT_PARAMS.RSIThresholdReversion },
            enabled: true,
          },
        ]);
      }
    } catch {
      onPaperVigilRunningChange?.(false);
    }
  }, [onPaperVigilRunningChange]);

  useEffect(() => {
    void loadAutopilot();
  }, [loadAutopilot, paper?.started, strategyRefreshEpoch]);

  useEffect(() => {
    const rows = paperStrategyInject?.strategies;
    if (!rows?.length) return;
    setStrategies(rows.map((s) => ({ ...s, params: { ...s.params } })));
  }, [paperStrategyInject?.seq]);

  const started = Boolean(paper?.started);

  /** Keep paper book spot mark fresh without a manual button (server fetch once per minute). */
  useEffect(() => {
    if (!started) return;
    const run = () => {
      void fetch("/api/paper/quote")
        .then((r) => (r.ok ? onRefreshPaper() : undefined))
        .catch(() => {});
    };
    run();
    const id = window.setInterval(run, QUOTE_POLL_MS);
    return () => clearInterval(id);
  }, [started, onRefreshPaper]);

  const resetPaper = async () => {
    const n = Math.max(100, Number(startingUsdc) || 10_000);
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/paper/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starting_usd: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Reset failed");
      await onRefreshPaper();
      await onRefreshPerf();
      await loadAutopilot();
      setBanner(`Paper portfolio ready with ${n.toLocaleString()} GBP (simulated).`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const saveVigilConfig = async () => {
    if (ap?.running) {
      setBanner("Stop Paper Vigil before saving config.");
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const parsed: AutopilotStrategy[] = strategies.map((row) => {
        let params: Record<string, number>;
        try {
          params = JSON.parse(JSON.stringify(row.params));
        } catch {
          throw new Error(`Invalid params for ${row.name || row.id}`);
        }
        return {
          id: row.id,
          name: row.name,
          template_type: row.template_type,
          enabled: row.enabled,
          params,
        };
      });
      const r = await fetch("/api/paper/autopilot/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interval_sec: Number(apInterval) || 60,
          lookback_hours: Number(apLookback) || 168,
          buy_usd: Number(apBuyUsd) || 1000,
          sell_fraction: Number(apSellFrac) || 0.25,
          order_routing: apOrderRouting,
          strategies: parsed,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Save failed");
      setAp(d as AutopilotSnapshot);
      setBanner("Vigil paper config saved. You can start Paper Vigil when ready.");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const startPaperVigil = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/paper/autopilot/start", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Start failed");
      const snap = d as AutopilotSnapshot;
      setAp(snap);
      onPaperVigilRunningChange?.(Boolean(snap.running));
      setBanner("Paper Vigil is running, rule-based trades on your simulated portfolio (no bearer token).");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const stopPaperVigil = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/paper/autopilot/stop", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Stop failed");
      const snap = d as AutopilotSnapshot;
      setAp(snap);
      onPaperVigilRunningChange?.(Boolean(snap.running));
      setBanner("Paper Vigil stopped. Adjust config or restart when ready.");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  };

  const addStrategy = () => {
    const tt = TEMPLATES[0];
    setStrategies((prev) => [
      ...prev,
      {
        id: `st-${Date.now()}`,
        name: "New strategy",
        template_type: tt,
        params: { ...DEFAULT_PARAMS[tt] },
        enabled: true,
      },
    ]);
  };

  const removeStrategy = (id: string) => {
    setStrategies((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  };

  const setStrategyParam = (idx: number, key: string, num: number) => {
    setStrategies((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, params: { ...s.params, [key]: num } } : s)),
    );
  };

  const vigilRunning = Boolean(ap?.running);

  const { ticks: paperBtcGbpTicks } = useCoinbaseTicker(["BTC-GBP"]);
  const paperLiveBtcGbpPx = useMemo(() => {
    const t = paperBtcGbpTicks["BTC-GBP"];
    if (!t) return null;
    const ask = Number(t.bestAsk);
    if (Number.isFinite(ask) && ask > 0) return ask;
    const p = Number(t.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  }, [paperBtcGbpTicks]);

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.03] dark:bg-amber-500/[0.06]">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-xl text-amber-800 dark:text-amber-200">Paper book &amp; automation setup</CardTitle>
            <CardDescription className="mt-2 max-w-3xl">
              Part of <strong>step 2</strong>: seed the simulated portfolio, then configure and start{" "}
              <strong>Paper Vigil</strong>. Spot marks refresh <strong>every minute</strong> while the book is active.{" "}
              <strong>Step 3</strong> is the trading floor below.
            </CardDescription>
          </div>
          {vigilRunning ? (
            <span className="shrink-0 inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-1 text-xs font-mono uppercase tracking-wide text-amber-900 dark:text-amber-200">
              Paper Vigil on
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Paper Vigil off
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        <Alert>
          <AlertTitle className="text-sm font-semibold">Step 2 checklist</AlertTitle>
          <AlertDescription className="text-sm space-y-1 mt-2">
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                <strong>Portfolio:</strong> set starting GBP and <strong>Reset / enable paper</strong>. BTC mark updates
                automatically each minute.
              </li>
              <li>
                <strong>Paper Vigil:</strong> tune timing and templates below, <strong>Save Vigil config</strong>, then{" "}
                <strong>Start Paper Vigil</strong>. Watch ticks in <strong>step 3 · Trading floor</strong>.
              </li>
              <li>
                For news + Civic + optional live execution, use <strong>Start agent</strong> at the bottom (requires
                sign-in).
              </li>
            </ol>
          </AlertDescription>
        </Alert>

        {agentAutopilotHint ? (
          <Alert variant="default" className="border-primary/40">
            <AlertTitle className="text-sm">Full agent may be active</AlertTitle>
            <AlertDescription className="text-sm">
              The dashboard agent can also drive Vigil. Prefer stopping one automation source at a time to avoid
              confusion. Paper Vigil and agent both use the same paper portfolio when execution is in paper mode.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-4">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-widest text-muted-foreground border-b border-border/60 pb-2">
            Simulated portfolio
          </h3>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="start-usdc">Starting GBP (simulated)</Label>
              <Input
                id="start-usdc"
                type="number"
                min={100}
                step={100}
                value={startingUsdc}
                onChange={(e) => setStartingUsdc(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={() => void resetPaper()} disabled={busy}>
              Reset / enable paper
            </Button>
          </div>
          {started ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-mono pt-2">
              <div>
                <span className="text-muted-foreground text-xs block">GBP cash</span>
                {fmtGbp(paper?.usd_cash)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">BTC</span>
                {paper?.btc_balance != null ? Number(paper.btc_balance).toFixed(8) : "-"}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Mark equity</span>
                {fmtGbp(paper?.usd_equity_mark)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">BTC spot (book)</span>
                {paper?.last_btc_price_usd != null ? fmtGbpSpot(paper.last_btc_price_usd) : "-"}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Reset paper to unlock Vigil configuration.</p>
          )}
          {started && paperLiveBtcGbpPx != null ? (
            <p className="text-xs text-muted-foreground">
              Live BTC-GBP ticker (reference): <span className="font-mono text-foreground">{fmtGbpSpot(paperLiveBtcGbpPx)}</span>
            </p>
          ) : null}
        </section>

        <Separator />

        <section className="space-y-6">
          <h3 className="text-xs font-semibold font-mono uppercase tracking-widest text-muted-foreground border-b border-border/60 pb-2">
            Paper Vigil — automation
          </h3>
          <p className="text-sm text-muted-foreground">
            Same template signals as overnight learning. Activity streams in <strong>step 3 · Trading floor</strong>.
            Trades stay <strong>100% simulated</strong> unless you route sandbox orders (server credentials required).
          </p>

          <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Execution</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Order routing</Label>
                <Select
                  value={apOrderRouting}
                  onValueChange={(v) => setApOrderRouting(v as "internal" | "coinbase_sandbox")}
                  disabled={vigilRunning || busy}
                >
                  <SelectTrigger className="h-10 bg-background/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal book (spot-priced fills)</SelectItem>
                    <SelectItem value="coinbase_sandbox">Coinbase sandbox IOC + mirrored book</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timing &amp; data</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StepNum
                label="Interval (sec)"
                value={apInterval}
                onChange={setApInterval}
                min={60}
                step={60}
                disabled={vigilRunning || busy}
              />
              <StepNum
                label="Lookback (hours)"
                value={apLookback}
                onChange={setApLookback}
                min={24}
                max={720}
                step={24}
                disabled={vigilRunning || busy}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Order size</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <StepNum
                label="Buy (GBP per signal)"
                value={apBuyUsd}
                onChange={setApBuyUsd}
                min={1}
                step={50}
                disabled={vigilRunning || busy}
              />
              <StepNum
                label="Sell fraction"
                value={apSellFrac}
                onChange={setApSellFrac}
                min={0.01}
                max={1}
                step={0.05}
                disabled={vigilRunning || busy}
              />
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Strategies</p>
            {strategies.map((row, idx) => {
              const keys = Object.keys(DEFAULT_PARAMS[row.template_type] || row.params || {});
              return (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-lg border border-border/80 p-4 space-y-4 bg-background/80",
                    !row.enabled && "opacity-70",
                  )}
                >
                  <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <Input
                        className="max-w-[200px] h-9"
                        value={row.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setStrategies((p) => p.map((s, i) => (i === idx ? { ...s, name: v } : s)));
                        }}
                        disabled={vigilRunning || busy}
                        placeholder="Strategy name"
                      />
                      <div className="space-y-1 min-w-[200px]">
                        <Label className="text-[10px] uppercase text-muted-foreground">Template</Label>
                        <Select
                          value={row.template_type}
                          onValueChange={(tt) => {
                            setStrategies((p) =>
                              p.map((s, i) =>
                                i === idx ? { ...s, template_type: tt, params: { ...DEFAULT_PARAMS[tt] } } : s,
                              ),
                            );
                          }}
                          disabled={vigilRunning || busy}
                        >
                          <SelectTrigger className="h-9 bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TEMPLATES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                        <Switch
                          checked={row.enabled}
                          onCheckedChange={(v) => {
                            setStrategies((p) => p.map((s, i) => (i === idx ? { ...s, enabled: v } : s)));
                          }}
                          disabled={vigilRunning || busy}
                        />
                        <span className="text-xs text-muted-foreground">Enabled</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStrategy(row.id)}
                      disabled={vigilRunning || busy || strategies.length <= 1}
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Parameters</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {keys.map((k) => (
                        <StepNum
                          key={k}
                          label={PARAM_LABELS[k] ?? k}
                          value={String(row.params[k] ?? DEFAULT_PARAMS[row.template_type]?.[k] ?? 0)}
                          onChange={(v) => {
                            const n = Number.parseFloat(v);
                            if (Number.isFinite(n)) setStrategyParam(idx, k, n);
                          }}
                          step={paramStep(k)}
                          disabled={vigilRunning || busy}
                        />
                      ))}
                    </div>
                  </div>

                  <Collapsible defaultOpen={false}>
                    <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/35">
                      <span>Advanced options</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                      <div className="pt-3 space-y-2">
                        <Label className="text-xs text-muted-foreground">Params (JSON)</Label>
                        <Textarea
                          className="font-mono text-xs min-h-[100px] bg-background/90"
                          spellCheck={false}
                          defaultValue={JSON.stringify(row.params, null, 2)}
                          disabled={vigilRunning || busy}
                          onBlur={(e) => {
                            try {
                              const p = JSON.parse(e.target.value || "{}") as Record<string, number>;
                              setStrategies((prev) => prev.map((s, i) => (i === idx ? { ...s, params: p } : s)));
                            } catch {
                              /* keep editing */
                            }
                          }}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Collapse and expand this panel after using steppers above to reload JSON from them.
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {ap?.strategies?.find((s) => s.id === row.id)?.last_signal != null ? (
                    <p className="text-xs font-mono text-muted-foreground">
                      Last signal: {String(ap.strategies?.find((s) => s.id === row.id)?.last_signal ?? "-")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addStrategy} disabled={vigilRunning || busy}>
              Add strategy
            </Button>
            <Button type="button" variant="secondary" onClick={() => void saveVigilConfig()} disabled={busy}>
              Save Vigil config
            </Button>
            <Button type="button" onClick={() => void startPaperVigil()} disabled={busy || !started || vigilRunning}>
              Start Paper Vigil
            </Button>
            <Button type="button" variant="destructive" onClick={() => void stopPaperVigil()} disabled={busy || !vigilRunning}>
              Stop Paper Vigil
            </Button>
          </div>
          {ap?.last_error ? <p className="text-xs text-destructive font-mono">Last error: {ap.last_error}</p> : null}
        </section>
      </CardContent>
    </Card>
  );
}
