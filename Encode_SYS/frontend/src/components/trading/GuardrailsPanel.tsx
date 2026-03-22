import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeGb, formatTimeGb } from "@/lib/dateFormat";
import { cn } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
  recent_blocks?: Array<Record<string, unknown>>;
  kill_switch?: boolean;
};

/** Stacked rule bars: same hue family as brand primary for a cohesive chart. */
const RULE_BAR_COLORS = [
  "hsl(152 58% 40%)",
  "hsl(152 50% 48%)",
  "hsl(165 52% 42%)",
  "hsl(138 48% 44%)",
  "hsl(152 38% 52%)",
  "hsl(172 48% 40%)",
];

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

  const chartData = useMemo(() => {
    if (!data?.series?.length) return [];
    const codes = data.series_rule_codes ?? [];
    return data.series.map((row) => {
      const t = typeof row.t === "number" ? row.t : Number(row.t);
      const out: Record<string, unknown> = {
        label: Number.isFinite(t) ? formatTimeGb(t * 1000) : "?",
        t,
      };
      for (const c of codes) {
        const v = row[c];
        out[c] = typeof v === "number" ? v : Number(v) || 0;
      }
      return out;
    });
  }, [data]);

  const codes = data?.series_rule_codes ?? [];
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

      <div className="h-[140px] w-full min-w-0">
        {chartData.length > 0 && codes.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { t?: number } | undefined;
                  return row?.t != null && Number.isFinite(row.t) ? formatDateTimeGb(row.t * 1000) : "";
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {codes.map((code, i) => (
                <Bar key={code} dataKey={code} stackId="blocks" fill={RULE_BAR_COLORS[i % RULE_BAR_COLORS.length]} name={code} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
            No guardrail blocks in the last 24h.
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">Recent blocks</h4>
        <ul className="text-[10px] font-mono space-y-1 max-h-[120px] overflow-y-auto rounded-md border border-border p-2 bg-background/40">
          {(data?.recent_blocks?.length ?? 0) === 0 ? (
            <li className="text-muted-foreground">None recorded yet.</li>
          ) : (
            (data?.recent_blocks ?? []).map((b) => {
              const ts = typeof b.ts === "number" ? b.ts : Number(b.ts);
              const rc = b.rule_code != null ? String(b.rule_code) : "—";
              const msg = b.message != null ? String(b.message) : "";
              return (
                <li key={String(b.id ?? `${ts}-${rc}`)} className="border-b border-border/40 pb-1 last:border-0">
                  <span className="text-muted-foreground">
                    {Number.isFinite(ts) ? formatDateTimeGb(ts * 1000) : "—"}
                  </span>{" "}
                  <span className="text-destructive font-medium">{rc}</span>
                  {msg ? <span className="block text-muted-foreground truncate" title={msg}>{msg}</span> : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
