import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVigilUser } from "@/context/VigilUserContext";
import { UniversalStrategyUpload, type SuggestedAutopilotStrategy } from "@/components/UniversalStrategyUpload";
import { PaperTradingWorkspace } from "@/components/trading/PaperTradingWorkspace";
import { TradingFloor } from "@/components/trading/TradingFloor";
import { GuardrailsPanel } from "@/components/trading/GuardrailsPanel";
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { VigilAccessGate } from "@/components/VigilAccessGate";
import { formatDateGb, formatDateTimeGb } from "@/lib/dateFormat";
import { downloadJsonFile, strategyExportFilename } from "@/lib/strategyDownload";
import { fmtGbp } from "@/lib/formatGbp";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PaperStatus = {
  started?: boolean;
  starting_quote_usdc?: number;
  usd_cash?: number;
  btc_balance?: number;
  last_btc_price_usd?: number;
  usd_equity_mark?: number;
  fills?: Array<Record<string, unknown>>;
  equity_curve?: Array<{ t: number; usd_equity?: number }>;
};

type PerfSummary = {
  label?: string;
  total_return_pct?: number | null;
  win_rate?: number | null;
  best_trade_usd?: number | null;
  worst_trade_usd?: number | null;
  avg_hold_time_hours?: number | null;
  closed_trade_count?: number;
  equity_curve?: Array<{ t: number; usd_equity?: number; equity_usdc?: number }>;
};

function FlowStep({
  step,
  title,
  description,
  children,
}: {
  step: 1 | 2 | 3;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-border/90 bg-gradient-to-b from-card/90 to-card/40 shadow-sm scroll-mt-28"
      aria-labelledby={`flow-step-${step}-title`}
    >
      <div className="border-b border-border/60 bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold font-mono text-primary-foreground shadow-md ring-4 ring-primary/15"
            aria-hidden
          >
            {step}
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id={`flow-step-${step}-title`} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{description}</p>
          </div>
        </div>
      </div>
      <div className="space-y-6 px-5 py-6 sm:px-6">{children}</div>
    </section>
  );
}

const GUARDRAILS_DEMO_HASH = "#agent-guardrails-demo";

const GUARDRAIL_DEMO_SCENARIOS = [
  {
    id: "headline_fomo",
    label: "Headline / social FOMO",
    hint: "Chasing breaking news and momentum with no second dataset or stop.",
  },
  {
    id: "size_vs_portfolio",
    label: "Oversized vs book",
    hint: "Notional huge versus cash — no reserve or per-trade cap.",
  },
  {
    id: "martingale_no_stop",
    label: "Double-down, no stop",
    hint: "Adds size after a loss with no drawdown limit (martingale-style).",
  },
  {
    id: "machine_gun_orders",
    label: "Runaway velocity",
    hint: "Fires faster than a human can supervise — no cooldown or audit gate.",
  },
] as const;

