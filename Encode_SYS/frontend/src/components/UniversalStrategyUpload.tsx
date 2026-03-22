import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Detection = {
  file_kind?: string;
  source_platform?: string;
  confidence?: string;
  notes?: string;
};

type StrategyJson = Record<string, unknown>;

/** Rows compatible with live/paper Vigil autopilot config. */
export type SuggestedAutopilotStrategy = {
  id: string;
  name: string;
  template_type: string;
  params: Record<string, number>;
  enabled: boolean;
};

export type AutopilotApplyResult = {
  paper?: { applied?: boolean; reason?: string | null };
  live?: { applied?: boolean; reason?: string | null };
};

type ParseResponse = {
  parse_id: string;
  filename: string;
  detection: Detection;
  user_summary: string;
  strategy_json: StrategyJson;
};

export function ReadableUniversalFields({ u }: { u: Record<string, unknown> }) {
  const plat = typeof u.source_platform === "string" ? u.source_platform.trim() : "";
  const tf = typeof u.timeframe === "string" ? u.timeframe.trim() : "";
  const ind = Array.isArray(u.indicators) ? u.indicators.map(String).filter(Boolean) : [];
  const assets = Array.isArray(u.assets) ? u.assets.map(String).filter(Boolean) : [];
  const entry = typeof u.entry_conditions === "string" ? u.entry_conditions.trim() : "";
  const exit = typeof u.exit_conditions === "string" ? u.exit_conditions.trim() : "";
  const sl = typeof u.stop_loss === "string" ? u.stop_loss.trim() : "";
  const tp = typeof u.take_profit === "string" ? u.take_profit.trim() : "";
  const hints = u.vigil_template_hints;
  const hintEntries =
    hints && typeof hints === "object" && hints !== null && !Array.isArray(hints)
      ? Object.entries(hints as Record<string, unknown>)
      : [];

  if (
    !plat &&
    !tf &&
    !ind.length &&
    !assets.length &&
    !entry &&
    !exit &&
    !sl &&
    !tp &&
    !hintEntries.length
  ) {
    return <p className="text-muted-foreground">No structured fields in this extract yet.</p>;
  }

  return (
    <div className="space-y-2 text-foreground/90">
      {plat ? (
        <p>
          <span className="font-medium">Platform</span> <span className="text-muted-foreground">{plat}</span>
        </p>
      ) : null}
      {tf ? (
        <p>
          <span className="font-medium">Timeframe</span> <span className="text-muted-foreground">{tf}</span>
        </p>
      ) : null}
      {ind.length ? (
        <p>
          <span className="font-medium">Indicators</span>{" "}
          <span className="text-muted-foreground">{ind.join(", ")}</span>
        </p>
      ) : null}
      {assets.length ? (
        <p>
          <span className="font-medium">Assets</span>{" "}
          <span className="text-muted-foreground">{assets.join(", ")}</span>
        </p>
      ) : null}
      {entry ? (
        <p className="whitespace-pre-wrap">
          <span className="font-medium">Entry</span>{" "}
          <span className="text-muted-foreground">{entry}</span>
        </p>
      ) : null}
      {exit ? (
        <p className="whitespace-pre-wrap">
          <span className="font-medium">Exit</span>{" "}
          <span className="text-muted-foreground">{exit}</span>
        </p>
      ) : null}
      {sl ? (
        <p>
          <span className="font-medium">Stop loss</span> <span className="text-muted-foreground">{sl}</span>
        </p>
      ) : null}
      {tp ? (
        <p>
          <span className="font-medium">Take profit</span> <span className="text-muted-foreground">{tp}</span>
        </p>
      ) : null}
      {hintEntries.length ? (
        <div className="pt-1 border-t border-border/50">
          <p className="font-medium mb-1">Template hints</p>
          <ul className="list-disc pl-4 text-muted-foreground font-mono text-[11px]">
            {hintEntries.map(([k, v]) => (
              <li key={k}>
                {k}={String(v)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function UniversalStrategyUpload({
  bearer,
  onSaved,
}: {
  bearer: string;
  onSaved?: (info?: {
    liveStrategies?: SuggestedAutopilotStrategy[];
    liveNote?: string;
    autopilotApply?: AutopilotApplyResult;
    userSummary?: string;
    rawSummary?: string;
    universalStrategy?: Record<string, unknown>;
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [parse, setParse] = useState<ParseResponse | null>(null);
  const [corrections, setCorrections] = useState("");

  const auth = useCallback(() => {
    const t = bearer.trim();
    if (!t) return null;
    return { Authorization: `Bearer ${t}` };
  }, [bearer]);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    const h = auth();
    if (!h) {
      setErr("Sign in (navbar) to upload a strategy file.");
      return;
    }
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    setParse(null);
    setCorrections("");
    try {
      const fd = new FormData();
      fd.append("strategy_file", file);
      const r = await fetch("/strategy/parse", { method: "POST", headers: h, body: fd });
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const det = d.detail;
        throw new Error(typeof det === "string" ? det : "Upload failed");
      }
      setParse(d as unknown as ParseResponse);
      setOkMsg("Parsed, review Vigil’s summary, then save or correct.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (previewOnly: boolean) => {
    if (!parse?.parse_id) return;
    const h = auth();
    if (!h) {
      setErr("Bearer token required.");
      return;
    }
    setBusy(true);
    setErr(null);
    if (!previewOnly) setOkMsg(null);
    try {
      const r = await fetch("/strategy/parse/confirm", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({
          parse_id: parse.parse_id,
          user_corrections: corrections.trim() || null,
          preview_only: previewOnly,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const det = d.detail;
        throw new Error(typeof det === "string" ? det : "Confirm failed");
      }
      const sj = d.strategy_json as StrategyJson | undefined;
      const us = typeof d.user_summary === "string" ? d.user_summary : "";
      if (previewOnly && sj) {
        setParse((p) => (p ? { ...p, strategy_json: sj, user_summary: us || p.user_summary } : p));
        setOkMsg("Preview updated, adjust corrections or save to Vigil.");
      } else if (!previewOnly) {
        setOkMsg("Strategy saved. Same profile feeds paper and live; Vigil templates update when autopilots are stopped.");
        setParse(null);
        setCorrections("");
        const las = d.live_autopilot_suggestion as { strategies?: SuggestedAutopilotStrategy[]; note?: string } | undefined;
        const raw = d.strategy_json as StrategyJson | undefined;
        const rawSummary =
          raw && typeof raw.raw_summary === "string" && raw.raw_summary.trim() ? raw.raw_summary.trim() : undefined;
        const univ =
          raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
        onSaved?.({
          liveStrategies: Array.isArray(las?.strategies) ? las!.strategies : undefined,
          liveNote: typeof las?.note === "string" ? las.note : undefined,
          autopilotApply: d.autopilot_apply as AutopilotApplyResult | undefined,
          userSummary: us.trim() || undefined,
          rawSummary,
          universalStrategy: univ,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Universal strategy import</CardTitle>
        <CardDescription>
          Upload Pine (.pine, .txt), MetaTrader source (.mq4, .mq5), Python (.py), CSV trade logs, JSON exports, PDF
          reports, or plain-language strategy notes. Vigil detects the format and uses an LLM to extract rules, it does
          not execute the code. Compiled .ex4/.ex5 binaries are not supported (upload source instead).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="strategy-upload">Strategy file</Label>
          <input
            id="strategy-upload"
            type="file"
            disabled={busy || !bearer.trim()}
            accept=".pine,.txt,.mq4,.mq5,.mqh,.py,.csv,.json,.pdf,text/plain"
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground file:hover:bg-primary/90"
            onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          />
          {!bearer.trim() ? (
            <p className="text-xs text-muted-foreground">Sign in with Log in to enable upload.</p>
          ) : null}
        </div>

        {parse ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm font-medium">Detected</span>
              {parse.detection?.file_kind ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {parse.detection.file_kind}
                </Badge>
              ) : null}
              {parse.detection?.source_platform ? (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {parse.detection.source_platform}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">{parse.filename}</span>
            </div>
            <p className="text-sm leading-relaxed">{parse.user_summary || "No summary returned."}</p>
            {parse.strategy_json && typeof parse.strategy_json === "object" ? (
              <div className="rounded-md border border-border/60 bg-background/80 p-3 space-y-1.5 text-xs leading-relaxed">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Vigil-readable rules
                </p>
                <ReadableUniversalFields u={parse.strategy_json as Record<string, unknown>} />
              </div>
            ) : null}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Structured JSON</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-background p-2 font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(parse.strategy_json, null, 2)}
              </pre>
            </details>
            <div className="space-y-2">
              <Label htmlFor="strategy-corrections">Corrections (optional)</Label>
              <Textarea
                id="strategy-corrections"
                placeholder='e.g. "Use 1h timeframe, not 4h" or "Stop loss is ATR-based, not 2%"'
                value={corrections}
                onChange={(e) => setCorrections(e.target.value)}
                rows={3}
                disabled={busy}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void confirm(false)}>
                Save to Vigil
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || !corrections.trim()}
                onClick={() => void confirm(true)}
              >
                Preview correction
              </Button>
            </div>
          </div>
        ) : null}

        {err ? <p className="text-sm text-destructive font-mono">{err}</p> : null}
        {okMsg ? <p className="text-sm text-muted-foreground font-mono">{okMsg}</p> : null}
      </CardContent>
    </Card>
  );
}
