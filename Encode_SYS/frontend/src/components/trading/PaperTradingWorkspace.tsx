import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TEMPLATES = ["RSIThresholdReversion", "RSICrossTrendFilter", "EMACrossover"] as const;

const DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  RSIThresholdReversion: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70 },
  RSICrossTrendFilter: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70, ema_len: 50 },
  EMACrossover: { ema_fast: 10, ema_slow: 30 },
};

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
  /** When true, full agent autopilot may also be on — show context */
  agentAutopilotHint?: boolean;
  /** So parent can disable “Start agent” while paper vigil runs (same autopilot mutex). */
  onPaperVigilRunningChange?: (running: boolean) => void;
};

const fmtUsd = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  const s = v < 0 ? "−" : "";
  return `${s}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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
}: Props) {
  const [startingUsdc, setStartingUsdc] = useState("10000");
  const [buySpend, setBuySpend] = useState("500");
  const [sellBtc, setSellBtc] = useState("0.001");
  const [ap, setAp] = useState<AutopilotSnapshot | null>(null);
  const [apInterval, setApInterval] = useState("300");
  const [apLookback, setApLookback] = useState("168");
  const [apBuyUsd, setApBuyUsd] = useState("1000");
  const [apSellFrac, setApSellFrac] = useState("0.25");
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
      setApInterval(String(Math.round(d.interval_sec ?? 300)));
      setApLookback(String(d.lookback_hours ?? 168));
      setApBuyUsd(String(d.buy_usd ?? 1000));
      setApSellFrac(String(d.sell_fraction ?? 0.25));
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
  }, [loadAutopilot, paper?.started]);

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
      setBanner(`Paper portfolio ready with ${n.toLocaleString()} USDC (simulated).`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshQuote = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/paper/quote");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Quote failed");
      await onRefreshPaper();
      setBanner("Spot price refreshed.");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  };

  const manualTrade = async (side: "buy" | "sell") => {
    setBusy(true);
    setBanner(null);
    try {
      const body =
        side === "buy"
          ? { side: "buy", usd: Number(buySpend) || 0 }
          : { side: "sell", btc: Number(sellBtc) || 0 };
      const r = await fetch("/api/paper/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Trade failed");
      await onRefreshPaper();
      await onRefreshPerf();
      setBanner(`Manual ${side} filled at latest spot (paper).`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Trade failed");
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
          throw new Error(`Invalid params JSON for ${row.name || row.id}`);
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
          interval_sec: Number(apInterval) || 300,
          lookback_hours: Number(apLookback) || 168,
          buy_usd: Number(apBuyUsd) || 1000,
          sell_fraction: Number(apSellFrac) || 0.25,
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
      setBanner("Paper Vigil is running — rule-based trades on your simulated portfolio (no bearer token).");
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
      setBanner("Paper Vigil stopped. Adjust config or run manual trades.");
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

  const vigilRunning = Boolean(ap?.running);
  const started = Boolean(paper?.started);

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.03] dark:bg-amber-500/[0.06]">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="text-xl text-amber-800 dark:text-amber-200">Paper trading — test first</CardTitle>
            <CardDescription className="mt-2 max-w-3xl">
              Practice on simulated USDC: manual orders, tune Vigil strategies, then run <strong>Paper Vigil</strong>{" "}
              (automation) <em>before</em> starting the full AI agent. No Civic token required for this section.
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
          <AlertTitle className="text-sm font-semibold">Suggested flow</AlertTitle>
          <AlertDescription className="text-sm space-y-1 mt-2">
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Reset paper and optionally change starting USDC.</li>
              <li>
                Place <strong>manual</strong> buys/sells to learn the book, or jump to Vigil config.
              </li>
              <li>
                Save <strong>Vigil</strong> templates &amp; params, then <strong>Start Paper Vigil</strong> to mirror
                how the AI will vote — still 100% simulated.
              </li>
              <li>
                When results look good, use <strong>Start agent</strong> below (needs token) for news, Civic, and
                optional live execution.
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

        {/* Step 1 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
            1 · Portfolio
          </h3>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="start-usdc">Starting USDC (simulated)</Label>
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
            <Button type="button" variant="outline" onClick={() => void refreshQuote()} disabled={busy || !started}>
              Refresh spot quote
            </Button>
          </div>
          {started ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-mono pt-2">
              <div>
                <span className="text-muted-foreground text-xs block">USDC cash</span>
                {fmtUsd(paper?.usd_cash)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">BTC</span>
                {paper?.btc_balance != null ? Number(paper.btc_balance).toFixed(8) : "—"}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Mark equity</span>
                {fmtUsd(paper?.usd_equity_mark)}
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">BTC spot</span>
                {fmtUsd(paper?.last_btc_price_usd)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Reset paper to unlock manual trading and Vigil.</p>
          )}
        </section>

        <Separator />

        {/* Step 2 manual */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
            2 · Manual trades (you in control)
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2 rounded-lg border border-border p-4 bg-background/80">
              <Label htmlFor="manual-buy">Spend USDC</Label>
              <div className="flex gap-2 flex-wrap">
                <Input
                  id="manual-buy"
                  type="number"
                  min={1}
                  step={100}
                  value={buySpend}
                  onChange={(e) => setBuySpend(e.target.value)}
                  disabled={!started || busy}
                />
                <Button onClick={() => void manualTrade("buy")} disabled={!started || busy}>
                  Buy BTC
                </Button>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-4 bg-background/80">
              <Label htmlFor="manual-sell">Sell BTC size</Label>
              <div className="flex gap-2 flex-wrap">
                <Input
                  id="manual-sell"
                  type="number"
                  min={1e-8}
                  step={0.0001}
                  value={sellBtc}
                  onChange={(e) => setSellBtc(e.target.value)}
                  disabled={!started || busy}
                />
                <Button variant="secondary" onClick={() => void manualTrade("sell")} disabled={!started || busy}>
                  Sell BTC
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* Step 3 Vigil */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">
            3 · Vigil strategies (paper automation)
          </h3>
          <p className="text-sm text-muted-foreground">
            Same template signals as overnight learning. Paper Vigil runs on a timer and trades your{" "}
            <strong>simulated</strong> balances only.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Interval (sec)</Label>
              <Input
                type="number"
                min={60}
                step={60}
                value={apInterval}
                onChange={(e) => setApInterval(e.target.value)}
                disabled={vigilRunning || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Candle lookback (h)</Label>
              <Input
                type="number"
                min={24}
                max={720}
                step={24}
                value={apLookback}
                onChange={(e) => setApLookback(e.target.value)}
                disabled={vigilRunning || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vigil buy (USDC)</Label>
              <Input
                type="number"
                min={1}
                step={100}
                value={apBuyUsd}
                onChange={(e) => setApBuyUsd(e.target.value)}
                disabled={vigilRunning || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sell fraction</Label>
              <Input
                type="number"
                min={0.01}
                max={1}
                step={0.05}
                value={apSellFrac}
                onChange={(e) => setApSellFrac(e.target.value)}
                disabled={vigilRunning || busy}
              />
            </div>
          </div>

          <div className="space-y-3">
            {strategies.map((row, idx) => (
              <div
                key={row.id}
                className={cn(
                  "rounded-lg border border-border p-4 space-y-3 bg-background/80",
                  !row.enabled && "opacity-70",
                )}
              >
                <div className="flex flex-wrap gap-2 items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="max-w-[200px]"
                      value={row.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStrategies((p) => p.map((s, i) => (i === idx ? { ...s, name: v } : s)));
                      }}
                      disabled={vigilRunning || busy}
                      placeholder="Strategy name"
                    />
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={row.template_type}
                      onChange={(e) => {
                        const tt = e.target.value;
                        setStrategies((p) =>
                          p.map((s, i) =>
                            i === idx
                              ? { ...s, template_type: tt, params: { ...DEFAULT_PARAMS[tt] } }
                              : s,
                          ),
                        );
                      }}
                      disabled={vigilRunning || busy}
                    >
                      {TEMPLATES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
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
                <div className="space-y-1">
                  <Label className="text-xs">Params (JSON)</Label>
                  <Textarea
                    key={`${row.id}-${row.template_type}`}
                    className="font-mono text-xs min-h-[72px]"
                    spellCheck={false}
                    defaultValue={JSON.stringify(row.params, null, 0)}
                    disabled={vigilRunning || busy}
                    onBlur={(e) => {
                      try {
                        const p = JSON.parse(e.target.value || "{}") as Record<string, number>;
                        setStrategies((prev) => prev.map((s, i) => (i === idx ? { ...s, params: p } : s)));
                      } catch {
                        /* invalid JSON — leave state until user fixes */
                      }
                    }}
                  />
                </div>
                {ap?.strategies?.find((s) => s.id === row.id)?.last_signal != null ? (
                  <p className="text-xs font-mono text-muted-foreground">
                    Last signal: {String(ap.strategies?.find((s) => s.id === row.id)?.last_signal ?? "—")}
                  </p>
                ) : null}
              </div>
            ))}
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
          {ap?.last_error ? (
            <p className="text-xs text-destructive font-mono">Last error: {ap.last_error}</p>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