const Dashboard = () => {
  const location = useLocation();
  const { bearer, isPro, executionMode } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());
  const [paper, setPaper] = useState<PaperStatus | null>(null);
  const [perf, setPerf] = useState<PerfSummary | null>(null);
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paperVigilRunning, setPaperVigilRunning] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [endVigilBusy, setEndVigilBusy] = useState(false);
  const [strategyRefreshEpoch, setStrategyRefreshEpoch] = useState(0);
  /** When Paper Vigil is running, server skips paper apply — push suggestion into the form without refetching. */
  const [paperStrategyInject, setPaperStrategyInject] = useState<{
    seq: number;
    strategies: SuggestedAutopilotStrategy[];
  } | null>(null);
  /** Shared with TradingFloor SSE + Agent Guardrails demo (above Full AI agent). */
  const [paperKillSwitch, setPaperKillSwitch] = useState(false);
  const [guardrailsNonce, setGuardrailsNonce] = useState(0);
  const [guardrailDemoBusy, setGuardrailDemoBusy] = useState(false);
  const [guardrailDemoScenario, setGuardrailDemoScenario] = useState<string>(
    GUARDRAIL_DEMO_SCENARIOS[0].id,
  );

  const loadPaper = useCallback(async () => {
    try {
      const r = await fetch("/api/paper/status");
      const d = await r.json();
      setPaper(d);
    } catch {
      setPaper(null);
    }
  }, []);

  const loadPerf = useCallback(async () => {
    try {
      const r = await fetch("/api/paper/performance-summary");
      if (!r.ok) {
        setPerf(null);
        return;
      }
      setPerf(await r.json());
    } catch {
      setPerf(null);
    }
  }, []);

  const loadAgent = useCallback(async () => {
    const t = bearer.trim();
    if (!t) {
      setAgent(null);
      return;
    }
    try {
      const r = await fetch("/status", { headers: { Authorization: `Bearer ${t}` } });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAgent(d);
      else setAgent(null);
    } catch {
      setAgent(null);
    }
  }, [bearer]);

  useEffect(() => {
    if (!bearer.trim()) return;
    void loadPaper();
    void loadPerf();
  }, [bearer, loadPaper, loadPerf]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    if (!loggedIn || location.pathname !== "/paper-trading") return;
    if (location.hash !== GUARDRAILS_DEMO_HASH) return;
    const t = window.setTimeout(() => {
      document.getElementById("agent-guardrails-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 280);
    return () => window.clearTimeout(t);
  }, [loggedIn, location.pathname, location.hash]);

  const runGuardrailDemo = useCallback(async () => {
    setGuardrailDemoBusy(true);
    try {
      const r = await fetch("/api/paper/guardrails/demo-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: guardrailDemoScenario }),
      });
      const d = (await r.json().catch(() => ({}))) as { detail?: unknown };
      if (!r.ok) {
        const msg = typeof d.detail === "string" ? d.detail : `Request failed (${r.status})`;
        console.error(msg);
        return;
      }
      setGuardrailsNonce((n) => n + 1);
      void loadPaper();
    } finally {
      setGuardrailDemoBusy(false);
    }
  }, [guardrailDemoScenario, loadPaper]);

  const downloadSessionStrategy = useCallback(async () => {
    const t = bearer.trim();
    if (!t) {
      setMsg("Sign in to download your updated strategy export.");
      return;
    }
    setExportBusy(true);
    try {
      const r = await fetch("/strategy/export", { headers: { Authorization: `Bearer ${t}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const det = (d as { detail?: unknown }).detail;
        setMsg(typeof det === "string" ? det : "Strategy export failed.");
        return;
      }
      downloadJsonFile(strategyExportFilename("vigil-paper-trading-strategy"), d);
      setMsg("Updated strategy export downloaded (profile + paper autopilot config).");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }, [bearer]);

  const endVigil = useCallback(async () => {
    setEndVigilBusy(true);
    try {
      await fetch("/api/paper/halt", { method: "POST" });
      const t = bearer.trim();
      if (t) {
        await fetch("/stop", {
          method: "POST",
          headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
          body: "{}",
        });
      }
      setMsg("End Vigil: kill switch on, paper automation stopped, full agent stopped if it was running.");
      await loadPaper();
      await loadPerf();
      await loadAgent();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "End Vigil failed");
    } finally {
      setEndVigilBusy(false);
    }
  }, [bearer, loadPaper, loadPerf, loadAgent]);

  const serverMode = (agent?.execution_mode as string) || executionMode;
  const autonomous = Boolean(agent?.autonomous);

  const chartData = (curve: PerfSummary["equity_curve"]) =>
    (curve || []).map((p) => ({
      t: p.t * 1000,
      eq: Number(p.usd_equity ?? p.equity_usdc ?? 0),
    }));

  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        {!loggedIn ? (
          <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16 flex justify-center">
            <VigilAccessGate
              variant="page"
              title="Sign in for Paper Trading"
              description="You need a Civic account for strategy sync, paper trading, the trading floor, and the full agent. After you log in, you’ll return to this page automatically."
              returnTo="/paper-trading"
            />
          </div>
        ) : (
          <div className="container mx-auto max-w-6xl px-6 pt-28 pb-20 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Paper Trading</h1>
            <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-relaxed">
              Import your strategy (same profile drives paper and Coinbase live templates), set up the simulated book with
              prices that refresh every minute, then use the trading floor to run automation and watch performance over time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "font-mono text-xs uppercase tracking-wider",
                serverMode === "live"
                  ? "bg-primary/12 text-primary border-primary/35"
                  : "bg-vigil-amber/10 text-vigil-amber border-vigil-amber/35",
              )}
              variant="outline"
            >
              {serverMode === "live" ? "Live mode" : "Paper mode"}
            </Badge>
            {autonomous ? (
              <Badge variant="secondary" className="font-mono text-xs">
                Autopilot on
              </Badge>
            ) : null}
            <Badge variant={isPro ? "default" : "secondary"} className="font-mono text-xs">
              {isPro ? "Pro" : "Free"}
            </Badge>
          </div>
        </div>

        <div className="space-y-10">
          <FlowStep
            step={1}
            title="Your strategy"
            description="Upload a file or notes; Vigil saves one shared profile and maps it into the RSI/EMA templates used by both Paper Vigil and Live Vigil (when those bots are stopped, the save updates their configs automatically)."
          >
            <UniversalStrategyUpload
              bearer={bearer}
              onSaved={(info) => {
                const ap = info?.autopilotApply;
                const rows = info?.liveStrategies;
                if (ap?.paper?.applied) {
                  setPaperStrategyInject(null);
                  setStrategyRefreshEpoch((e) => e + 1);
                } else if (rows?.length) {
                  setPaperStrategyInject({
                    seq: Date.now(),
                    strategies: rows.map((s) => ({ ...s, params: { ...s.params } })),
                  });
                } else {
                  setStrategyRefreshEpoch((e) => e + 1);
                }
                const parts = ["Strategy profile saved."];
                if (ap?.paper?.applied) parts.push("Paper Vigil templates updated.");
                else if (ap?.paper?.reason === "paper_vigil_running") {
                  parts.push("Paper Vigil is running — stop it, then save again to refresh paper templates.");
                }
                if (ap?.live?.applied) parts.push("Live Vigil (Coinbase) templates updated.");
                else if (ap?.live?.reason === "live_vigil_running") {
                  parts.push("Live Vigil is running — stop it on Real trading, then save again to refresh live templates.");
                }
                setMsg(parts.join(" "));
              }}
            />
          </FlowStep>

          <FlowStep
            step={2}
            title="Live price and session conditions"
            description="See Coinbase spot data, reset simulated GBP, and configure Paper Vigil. The paper book’s BTC mark updates automatically every minute while the session is active."
          >
            <CoinbaseLiveMarkets variant="full" />
            <PaperTradingWorkspace
              paper={paper}
              onRefreshPaper={loadPaper}
              onRefreshPerf={loadPerf}
              setBanner={setMsg}
              busy={busy}
              setBusy={setBusy}
              agentAutopilotHint={autonomous}
              onPaperVigilRunningChange={setPaperVigilRunning}
              strategyRefreshEpoch={strategyRefreshEpoch}
              paperStrategyInject={paperStrategyInject}
            />
          </FlowStep>

          <FlowStep
            step={3}
            title="Trading floor and performance over time"
            description="Block or allow paper trades, start or stop automation, read the live tick stream and balances, then review equity and closed-trade statistics as the session evolves."
          >
            <TradingFloor
              paper={paper}
              onRefreshPaper={loadPaper}
              busy={busy}
              setBusy={setBusy}
              paperKillSwitch={paperKillSwitch}
              setPaperKillSwitch={setPaperKillSwitch}
              guardrailsNonce={guardrailsNonce}
              setGuardrailsNonce={setGuardrailsNonce}
            />
            {paper?.started ? (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => void loadPerf()} disabled={busy}>
                  Refresh performance summary
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground font-mono">
                Complete step 2 (reset paper) to unlock session performance charts below.
              </p>
            )}
            {perf && paper?.started ? (
              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-xl">Paper session performance</CardTitle>
                  <CardDescription className="text-base">
                    Closed-trade stats and equity curve from simulated fills
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm font-mono">
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Total return</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {perf.total_return_pct != null ? `${perf.total_return_pct.toFixed(2)}%` : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Win rate</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {perf.win_rate != null ? `${(perf.win_rate * 100).toFixed(1)}%` : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Closed trades</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {perf.closed_trade_count ?? "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Best trade</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {fmtGbp(perf.best_trade_usd)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Worst trade</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {fmtGbp(perf.worst_trade_usd)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Avg hold</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                        {perf.avg_hold_time_hours != null ? `${perf.avg_hold_time_hours.toFixed(1)} h` : "-"}
                      </div>
                    </div>
                  </div>
                  {perf.equity_curve && perf.equity_curve.length > 1 ? (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData(perf.equity_curve)} margin={{ top: 4, right: 16, left: 4, bottom: 2 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis
                            dataKey="t"
                            type="number"
                            scale="time"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(v) => formatDateGb(v)}
                            padding={{ left: 20, right: 20 }}
                          />
                          <YAxis tickFormatter={(v) => fmtGbp(Number(v))} width={64} />
                          <Tooltip
                            labelFormatter={(v) => (typeof v === "number" ? formatDateTimeGb(v) : String(v))}
                            formatter={(v: number) => [fmtGbp(v), "Equity"]}
                          />
                          <Line type="monotone" dataKey="eq" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </FlowStep>
        </div>

        <section
          id="agent-guardrails-demo"
          className="scroll-mt-28 rounded-lg border border-primary/20 bg-background/50 p-5 sm:p-6 space-y-5"
          aria-labelledby="agent-guardrails-demo-heading"
        >
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="space-y-3 min-w-0 max-w-3xl">
              <h2
                id="agent-guardrails-demo-heading"
                className="text-sm font-semibold font-mono uppercase tracking-widest text-foreground"
              >
                Agent Guardrails demo
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Pick a <strong className="text-foreground font-medium">reckless pattern</strong> below, then send it
                through the same path as automation. Each option explains why that behaviour is unsafe; guardrails
                block and log it — nothing hits your paper book. Activity in{" "}
                <strong className="text-foreground font-medium">step 3 · Trading floor</strong> updates live via the
                same stream.
              </p>
              <RadioGroup
                value={guardrailDemoScenario}
                onValueChange={setGuardrailDemoScenario}
                className="grid gap-3 sm:grid-cols-2"
                aria-label="Guardrail demo scenario"
              >
                {GUARDRAIL_DEMO_SCENARIOS.map((s) => (
                  <div
                    key={s.id}
                    className="flex gap-3 rounded-md border border-border/80 bg-muted/15 p-3 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem value={s.id} id={`guardrail-demo-${s.id}`} className="mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <Label htmlFor={`guardrail-demo-${s.id}`} className="text-sm font-medium cursor-pointer leading-snug">
                        {s.label}
                      </Label>
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.hint}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
              <ol className="text-xs font-mono text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Demo trade sent (server receives the intent)</li>
                <li>Guardrails run (same pipeline as Vigil)</li>
                <li>Block recorded; SSE updates activity + this terminal</li>
              </ol>
            </div>
            <Button
              type="button"
              variant="default"
              size="default"
              className="shrink-0 font-mono text-xs sm:text-sm w-full sm:w-auto"
              disabled={!paper?.started || guardrailDemoBusy}
              onClick={() => void runGuardrailDemo()}
            >
              {guardrailDemoBusy ? "Sending…" : "Send demo trade"}
            </Button>
          </div>

          <GuardrailsPanel
            title="Agent guardrails terminal"
            fetchUrl="/api/paper/guardrails"
            refreshNonce={guardrailsNonce}
            localKillSwitch={paperKillSwitch}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-primary">Full AI agent (when ready)</CardTitle>
            <CardDescription>
              Open <strong>Real trading</strong> to link Coinbase, run safeguards, and start <strong>Live Vigil</strong>. Stop{" "}
              <strong>Paper Vigil</strong> first if it is running — only one Vigil loop should run at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {!bearer.trim() ? (
                <Button type="button" disabled title="Sign in to open Real trading">
                  Start agent
                </Button>
              ) : (
                <Button type="button" asChild>
                  <Link to="/real-trading#live-vigil">Start agent</Link>
                </Button>
              )}
            </div>
            {paperVigilRunning ? (
              <p className="text-sm text-vigil-amber font-mono">
                Paper Vigil is still running — stop it above before you start live automation on Real trading, or keep
                testing on paper only.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {paper?.started && paper.fills && paper.fills.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Trade log</CardTitle>
              <CardDescription>Entry/exit prices, P&amp;L context, AI reasoning per fill</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>BTC</TableHead>
                    <TableHead>GBP</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="min-w-[200px]">Reasoning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paper.fills.map((f) => (
                    <TableRow key={String(f.id)}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {f.ts ? formatDateTimeGb(f.ts as number) : "-"}
                      </TableCell>
                      <TableCell>{String(f.side)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtGbp(f.price as number)}</TableCell>
                      <TableCell className="font-mono text-xs">{String(f.btc)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtGbp(f.usd as number)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {String(f.execution_mode || "paper")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md">
                        {(f.reasoning as string) || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-destructive/20 bg-card/80">
          <CardHeader>
            <CardTitle className="text-lg">Finish session</CardTitle>
            <CardDescription>
              Download a JSON snapshot of your imported strategy profile and current paper autopilot templates, or stop
              all Vigil automation (same as the trading floor kill switch plus full agent stop when signed in).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              className="gap-2 w-full sm:w-auto"
              disabled={exportBusy || !bearer.trim()}
              title={!bearer.trim() ? "Sign in to export" : undefined}
              onClick={() => void downloadSessionStrategy()}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              {exportBusy ? "Preparing…" : "Download updated strategy"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={endVigilBusy}
              onClick={() => void endVigil()}
            >
              {endVigilBusy ? "Stopping…" : "End Vigil"}
            </Button>
          </CardContent>
        </Card>

        {msg ? <p className="text-sm text-muted-foreground font-mono">{msg}</p> : null}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
