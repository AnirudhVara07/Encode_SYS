import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { LiveTradingConfirmDialog } from "@/components/LiveTradingConfirmDialog";
import { VigilAccessGate } from "@/components/VigilAccessGate";
import { formatDateGb, formatDateTimeGb } from "@/lib/dateFormat";
import { fetchTradingGuard, type TradingGuardConfig } from "@/lib/tradingGuard";
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

const Dashboard = () => {
  const { bearer, isPro, executionMode } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());
  const [paper, setPaper] = useState<PaperStatus | null>(null);
  const [perf, setPerf] = useState<PerfSummary | null>(null);
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paperVigilRunning, setPaperVigilRunning] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [endVigilBusy, setEndVigilBusy] = useState(false);
  const [tradingGuard, setTradingGuard] = useState<TradingGuardConfig | null>(null);
  const [liveAgentConfirmOpen, setLiveAgentConfirmOpen] = useState(false);
  const [strategyRefreshEpoch, setStrategyRefreshEpoch] = useState(0);
  /** When Paper Vigil is running, server skips paper apply — push suggestion into the form without refetching. */
  const [paperStrategyInject, setPaperStrategyInject] = useState<{
    seq: number;
    strategies: SuggestedAutopilotStrategy[];
  } | null>(null);

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
    const t = bearer.trim();
    if (!t) {
      setTradingGuard(null);
      return;
    }
    const auth = `Bearer ${t}`;
    void fetchTradingGuard(auth)
      .then(setTradingGuard)
      .catch(() => setTradingGuard({ captcha_required: false, turnstile_site_key: "" }));
  }, [bearer]);

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

  const startAgent = async (captchaToken?: string): Promise<boolean> => {
    const t = bearer.trim();
    if (!t) {
      setMsg("Sign in to start the agent.");
      return false;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reset_paper: false,
          starting_usd: 10_000,
          execution_mode: executionMode,
          ...(captchaToken ? { captcha_token: captchaToken } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      const det = d.detail;
      if (
        r.status === 403 &&
        typeof det === "object" &&
        det !== null &&
        (det as { code?: string }).code === "upgrade_required"
      ) {
        setUpgradeOpen(true);
        setMsg(null);
        return false;
      }
      if (!r.ok) {
        const det = d.detail;
        throw new Error(typeof det === "string" ? det : JSON.stringify(det));
      }
      setAgent(d);
      setMsg("Agent started, Vigil autopilot is running.");
      await loadPaper();
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Start failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const stopAgent = async () => {
    const t = bearer.trim();
    if (!t) return;
    setBusy(true);
    try {
      await fetch("/stop", { method: "POST", headers: { Authorization: `Bearer ${t}` } });
      setMsg("Agent stopped.");
      await loadAgent();
    } finally {
      setBusy(false);
    }
  };

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
            <LiveTradingConfirmDialog
              open={liveAgentConfirmOpen}
              onOpenChange={setLiveAgentConfirmOpen}
              guard={tradingGuard}
              busy={busy}
              title="Confirm start agent (live)"
              confirmLabel="Start agent"
              subcopy={
                <p>
                  You are signed in with Civic. Complete the check below so we know a person is confirming — then the
                  full agent will start in <strong>live</strong> execution mode.
                </p>
              }
              ackLabel="I understand I am starting the full agent in live execution mode."
              onConfirm={async ({ captchaToken }) => {
                const ok = await startAgent(captchaToken);
                if (ok) setLiveAgentConfirmOpen(false);
              }}
            />
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
            <TradingFloor paper={paper} onRefreshPaper={loadPaper} busy={busy} setBusy={setBusy} />
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
                        <LineChart data={chartData(perf.equity_curve)}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(v) => formatDateGb(v)}
                          />
                          <YAxis tickFormatter={(v) => fmtGbp(Number(v))} />
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

        <Card>
          <CardHeader>
            <CardTitle className="text-xl text-primary">Full AI agent (when ready)</CardTitle>
            <CardDescription>
              Civic session, news, and Vigil autopilot together. Use <strong>Paper</strong> execution mode here to keep
              filling the same simulated portfolio after your tests above. Stop <strong>Paper Vigil</strong> first, only
              one Vigil loop can run at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (executionMode === "live") setLiveAgentConfirmOpen(true);
                  else void startAgent();
                }}
                disabled={busy || paperVigilRunning || !bearer.trim()}
                title={
                  paperVigilRunning
                    ? "Stop Paper Vigil before starting the full agent"
                    : !bearer.trim()
                      ? "Sign in to start the agent"
                      : undefined
                }
              >
                Start agent
              </Button>
              <Button variant="secondary" onClick={() => void stopAgent()} disabled={busy || !bearer.trim()}>
                Stop agent
              </Button>
            </div>
            {paperVigilRunning ? (
              <p className="text-sm text-vigil-amber font-mono">
                Paper Vigil is running, stop it above to start the full agent, or keep testing on paper only.
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

      <AlertDialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to Pro</AlertDialogTitle>
            <AlertDialogDescription>
              Upgrade to Pro (Simulate Pro in the account menu) to unlock live execution flows in this demo. The 14-day
              strategy backtest on Back testing is available to any signed-in Civic session. Free tier includes
              unlimited paper trading and 7-day backtests. No payment is connected yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setUpgradeOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
