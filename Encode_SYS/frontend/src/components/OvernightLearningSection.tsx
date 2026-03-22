import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateGb, formatDateTimeGb } from "@/lib/dateFormat";
import { fmtGbp, fmtGbpAxis0, fmtGbpFixed } from "@/lib/formatGbp";
import type { VigilReport } from "@/types/report";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MorningDebriefCard from "./MorningDebriefCard";
import { useScrollReveal } from "./useScrollReveal";

type PollResponse =
  | { status: "running" }
  | { status: "completed"; report: VigilReport }
  | { status: "failed"; error?: { message?: string } };

function postForm(endpoint: string, formData: FormData) {
  return fetch(endpoint, { method: "POST", body: formData }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data as { detail?: string | { msg?: string }[] };
      const msg =
        typeof d.detail === "string"
          ? d.detail
          : Array.isArray(d.detail)
            ? d.detail.map((x) => x.msg).join("; ")
            : "Request failed";
      throw new Error(msg);
    }
    return data;
  });
}

type Props = {
  /** Optional parent callback (e.g. to sync another surface with the latest report). */
  onReport?: (report: VigilReport | null) => void;
};

const OvernightLearningSection = ({ onReport }: Props) => {
  const { ref, isVisible } = useScrollReveal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stopLoss, setStopLoss] = useState("2");
  const [btcSize, setBtcSize] = useState("0.01");
  const [leverage, setLeverage] = useState("1");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [localReport, setLocalReport] = useState<VigilReport | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const run = async () => {
    const input = fileRef.current;
    const file = input?.files?.[0];
    if (!file) {
      setError("Choose a Vigil-compatible Pine file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Uploading…");
    onReport?.(null);
    setLocalReport(null);
    setRunId(null);

    try {
      const fd = new FormData();
      fd.append("pine", file);
      const upload = (await postForm("/api/upload", fd)) as { run_id: string };
      const rid = upload.run_id;
      setRunId(rid);

      const runFd = new FormData();
      runFd.append("run_id", rid);
      runFd.append("stop_loss_pct", stopLoss);
      runFd.append("btc_size", btcSize);
      runFd.append("leverage", leverage || "1");
      const started = (await postForm("/api/run_learning", runFd)) as { ok?: boolean };
      if (!started.ok) throw new Error("Learning did not start");

      setStatus("Running optimizer on the server…");
      for (let i = 0; i < 90; i++) {
        const r = await fetch(`/api/report?run_id=${encodeURIComponent(rid)}`);
        const reportData = (await r.json()) as PollResponse;
        if (reportData.status === "completed") {
          setLocalReport(reportData.report);
          onReport?.(reportData.report);
          setStatus("");
          setBusy(false);
          return;
        }
        if (reportData.status === "failed") {
          const msg = reportData.error?.message ?? "Run failed";
          throw new Error(msg);
        }
        await new Promise((x) => setTimeout(x, 2000));
      }
      throw new Error("Timed out waiting for the report");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("");
      onReport?.(null);
    } finally {
      setBusy(false);
    }
  };

  const clearPineFile = () => {
    const el = fileRef.current;
    if (el) el.value = "";
    setHasFile(false);
    setSelectedFileName(null);
    setError(null);
  };

  const equityData =
    localReport?.equity_curve_best?.map((p) => ({
      t: p.t * 1000,
      best: p.equity_usd,
    })) ?? [];
  const baselineByT = new Map(
    (localReport?.equity_curve_baseline ?? []).map((p) => [p.t, p.equity_usd]),
  );
  const equityMerged = equityData.map((row) => ({
    ...row,
    baseline: baselineByT.get(row.t / 1000),
  }));

  const tried = localReport?.tried_sample ?? [];
  const optChartData = (() => {
    if (!tried.length || !localReport) return [];
    const baselineProfit = localReport.baseline_metrics?.net_profit_usd ?? 0;
    const points: { step: number; profit: number }[] = [{ step: 0, profit: baselineProfit }];
    tried.forEach((trial, i) => {
      points.push({ step: i + 1, profit: trial.metrics.net_profit_usd });
    });
    return points;
  })();

  return (
    <section id="live-demo" className="relative py-32 px-6 pt-12 scroll-mt-24" ref={ref}>
      <div className="container mx-auto max-w-5xl">
        <div
          className={`text-center mb-12 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Overnight</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Overnight learning</h2>
          <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
            Upload a Vigil-tagged Pine file. The backend optimizes parameters on BTC-GBP candles, rewrites your
            script, and returns an overnight-style report.
          </p>
        </div>

        <Card
          className={`border-border bg-vigil-surface/80 backdrop-blur transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
          style={{ transitionDelay: "120ms" }}
        >
          <CardHeader>
            <CardTitle className="text-xl">Run the pipeline</CardTitle>
            <CardDescription>
              Server-side optimizer on BTC-GBP candles, you get a rewritten Pine file and an overnight-style report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border border-border/80 bg-muted/15 p-4 sm:p-5 space-y-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Pine script</Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-foreground/90">.txt</span> or{" "}
                  <span className="text-foreground/90">.pinescript</span>, include a Vigil template line such as{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">
                    // @vigil:template RSIThresholdReversion
                  </code>
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.pinescript,text/plain"
                disabled={busy}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  setError(null);
                  const f = e.target.files?.[0];
                  setHasFile(Boolean(f));
                  setSelectedFileName(f?.name ?? null);
                }}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  disabled={busy}
                  aria-label="Choose Pine script file"
                  className="w-full shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose file
                </Button>
                <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2">
                  <span
                    className={
                      selectedFileName
                        ? "truncate text-sm font-medium text-foreground"
                        : "text-sm text-muted-foreground"
                    }
                    title={selectedFileName ?? undefined}
                  >
                    {selectedFileName ?? "No file selected"}
                  </span>
                </div>
                {hasFile ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={clearPineFile}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sl">Stop-loss %</Label>
                <Input
                  id="sl"
                  type="number"
                  step="0.01"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sz">Size (BTC / trade)</Label>
                <Input
                  id="sz"
                  type="number"
                  step="0.0001"
                  value={btcSize}
                  onChange={(e) => setBtcSize(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lev">Leverage (sim only)</Label>
                <Input
                  id="lev"
                  type="number"
                  step="0.5"
                  min="1"
                  max="125"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <Button
                className="w-full sm:w-auto"
                disabled={busy || !hasFile}
                onClick={() => void run()}
              >
                {busy ? "Running…" : "Run overnight learning"}
              </Button>
              {runId && localReport ? (
                <Button variant="outline" className="w-full sm:w-auto" asChild>
                  <a href={`/api/download_pine?run_id=${encodeURIComponent(runId)}`}>Download updated PineScript</a>
                </Button>
              ) : (
                <Button type="button" variant="outline" className="w-full sm:w-auto" disabled>
                  Download updated PineScript
                </Button>
              )}
            </div>
            {status ? <p className="text-sm text-muted-foreground font-mono">{status}</p> : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {localReport ? (
          <div className="mt-10 space-y-10">
            <div
              className={`text-center mb-8 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
            >
              <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Run results</span>
              <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Morning debrief</h2>
              <p className="mt-3 text-sm text-muted-foreground font-mono">
                {localReport.recent_trades_best?.length ?? 0} recent simulated exits · best parameters
              </p>
            </div>

            <div
              className={`transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
              style={{ transitionDelay: "120ms" }}
            >
              <MorningDebriefCard
                metrics={localReport.best_metrics}
                trades={localReport.recent_trades_best ?? []}
                sessionLabel="Last run (simulated)"
                sessionRight={`BTC-GBP · ${localReport.template_type}`}
              />
            </div>

            {localReport.improvements_text ? (
              <Card className="border-border bg-vigil-surface/60">
                <CardHeader>
                  <CardTitle className="text-lg">What changed</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">{localReport.improvements_text}</p>
                </CardContent>
              </Card>
            ) : null}

            {optChartData.length > 1 ? (
              <Card className="border-border bg-vigil-surface/60">
                <CardHeader>
                  <CardTitle className="text-lg">Top trials (by net profit)</CardTitle>
                  <CardDescription>
                    Sample returned from the server (sorted by simulated net profit, not chronological).
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={optChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="step" allowDecimals={false} />
                      <YAxis dataKey="profit" tickFormatter={(v) => fmtGbpAxis0(Number(v))} />
                      <Tooltip formatter={(v: number) => [fmtGbp(v), "Net profit"]} />
                      <Line
                        type="monotone"
                        dataKey="profit"
                        stroke="hsl(var(--primary))"
                        dot
                        strokeWidth={2}
                        name="Net profit"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            {equityMerged.length > 0 ? (
              <Card className="border-border bg-vigil-surface/60">
                <CardHeader>
                  <CardTitle className="text-lg">Equity (simulated)</CardTitle>
                  <CardDescription>Baseline vs best parameters on the same candle feed</CardDescription>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityMerged}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(v) => formatDateGb(v)}
                      />
                      <YAxis tickFormatter={(v) => fmtGbpAxis0(Number(v))} />
                      <Tooltip
                        labelFormatter={(v) => (typeof v === "number" ? formatDateTimeGb(v) : String(v))}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="baseline" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={2} name="Baseline" connectNulls />
                      <Line type="monotone" dataKey="best" stroke="hsl(var(--vigil-green))" dot={false} strokeWidth={2} name="Best" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-border bg-vigil-surface/60">
              <CardHeader>
                <CardTitle className="text-lg">Parameters</CardTitle>
                <CardDescription>Change in strategy parameters</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="text-left text-muted-foreground text-xs uppercase tracking-widest border-b border-border">
                      <th className="py-2 pr-4">Key</th>
                      <th className="py-2 pr-4">Before</th>
                      <th className="py-2">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(localReport.best_params || {})
                      .sort()
                      .map((k) => (
                        <tr key={k} className="border-b border-border/40">
                          <td className="py-2 pr-4">
                            <code>{k}</code>
                          </td>
                          <td className="py-2 pr-4">{String(localReport.baseline_params[k] ?? "-")}</td>
                          <td className="py-2 font-semibold">{String(localReport.best_params[k] ?? "-")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="border-border bg-vigil-surface/60">
              <CardHeader>
                <CardTitle className="text-lg">Baseline vs optimized</CardTitle>
                <CardDescription>Baseline strategy compared to Optimised strategy</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border/50">
                      <th className="text-left py-2 font-medium">Metric</th>
                      <th className="text-left py-2 font-medium">Baseline</th>
                      <th className="text-left py-2 font-medium">Optimized</th>
                      <th className="text-left py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {(
                      [
                        ["Net profit", "net_profit_usd", "usd"] as const,
                        ["Trades", "trade_count", "int"] as const,
                        ["Win rate", "win_rate", "win"] as const,
                        ["Max drawdown", "max_drawdown_usd", "usd"] as const,
                      ] as const
                    ).map(([label, key, kind]) => {
                      const b = localReport.baseline_metrics[key];
                      const o = localReport.best_metrics[key];
                      const d = localReport.delta_metrics[key];
                      const fmtVal = (v: number | undefined) => {
                        if (v == null) return "-";
                        if (kind === "win") return `${(v * 100).toFixed(1)}%`;
                        if (kind === "usd") return fmtGbp(v);
                        return String(Math.round(v));
                      };
                      const fmtDelta = (v: number | undefined) => {
                        if (v == null) return "-";
                        if (kind === "win") {
                          const sign = v > 0 ? "+" : "";
                          return `${sign}${(v * 100).toFixed(1)} pp`;
                        }
                        if (kind === "usd") {
                          return v > 0 ? `+${fmtGbpFixed(v)}` : fmtGbpFixed(v);
                        }
                        const sign = v > 0 ? "+" : "";
                        return `${sign}${Math.round(v)}`;
                      };
                      return (
                        <tr key={key} className="border-b border-border/40">
                          <td className="py-2">{label}</td>
                          <td className="py-2">{fmtVal(b)}</td>
                          <td className="py-2 font-semibold">{fmtVal(o)}</td>
                          <td className="py-2 text-muted-foreground">{fmtDelta(d as number | undefined)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default OvernightLearningSection;
