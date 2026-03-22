import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeGb, formatTimeGb } from "@/lib/dateFormat";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type GuardrailsApiPayload = {
  book?: string;
  posture?: {
    strict?: boolean;
    matching_count?: number;
    macro_regex?: string;
    matching_headlines?: string[];
  };
  rules_summary?: Array<{ id?: string; description?: string }>;
  blocked_total?: number;
  series?: Array<Record<string, unknown>>;
  series_rule_codes?: string[];
  recent_blocks?: Array<{
    id?: unknown;
    ts?: unknown;
    rule_code?: unknown;
    message?: unknown;
    reasons?: unknown;
    source?: unknown;
    chain_audit?: {
      ok?: boolean;
      explorer_url?: string;
      error?: string;
    };
  }>;
  kill_switch?: boolean;
};

const X_TICK_COUNT = 7;

type Props = {
  title?: string;
  fetchUrl: string;
  headers?: Record<string, string>;
  /** Bump to refetch from parent (e.g. after SSE tick). */
  refreshNonce?: number;
  pollMs?: number;
  localKillSwitch?: boolean;
};

export function GuardrailsPanel({
  title = "Agent guardrails",
  fetchUrl,
  headers,
  refreshNonce = 0,
  pollMs = 45_000,
  localKillSwitch,
}: Props) {
  const [data, setData] = useState<GuardrailsApiPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(fetchUrl, { headers: headers ?? {} });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      setErr(null);
      setData((await r.json()) as GuardrailsApiPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load guardrails");
    }
  }, [fetchUrl, headers]);

  useEffect(() => {
    void load();
  }, [load, refreshNonce]);

  useEffect(() => {
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  /** Chronological series: left = start of window, right = now (ticker-style). */
  const lineSeries = useMemo(() => {
    if (!data?.series?.length) return [];
    const ruleCodes = data.series_rule_codes ?? [];
    const rows = data.series.map((row) => {
      const t = typeof row.t === "number" ? row.t : Number(row.t);
      let total = 0;
      const breakdown: Array<{ code: string; n: number }> = [];
      for (const c of ruleCodes) {
        const n = typeof row[c] === "number" ? row[c] : Number(row[c]) || 0;
        if (n > 0) breakdown.push({ code: c, n });
        total += n;
      }
      return { t, total, breakdown };
    });
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }, [data]);

  /** Evenly spaced unix times so labels read in true time order (avoids bar-chart tick subsampling). */
  const xAxisTicks = useMemo(() => {
    if (lineSeries.length < 2) return undefined;
    const lo = lineSeries[0].t;
    const hi = lineSeries[lineSeries.length - 1].t;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
    return Array.from({ length: X_TICK_COUNT }, (_, i) => lo + ((hi - lo) * i) / (X_TICK_COUNT - 1));
  }, [lineSeries]);
  const strict = Boolean(data?.posture?.strict);
  const matchCount = data?.posture?.matching_count ?? 0;
  const ks = localKillSwitch ?? Boolean(data?.kill_switch);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-background/50">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h3 className="text-sm font-semibold font-mono uppercase tracking-widest text-muted-foreground">{title}</h3>
        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide",
              strict
                ? "border-vigil-amber/45 bg-vigil-amber/10 text-vigil-amber"
                : "border-border text-muted-foreground",
            )}
          >
            News strict {strict ? "on" : "off"}
          </span>
          {strict ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide",
                matchCount > 0
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              Macro headlines {matchCount}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide",
              ks ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border text-muted-foreground",
            )}
          >
            Kill switch {ks ? "on" : "off"}
          </span>
          <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            Blocks logged {data?.blocked_total ?? "—"}
          </span>
        </div>
      </div>

      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {strict && (data?.posture?.matching_headlines?.length ?? 0) > 0 ? (
        <ul className="text-[10px] font-mono text-muted-foreground max-h-[72px] overflow-y-auto space-y-0.5 border border-border/60 rounded-md p-2 bg-muted/20">
          {(data?.posture?.matching_headlines ?? []).slice(0, 8).map((h, i) => (
            <li key={i} className="truncate" title={h}>
              · {h}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="w-full min-w-0 space-y-1">
        {lineSeries.length > 0 ? (
          <>
            <p className="text-[10px] text-muted-foreground font-mono px-0.5">
              Blocks per minute · past 24h (older ← left, now → right)
            </p>
            <div className="h-[152px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineSeries} margin={{ top: 4, right: 16, left: 4, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  ticks={xAxisTicks}
                  tickFormatter={(unix) => formatTimeGb(Number(unix) * 1000)}
                  stroke="hsl(var(--border))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  padding={{ left: 16, right: 16 }}
                />
                <YAxis
                  allowDecimals={false}
                  width={32}
                  domain={[0, "auto"]}
                  stroke="hsl(var(--border))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as {
                      t: number;
                      total: number;
                      breakdown: Array<{ code: string; n: number }>;
                    };
                    if (!Number.isFinite(row.t)) return null;
                    return (
                      <div
                        className="rounded-md border border-border px-2.5 py-2 text-xs shadow-md"
                        style={{
                          background: "hsl(var(--popover))",
                          color: "hsl(var(--popover-foreground))",
                        }}
                      >
                        <p className="font-mono text-[11px] text-muted-foreground mb-1">
                          {formatDateTimeGb(row.t * 1000)}
                        </p>
                        <p className="font-medium tabular-nums">{row.total} block{row.total === 1 ? "" : "s"} this minute</p>
                        {row.breakdown.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-muted-foreground border-t border-border/60 pt-1.5">
                            {row.breakdown.map((b) => (
                              <li key={b.code}>
                                {b.code}: {b.n}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Blocks / min"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
            No guardrail timeline for this book yet.
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Recent blocks</h4>
        <p className="text-[10px] text-muted-foreground/90 font-sans leading-snug mt-0.5 mb-1.5">
          Each entry lists every rule that applied; one demo trade can be blocked for several reasons at once.
        </p>
        <ul className="space-y-2 max-h-[220px] overflow-y-auto rounded-md border border-border p-2 bg-background/40">
          {(data?.recent_blocks?.length ?? 0) === 0 ? (
            <li className="text-[10px] font-mono text-muted-foreground">None recorded yet.</li>
          ) : (
            (data?.recent_blocks ?? []).map((b) => {
              const ts = typeof b.ts === "number" ? b.ts : Number(b.ts);
              const rc = b.rule_code != null ? String(b.rule_code) : "—";
              const msg = b.message != null ? String(b.message) : "";
              const rawReasons = b.reasons;
              const reasonRows: Array<{ code: string; text: string }> = [];
              if (Array.isArray(rawReasons)) {
                for (const r of rawReasons) {
                  if (!r || typeof r !== "object") continue;
                  const o = r as Record<string, unknown>;
                  const c = o.rule_code != null ? String(o.rule_code) : "";
                  const m = o.message != null ? String(o.message) : "";
                  if (c || m) reasonRows.push({ code: c || "—", text: m });
                }
              }
              if (reasonRows.length === 0 && (rc !== "—" || msg)) {
                reasonRows.push({ code: rc, text: msg });
              }
              const src = b.source != null ? String(b.source) : "";
              const ca = b.chain_audit;
              const caOk = ca?.ok === true;
              const caUrl = typeof ca?.explorer_url === "string" ? ca.explorer_url : null;
              const caErr = ca?.ok === false && typeof ca?.error === "string" ? ca.error : null;
              return (
                <li
                  key={String(b.id ?? `${ts}-${rc}-${reasonRows.map((r) => r.code).join(",")}`)}
                  className="border-b border-border/40 pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] font-mono">
                    <span className="text-muted-foreground shrink-0">
                      {Number.isFinite(ts) ? formatDateTimeGb(ts * 1000) : "—"}
                    </span>
                    {src ? (
                      <span className="rounded border border-border/80 bg-muted/30 px-1 py-px text-muted-foreground">{src}</span>
                    ) : null}
                  </div>
                  <ul className="mt-1.5 space-y-1.5 pl-0 list-none">
                    {reasonRows.map((r, i) => (
                      <li key={`${r.code}-${i}`} className="text-xs leading-snug">
                        <span className="font-mono text-[10px] font-semibold text-destructive">{r.code}</span>
                        {r.text ? (
                          <span className="block font-sans text-muted-foreground pl-0 mt-0.5">{r.text}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {caOk && caUrl ? (
                    <a
                      href={caUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[10px] text-primary underline underline-offset-2"
                    >
                      On-chain audit
                    </a>
                  ) : null}
                  {caErr ? (
                    <p className="mt-1 text-[10px] text-destructive/80 leading-snug">
                      Chain audit failed: {caErr}
                    </p>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
