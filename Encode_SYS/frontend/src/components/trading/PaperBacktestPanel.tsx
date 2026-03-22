import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateGb, formatDateTimeGb } from "@/lib/dateFormat";
import { fmtGbp, fmtGbpAxis0, fmtGbpSpot } from "@/lib/formatGbp";
import { cn } from "@/lib/utils";
import { downloadJsonFile, strategyExportFilename } from "@/lib/strategyDownload";
import { Crown, Download } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PerfSummary = {
  label?: string;
  total_return_pct?: number | null;
  win_rate?: number | null;
  best_trade_usd?: number | null;
  worst_trade_usd?: number | null;
  avg_hold_time_hours?: number | null;
  closed_trade_count?: number;
  fill_count?: number;
  equity_curve?: Array<{
    t: number;
    usd_equity?: number;
    equity_usdc?: number;
    btc_price?: number;
    btc_holdings?: number;
    usdc_cash?: number;
  }>;
};

export type BacktestFillRow = {
  id?: string;
  side?: string;
  btc?: number;
  usd?: number;
  price?: number;
  ts?: number;
  reasoning?: string;
  realized_pnl_usd?: number | null;
  quote_currency?: string;
};

export type BacktestStrategyRow = {
  id: string;
  name: string;
  template_type: string;
  params: Record<string, number>;
  enabled?: boolean;
};

const fmtBtc = (n: number | null | undefined) => {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 8 });
};

const fmtTime = (ts: number) => formatDateTimeGb(ts);

function backtestErrorMessage(d: Record<string, unknown>, fallback: string) {
  const det = d.detail;
  if (typeof det === "string") return det;
  if (det && typeof det === "object" && "message" in det) return String((det as { message: string }).message);
  return fallback;
}

export type PaperBacktestPanelProps = {
  bearer: string;
  /** When true, use primary-colored equity line (e.g. on dashboard). Default amber for /demo emphasis. */
  equityLinePrimary?: boolean;
};

