import { useCallback, useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVigilUser } from "@/context/VigilUserContext";
import { PaperTradingWorkspace } from "@/components/trading/PaperTradingWorkspace";
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";
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

const fmtUsd = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  const s = v < 0 ? "−" : "";
  return `${s}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const Dashboard = () => {
  const { bearer, setBearer, isPro, setIsPro, executionMode, setExecutionMode, refreshProfile, profileError } =
    useVigilUser();
  const [paper, setPaper] = useState<PaperStatus | null>(null);
  const [perf, setPerf] = useState<PerfSummary | null>(null);
  const [backtest, setBacktest] = useState<{
    summary: PerfSummary;
    fills: unknown[];
    windowDays: 7 | 14;
  } | null>(null);
  const [agent, setAgent] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paperVigilRunning, setPaperVigilRunning] = useState(false);

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
    void loadPaper();
    void loadPerf();
  }, [loadPaper, loadPerf]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const backtestErrorMessage = (d: Record<string, unknown>, fallback: string) => {
    const det = d.detail;
    if (typeof det === "string") return det;
    if (det && typeof det === "object" && "message" in det) return String((det as { message: string }).message);
    return fallback;
  };

  const runBacktest = async (windowDays: 7 | 14) => {
    const lookback_hours = windowDays === 7 ? 168 : 336;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (windowDays === 14) {
      const t = bearer.trim();
      if (!t) {
        setMsg("14-day backtest needs a bearer token — paste one above and sync profile.");
        setUpgradeOpen(true);
        return;
      }
      headers.Authorization = `Bearer ${t}`;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/paper/backtest-7d", {
        method: "POST",
        headers,
        body: JSON.stringify({ lookback_hours, starting_usdc: 10_000 }),
      });
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      const det = d.detail;
      if (
        r.status === 403 &&
        typeof det === "object" &&
        det !== null &&
        (det as { code?: string }).code === "upgrade_required"
      ) {
        setUpgradeOpen(true);
        setMsg(null);
        return;
      }
      if (!r.ok) throw new Error(backtestErrorMessage(d, "Backtest failed"));
      setBacktest({
        summary: d.summary as PerfSummary,
        fills: (d.fills as unknown[]) || [],
        windowDays,
      });
      setMsg(
        `Backtest complete (${windowDays}-day window, historical replay — not live paper).`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  };

  const startAgent = async () => {
    const t = bearer.trim();
    if (!t) {
      setMsg("Paste a bearer token to start the agent.");
      return;
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
        return;
      }
      if (!r.ok) {
        const det = d.detail;
        throw new Error(typeof det === "string" ? det : JSON.stringify(det));
      }
      setAgent(d);
      setMsg("Agent started — Vigil autopilot is running.");
      await loadPaper();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Start failed");
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
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto max-w-6xl px-6 pt-28 pb-20 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Paper trade</h1>
            <p className="text-muted-foreground mt-1">
              Test strategies on paper (manual + Paper Vigil), then start the full AI agent when you are ready.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "font-mono text-xs uppercase tracking-wider",
                serverMode === "live"
                  ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/40"
                  : "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40",
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

        <CoinbaseLiveMarkets variant="full" />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Account & tier</CardTitle>
            <CardDescription>
              Free tier: paper trading and backtests only. Pro unlocks live autonomous execution (AgentKit stub until
              wired).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dash-bearer">Bearer token (Civic session)</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="dash-bearer"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste access_token after POST /auth"
                  value={bearer}
                  onChange={(e) => setBearer(e.target.value)}
                />
                <Button type="button" variant="secondary" onClick={() => void refreshProfile()}>
                  Sync profile
                </Button>
              </div>
            </div>
            {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch id="pro-toggle" checked={isPro} onCheckedChange={(v) => void setIsPro(v)} />
                <Label htmlFor="pro-toggle">Simulate Pro (syncs to server when token is set)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Autopilot execution</Label>
                <Button
                  type="button"
                  size="sm"
                  variant={executionMode === "paper" ? "default" : "outline"}
                  onClick={() => void setExecutionMode("paper")}
                >
                  Paper
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={executionMode === "live" ? "default" : "outline"}
                  onClick={() => void setExecutionMode("live")}
                >
                  Live
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <PaperTradingWorkspace
          paper={paper}
          onRefreshPaper={loadPaper}
          onRefreshPerf={loadPerf}
          setBanner={setMsg}
          busy={busy}
          setBusy={setBusy}
          agentAutopilotHint={autonomous}
          onPaperVigilRunningChange={setPaperVigilRunning}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-emerald-700 dark:text-emerald-400">Full AI agent (when ready)</CardTitle>
            <CardDescription>
              Civic session, news, and Vigil autopilot together. Use <strong>Paper</strong> execution mode here to keep
              filling the same simulated portfolio after your tests above. Stop <strong>Paper Vigil</strong> first — only
              one Vigil loop can run at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void startAgent()}
                disabled={busy || paperVigilRunning || !bearer.trim()}
                title={
                  paperVigilRunning
                    ? "Stop Paper Vigil before starting the full agent"
                    : !bearer.trim()
                      ? "Paste a bearer token"
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
              <p className="text-sm text-amber-700 dark:text-amber-300 font-mono">
                Paper Vigil is running — stop it above to start the full agent, or keep testing on paper only.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {paper?.started ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void loadPerf()} disabled={busy}>
              Refresh performance summary
            </Button>
          </div>
        ) : null}

        {perf && paper?.started ? (
          <Card>
            <CardHeader>
              <CardTitle>Paper session performance</CardTitle>
              <CardDescription>Closed-trade stats from simulated fills</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm font-mono">
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Total return</div>
                  <div>{perf.total_return_pct != null ? `${perf.total_return_pct.toFixed(2)}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Win rate</div>
                  <div>{perf.win_rate != null ? `${(perf.win_rate * 100).toFixed(1)}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Closed trades</div>
                  <div>{perf.closed_trade_count ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Best trade</div>
                  <div>{fmtUsd(perf.best_trade_usd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Worst trade</div>
                  <div>{fmtUsd(perf.worst_trade_usd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Avg hold</div>
                  <div>
                    {perf.avg_hold_time_hours != null ? `${perf.avg_hold_time_hours.toFixed(1)} h` : "—"}
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
                        tickFormatter={(v) => new Date(v).toLocaleDateString()}
                      />
                      <YAxis tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                      <Tooltip
                        labelFormatter={(v) => (typeof v === "number" ? new Date(v).toLocaleString() : String(v))}
                        formatter={(v: number) => [fmtUsd(v), "Equity"]}
                      />
                      <Line type="monotone" dataKey="eq" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Backtests</CardTitle>
            <CardDescription>
              Historical replay — not your live paper balance. Same voting logic as Vigil autopilot on hourly candles.
              Seven days for everyone; fourteen days for Pro (signed-in session).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void runBacktest(7)} disabled={busy}>
                Run 7-day backtest
              </Button>
              <Button
                type="button"
                disabled={busy}
                title={
                  !isPro
                    ? "Pro feature — enable Simulate Pro and use a bearer token"
                    : !bearer.trim()
                      ? "Paste a bearer token for a signed-in Pro session"
                      : "14-day historical replay (Pro)"
                }
                className={cn(
                  "gap-2 border-amber-500/50 bg-gradient-to-r from-amber-700/90 to-amber-600/85 text-amber-50 shadow-md",
                  "hover:from-amber-600 hover:to-amber-500 hover:text-white",
                  "dark:from-amber-600/80 dark:to-amber-500/75 dark:border-amber-400/40",
                  !isPro && "opacity-80",
                )}
                onClick={() => {
                  if (!isPro) {
                    setUpgradeOpen(true);
                    return;
                  }
                  void runBacktest(14);
                }}
              >
                <Crown className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
                Run 14-day backtest
              </Button>
            </div>
            {backtest ? (
              <>
                <p className="text-xs text-muted-foreground font-mono">
                  Showing {backtest.windowDays}-day backtest results
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm font-mono">
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">Total return</div>
                    <div>
                      {backtest.summary.total_return_pct != null
                        ? `${backtest.summary.total_return_pct.toFixed(2)}%`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">Win rate</div>
                    <div>
                      {backtest.summary.win_rate != null
                        ? `${(backtest.summary.win_rate * 100).toFixed(1)}%`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">Fills</div>
                    <div>{backtest.summary.fill_count ?? "—"}</div>
                  </div>
                </div>
                {backtest.summary.equity_curve && backtest.summary.equity_curve.length > 1 ? (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData(backtest.summary.equity_curve)}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(v) => new Date(v).toLocaleDateString()}
                        />
                        <YAxis tickFormatter={(v) => `$${Number(v).toLocaleString()}`} />
                        <Tooltip
                          labelFormatter={(v) => (typeof v === "number" ? new Date(v).toLocaleString() : String(v))}
                          formatter={(v: number) => [fmtUsd(v), "Equity"]}
                        />
                        <Line type="monotone" dataKey="eq" stroke="hsl(38 92% 50%)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        {paper?.started && paper.fills && paper.fills.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Paper trade log</CardTitle>
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
                    <TableHead>USDC</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="min-w-[200px]">Reasoning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paper.fills.map((f) => (
                    <TableRow key={String(f.id)}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {f.ts
                          ? new Date((f.ts as number) * 1000).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell>{String(f.side)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtUsd(f.price as number)}</TableCell>
                      <TableCell className="font-mono text-xs">{String(f.btc)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtUsd(f.usd as number)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {String(f.execution_mode || "paper")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md">
                        {(f.reasoning as string) || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {msg ? <p className="text-sm text-muted-foreground font-mono">{msg}</p> : null}
      </main>
      <Footer />

      <AlertDialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to Pro</AlertDialogTitle>
            <AlertDialogDescription>
              Upgrade to Pro to let Vigil trade for you on-chain and unlock the 14-day backtest. Free tier includes
              unlimited paper trading, 7-day backtests, and more. No payment is connected yet — enable “Simulate Pro”
              after signing in to try the live execution stub and extended replay.
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