export function PaperBacktestPanel({ bearer, equityLinePrimary = false }: PaperBacktestPanelProps) {
  const signedIn = Boolean(bearer.trim());
  const [backtest, setBacktest] = useState<{
    summary: PerfSummary;
    fills: BacktestFillRow[];
    windowDays: 7 | 14;
    dataSource?: string;
    lookback_hours: number;
    strategies: BacktestStrategyRow[];
    simulation: { starting_usdc: number; buy_usd: number; sell_fraction: number };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [startingUsdcStr, setStartingUsdcStr] = useState("10000");
  const [buyUsdStr, setBuyUsdStr] = useState("1000");
  const [sellPctStr, setSellPctStr] = useState("25");

  const chartStrokeEquity = equityLinePrimary ? "hsl(var(--primary))" : "hsl(38 92% 50%)";
  const chartStrokeBtc = "hsl(var(--muted-foreground))";

  const runBacktest = async (windowDays: 7 | 14) => {
    const lookback_hours = windowDays === 7 ? 168 : 336;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (windowDays === 14) {
      const t = bearer.trim();
      if (!t) {
        setMsg("14-day backtest needs a signed-in Civic session. Use Log in in the nav.");
        return;
      }
      headers.Authorization = `Bearer ${t}`;
    }

    const starting_usdc = Number(startingUsdcStr.replace(/,/g, ""));
    const buy_usd = Number(buyUsdStr.replace(/,/g, ""));
    const sellPct = Number(sellPctStr.replace(/,/g, ""));
    if (!Number.isFinite(starting_usdc) || starting_usdc <= 0) {
      setMsg("Starting balance must be a positive number (GBP).");
      return;
    }
    if (!Number.isFinite(buy_usd) || buy_usd <= 0) {
      setMsg("Buy size must be a positive number (GBP spent per buy signal).");
      return;
    }
    if (!Number.isFinite(sellPct) || sellPct <= 0 || sellPct > 100) {
      setMsg("Sell portion must be between 1 and 100 (% of BTC sold per sell signal).");
      return;
    }
    if (buy_usd > starting_usdc + 1e-9) {
      setMsg("Buy size cannot exceed starting balance.");
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/paper/backtest-7d", {
        method: "POST",
        headers,
        body: JSON.stringify({
          lookback_hours,
          starting_usdc,
          buy_usd,
          sell_fraction: sellPct / 100,
        }),
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
      const fills = (Array.isArray(d.fills) ? d.fills : []) as BacktestFillRow[];
      const strategies = (Array.isArray(d.strategies) ? d.strategies : []) as BacktestStrategyRow[];
      const lb = typeof d.lookback_hours === "number" ? d.lookback_hours : lookback_hours;
      setBacktest({
        summary: d.summary as PerfSummary,
        fills,
        windowDays,
        dataSource: typeof d.data_source === "string" ? d.data_source : undefined,
        lookback_hours: lb,
        strategies,
        simulation: {
          starting_usdc,
          buy_usd,
          sell_fraction: sellPct / 100,
        },
      });
      setMsg(`Backtest complete (${windowDays}-day window, historical replay, not live paper).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  };

  const priceEquityChartData = useMemo(() => {
    const curve = backtest?.summary.equity_curve;
    if (!curve?.length) return [];
    return curve.map((p) => ({
      t: p.t * 1000,
      btcGbp: p.btc_price != null ? Number(p.btc_price) : null,
      equity: Number(p.usd_equity ?? p.equity_usdc ?? 0),
    }));
  }, [backtest?.summary.equity_curve]);

  const fillsChronological = useMemo(() => {
    if (!backtest?.fills.length) return [];
    return [...backtest.fills].reverse();
  }, [backtest?.fills]);

  const downloadBacktestExport = () => {
    if (!backtest) return;
    downloadJsonFile(strategyExportFilename("vigil-backtest-strategy"), {
      export_kind: "vigil_backtest",
      exported_at_unix: Math.floor(Date.now() / 1000),
      lookback_hours: backtest.lookback_hours,
      window_days: backtest.windowDays,
      data_source: backtest.dataSource ?? null,
      simulation: backtest.simulation,
      summary: backtest.summary,
      strategies: backtest.strategies,
      note: "Vigil hourly replay templates and run parameters. Re-import via Paper Trading autopilot config or strategy tools as supported.",
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Backtests</CardTitle>
          <CardDescription>
            Historical replay, not your live paper balance. Same voting logic as Vigil autopilot on hourly candles.
            Historical replay on hourly candles. Seven-day window for quick runs; fourteen-day uses your signed-in Civic
            session. Size each buy in GBP (how much BTC you acquire per buy signal at that bar&apos;s price).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="bt-start-usdc">Starting balance (GBP)</Label>
              <Input
                id="bt-start-usdc"
                type="text"
                inputMode="decimal"
                value={startingUsdcStr}
                onChange={(e) => setStartingUsdcStr(e.target.value)}
                disabled={busy}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-buy-usd">Buy size (GBP per buy signal)</Label>
              <Input
                id="bt-buy-usd"
                type="text"
                inputMode="decimal"
                value={buyUsdStr}
                onChange={(e) => setBuyUsdStr(e.target.value)}
                disabled={busy}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-sell-pct">Sell portion (% of BTC per sell signal)</Label>
              <Input
                id="bt-sell-pct"
                type="text"
                inputMode="decimal"
                value={sellPctStr}
                onChange={(e) => setSellPctStr(e.target.value)}
                disabled={busy}
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runBacktest(7)} disabled={busy}>
              Run 7-day backtest
            </Button>
            <Button
              type="button"
              disabled={busy || !signedIn}
              title={
                !signedIn
                  ? "Sign in with Civic to run the 14-day replay"
                  : "14-day historical replay (uses your session token)"
              }
              className={cn(
                "gap-2 border-amber-500/50 bg-gradient-to-r from-amber-700/90 to-amber-600/85 text-amber-50 shadow-md",
                "hover:from-amber-600 hover:to-amber-500 hover:text-white",
                "dark:from-amber-600/80 dark:to-amber-500/75 dark:border-amber-400/40",
                !signedIn && "opacity-80",
              )}
              onClick={() => void runBacktest(14)}
            >
              <Crown className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
              Run 14-day backtest
            </Button>
          </div>

          {backtest ? (
            <>
              <p className="text-xs text-muted-foreground font-mono">
                Showing {backtest.windowDays}-day backtest results
                {backtest.dataSource ? ` · data: ${backtest.dataSource}` : null}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm font-mono">
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
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Closed sells</div>
                  <div>{backtest.summary.closed_trade_count ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Best trade</div>
                  <div>{fmtGbp(backtest.summary.best_trade_usd)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">Worst trade</div>
                  <div>{fmtGbp(backtest.summary.worst_trade_usd)}</div>
                </div>
              </div>

              {priceEquityChartData.length > 1 ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">BTC/GBP and portfolio value</p>
                  <div className="h-64 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={priceEquityChartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(v) => formatDateGb(v)}
                          scale="time"
                        />
                        <YAxis
                          yAxisId="btc"
                          orientation="left"
                          width={68}
                          tickFormatter={(v) => fmtGbpAxis0(Number(v))}
                        />
                        <YAxis
                          yAxisId="eq"
                          orientation="right"
                          width={72}
                          tickFormatter={(v) => fmtGbpAxis0(Number(v))}
                        />
                        <Tooltip
                          labelFormatter={(v) => (typeof v === "number" ? formatDateTimeGb(v) : String(v))}
                          formatter={(value: number, name: string) => {
                            if (name === "btcGbp") return [fmtGbpSpot(value), "BTC/GBP"];
                            if (name === "equity") return [fmtGbp(value), "Portfolio (GBP)"];
                            return [value, name];
                          }}
                        />
                        <Legend />
                        <Line
                          yAxisId="btc"
                          type="monotone"
                          dataKey="btcGbp"
                          name="BTC/GBP"
                          stroke={chartStrokeBtc}
                          dot={false}
                          strokeWidth={2}
                          connectNulls
                        />
                        <Line
                          yAxisId="eq"
                          type="monotone"
                          dataKey="equity"
                          name="Portfolio (GBP)"
                          stroke={chartStrokeEquity}
                          dot={false}
                          strokeWidth={2}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}

              {fillsChronological.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Trade log</p>
                  <div className="rounded-md border max-h-[28rem] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Time</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead className="text-right">BTC</TableHead>
                          <TableHead className="text-right">Notional</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Realized PnL</TableHead>
                          <TableHead className="min-w-[12rem]">Signal detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fillsChronological.map((f) => {
                          const reason = f.reasoning ?? "";
                          const short = reason.length > 100 ? `${reason.slice(0, 100)}…` : reason;
                          const side = (f.side ?? "").toLowerCase();
                          return (
                            <TableRow key={f.id ?? `${f.ts}-${side}`}>
                              <TableCell className="font-mono text-xs whitespace-nowrap">
                                {f.ts != null ? fmtTime(f.ts) : "—"}
                              </TableCell>
                              <TableCell className="uppercase text-xs font-medium">{f.side ?? "—"}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmtBtc(f.btc)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmtGbp(f.usd)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {f.price != null ? fmtGbpSpot(Number(f.price)) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {side === "sell" && f.realized_pnl_usd != null
                                  ? fmtGbp(f.realized_pnl_usd)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[24rem]" title={reason || undefined}>
                                {short || "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {backtest ? (
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60">
                  <Button type="button" variant="secondary" className="gap-2" onClick={downloadBacktestExport}>
                    <Download className="h-4 w-4 shrink-0" aria-hidden />
                    Download updated strategy
                  </Button>
                  <p className="text-xs text-muted-foreground max-w-xl">
                    JSON includes replay templates, sizing, and performance summary from this run.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          {msg ? <p className="text-sm text-muted-foreground font-mono">{msg}</p> : null}
        </CardContent>
      </Card>

      <AlertDialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to Pro</AlertDialogTitle>
            <AlertDialogDescription>
              This action needs a Vigil Pro session in some environments. In the demo app, the 14-day backtest is
              available whenever you are signed in with Civic. For on-chain and live execution stubs, enable “Simulate
              Pro” in the account menu after signing in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setUpgradeOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
