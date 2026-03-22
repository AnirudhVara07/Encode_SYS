import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import CoinbaseLiveMarkets from "@/components/CoinbaseLiveMarkets";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { LiveTradingConfirmDialog } from "@/components/LiveTradingConfirmDialog";
import { ReadableUniversalFields, UniversalStrategyUpload } from "@/components/UniversalStrategyUpload";
import { VigilAccessGate } from "@/components/VigilAccessGate";
import { LiveTradingFloor } from "@/components/trading/LiveTradingFloor";
import { useVigilUser } from "@/context/VigilUserContext";
import { fetchTradingGuard, type TradingGuardConfig } from "@/lib/tradingGuard";
import { fmtGbp } from "@/lib/formatGbp";
import { formatDateTimeGb } from "@/lib/dateFormat";
import { downloadJsonFile, strategyExportFilename } from "@/lib/strategyDownload";
import { cn } from "@/lib/utils";
import { ChevronDown, Download, Wallet } from "lucide-react";

const TEMPLATES = ["RSIThresholdReversion", "RSICrossTrendFilter", "EMACrossover"] as const;

/** Select value for “use mapped params from saved universal strategy profile”. */
const UPLOADED_STRATEGY_VALUE = "__vigil_from_upload__";

type StrategyPickSource = "uploaded" | "builtin";

function friendlyTemplateName(templateType: string): string {
  switch (templateType) {
    case "RSIThresholdReversion":
      return "RSI reversion";
    case "RSICrossTrendFilter":
      return "RSI + EMA trend filter";
    case "EMACrossover":
      return "EMA crossover";
    default:
      return templateType;
  }
}

function isLikelyUploadedStrategyRow(s: { name?: string; pickSource?: StrategyPickSource }): boolean {
  if (s.pickSource === "uploaded") return true;
  return String(s.name || "")
    .trim()
    .toLowerCase() === "from uploaded strategy";
}

const GBP_CAP_EPS = 1e-4;

/** Poll Coinbase live status + fills while Live Vigil is running (scheduler tick ~5s + user interval). */
const LIVE_VIGIL_POLL_MS = 9000;

const DIAG_LINE_MAX = 140;

function truncateLiveDiagLine(s: string, max = DIAG_LINE_MAX): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

const EMPTY_STRATEGY_IMPORT_PREVIEW = {
  userSummary: "",
  rawSummary: "",
  mappingNote: "",
  universalStrategy: null as Record<string, unknown> | null,
} as const;

function parseMoneyInput(s: string): number {
  return Number.parseFloat(String(s).replace(/,/g, ""));
}

function exceedsGbpAvailable(amount: number, gbpAvailable: number): boolean {
  return Number.isFinite(amount) && amount > gbpAvailable + GBP_CAP_EPS;
}

/** Match backend normalize_brokerage_product_id for comparing / saving pair. */
function normalizeProductIdInput(s: string): string {
  const t = String(s || "")
    .trim()
    .replace(/_/g, "-")
    .toUpperCase();
  return t || "BTC-GBP";
}

const DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  RSIThresholdReversion: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70 },
  RSICrossTrendFilter: { rsi_len: 14, rsi_lower: 30, rsi_upper: 70, ema_len: 50 },
  EMACrossover: { ema_fast: 10, ema_slow: 30 },
};

type AutopilotStrategy = {
  id: string;
  name: string;
  template_type: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Live page only: drives dropdown (uploaded profile vs built-in template). Not sent to API. */
  pickSource?: StrategyPickSource;
};

function strategyRowSelectValue(s: AutopilotStrategy): string {
  if (s.pickSource === "uploaded" || (s.pickSource !== "builtin" && isLikelyUploadedStrategyRow(s))) {
    return UPLOADED_STRATEGY_VALUE;
  }
  const tt = s.template_type;
  if ((TEMPLATES as readonly string[]).includes(tt)) return tt;
  return TEMPLATES[0];
}

function apiErrorDetail(data: { detail?: unknown }): string {
  const det = data.detail;
  if (typeof det === "string") return det;
  if (det && typeof det === "object" && "message" in det) {
    const m = (det as { message?: string; owner_sub_masked?: string }).message;
    const o = (det as { owner_sub_masked?: string }).owner_sub_masked;
    if (typeof m === "string") return typeof o === "string" && o ? `${m} (${o})` : m;
  }
  return "";
}

type StatusResponse = {
  linked?: boolean;
  org_mode?: boolean;
  using_shared_account?: boolean;
  preset_from_env?: boolean;
  preset_env_partial?: boolean;
  api_key_id_masked?: string | null;
  product_id?: string | null;
  balances?: {
    gbp_available?: number;
    btc_available?: number;
  } | null;
  balances_error?: string | null;
  autopilot?: {
    running?: boolean;
    interval_sec?: number;
    lookback_hours?: number;
    buy_usd?: number;
    sell_fraction?: number;
    strategies?: AutopilotStrategy[];
  };
  runtime?: {
    last_tick_unix?: number | null;
    last_error?: string | null;
    last_diagnostics?: Record<string, unknown> | null;
  };
};

/** Normalize API balance (number, numeric string, or missing → 0 when balances object exists). */
function gbpFromBalances(balances: NonNullable<StatusResponse["balances"]>): number {
  const v = balances.gbp_available as unknown;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export default function RealTradingPage() {
  const { bearer } = useVigilUser();
  const loggedIn = Boolean(bearer.trim());
  const headers = {
    Authorization: `Bearer ${bearer.trim()}`,
    "Content-Type": "application/json",
  };

  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coinbaseStatusLoading, setCoinbaseStatusLoading] = useState(false);
  const [sessionExportBusy, setSessionExportBusy] = useState(false);
  const [sessionEndBusy, setSessionEndBusy] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  /** When true, /api/coinbase-live/status returned 401 — avoid showing “set .env” (preset may already be fine). */
  const [coinbaseStatusUnauthorized, setCoinbaseStatusUnauthorized] = useState(false);
  const [fills, setFills] = useState<Array<Record<string, unknown>>>([]);

  const [apInterval, setApInterval] = useState("60");
  const [apLookback, setApLookback] = useState("168");
  const [apBuyUsd, setApBuyUsd] = useState("1000");
  const [apSellFrac, setApSellFrac] = useState("0.25");
  const [strategies, setStrategies] = useState<AutopilotStrategy[]>([]);
  /** First row from GET /strategy/live-autopilot-suggestion; keeps “From uploaded strategy” preview accurate. */
  const [cachedUploadedProfileRow, setCachedUploadedProfileRow] = useState<AutopilotStrategy | null>(null);
  /** Human-readable text for the saved import + server mapping note (Strategies section preview). */
  const [strategyImportPreview, setStrategyImportPreview] = useState<{
    userSummary: string;
    rawSummary: string;
    mappingNote: string;
    universalStrategy: Record<string, unknown> | null;
  }>({ ...EMPTY_STRATEGY_IMPORT_PREVIEW });
  const [strategyExportBusy, setStrategyExportBusy] = useState(false);
  const [tradingGuard, setTradingGuard] = useState<TradingGuardConfig | null>(null);
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);
  const liveVigilPollInFlight = useRef(false);

  const [productIdDraft, setProductIdDraft] = useState("BTC-GBP");

  const loadStatus = useCallback(async () => {
    if (!loggedIn) return;
    setCoinbaseStatusLoading(true);
    try {
      const r = await fetch("/api/coinbase-live/status", { headers: { Authorization: headers.Authorization } });
      const d = (await r.json()) as StatusResponse;
      if (r.ok) {
        setCoinbaseStatusUnauthorized(false);
        setStatus(d);
      } else if (r.status === 401) {
        setCoinbaseStatusUnauthorized(true);
        setStatus(null);
      } else {
        setCoinbaseStatusUnauthorized(false);
        setStatus(d);
      }
    } catch {
      setCoinbaseStatusUnauthorized(false);
      setStatus(null);
    } finally {
      setCoinbaseStatusLoading(false);
    }
  }, [loggedIn, headers.Authorization]);

  const loadFills = useCallback(async () => {
    if (!loggedIn) return;
    try {
      const r = await fetch("/api/coinbase-live/fills?limit=50", { headers: { Authorization: headers.Authorization } });
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.fills)) setFills(d.fills);
    } catch {
      setFills([]);
    }
  }, [loggedIn, headers.Authorization]);

  const refreshUploadedProfileCache = useCallback(async (): Promise<AutopilotStrategy | null> => {
    if (!loggedIn) return null;
    try {
      const r = await fetch("/strategy/live-autopilot-suggestion", {
        headers: { Authorization: headers.Authorization },
      });
      const d = (await r.json().catch(() => ({}))) as {
        strategies?: AutopilotStrategy[];
        note?: string;
        user_summary?: string;
        raw_summary?: string;
        universal_strategy?: unknown;
        detail?: unknown;
      };
      if (!r.ok) return null;
      const us = d.universal_strategy;
      const universalStrategy =
        us && typeof us === "object" && !Array.isArray(us) ? (us as Record<string, unknown>) : null;
      setStrategyImportPreview({
        userSummary: typeof d.user_summary === "string" ? d.user_summary : "",
        rawSummary: typeof d.raw_summary === "string" ? d.raw_summary : "",
        mappingNote: typeof d.note === "string" ? d.note : "",
        universalStrategy,
      });
      const first = d.strategies?.[0];
      if (first) {
        const row: AutopilotStrategy = {
          ...first,
          params: { ...first.params },
          pickSource: "uploaded",
        };
        setCachedUploadedProfileRow(row);
        return row;
      }
      setCachedUploadedProfileRow(null);
      return null;
    } catch {
      setCachedUploadedProfileRow(null);
      return null;
    }
  }, [loggedIn, headers.Authorization]);

  const applySuggestionStrategies = useCallback((raw: AutopilotStrategy[] | undefined, note?: string) => {
    if (!raw?.length) return;
    const first = raw[0];
    setCachedUploadedProfileRow({
      ...first,
      params: { ...first.params },
      pickSource: "uploaded",
    });
    setStrategies(
      raw.map((s) => ({
        ...s,
        params: { ...s.params },
        pickSource: "uploaded" as const,
      })),
    );
    setBanner(
      note
        ? `${note} Tap Save config on Live Vigil before starting.`
        : "Applied suggested Vigil templates from your profile. Tap Save config on Live Vigil before starting.",
    );
  }, []);

  const loadLiveAutopilotSuggestion = useCallback(async () => {
    if (!loggedIn) return;
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/strategy/live-autopilot-suggestion", {
        headers: { Authorization: headers.Authorization },
      });
      const d = (await r.json().catch(() => ({}))) as {
        strategies?: AutopilotStrategy[];
        note?: string;
        user_summary?: string;
        raw_summary?: string;
        universal_strategy?: unknown;
        detail?: unknown;
      };
      if (!r.ok) {
        setBanner(apiErrorDetail(d as { detail?: unknown }) || "Could not load template suggestion.");
        return;
      }
      const us = d.universal_strategy;
      const universalStrategy =
        us && typeof us === "object" && !Array.isArray(us) ? (us as Record<string, unknown>) : null;
      setStrategyImportPreview({
        userSummary: typeof d.user_summary === "string" ? d.user_summary : "",
        rawSummary: typeof d.raw_summary === "string" ? d.raw_summary : "",
        mappingNote: typeof d.note === "string" ? d.note : "",
        universalStrategy,
      });
      applySuggestionStrategies(d.strategies, typeof d.note === "string" ? d.note : undefined);
    } catch {
      setBanner("Could not load template suggestion.");
    } finally {
      setBusy(false);
    }
  }, [applySuggestionStrategies, headers.Authorization, loggedIn]);

  const downloadStrategyJsonExport = useCallback(async () => {
    if (!loggedIn) {
      setBanner("Sign in to download your strategy export.");
      return;
    }
    setStrategyExportBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/strategy/export", { headers: { Authorization: headers.Authorization } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBanner(apiErrorDetail(d as { detail?: unknown }) || "Strategy export failed.");
        return;
      }
      downloadJsonFile(strategyExportFilename("vigil-real-trading-strategy"), d);
      setBanner("Strategy export downloaded (profile + paper autopilot snapshot).");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Export failed");
    } finally {
      setStrategyExportBusy(false);
    }
  }, [loggedIn, headers.Authorization]);

  const onStrategyTemplateSelect = useCallback(
    async (idx: number, value: string) => {
      if (value === UPLOADED_STRATEGY_VALUE) {
        let row: AutopilotStrategy | null = cachedUploadedProfileRow;
        if (!row) row = await refreshUploadedProfileCache();
        if (!row) {
          setBanner(
            "No saved strategy profile yet. Upload a file above and choose Save to Vigil, or use Apply Vigil template from saved profile.",
          );
          return;
        }
        setCachedUploadedProfileRow({ ...row, params: { ...row.params }, pickSource: "uploaded" });
        setStrategies((prev) => {
          const cur = prev[idx];
          if (!cur) return prev;
          const next = [...prev];
          next[idx] = {
            ...cur,
            pickSource: "uploaded",
            template_type: row!.template_type,
            params: { ...row!.params },
            name: row!.name || "From uploaded strategy",
          };
          return next;
        });
        return;
      }
      setStrategies((prev) => {
        const cur = prev[idx];
        if (!cur) return prev;
        const next = [...prev];
        next[idx] = {
          ...cur,
          pickSource: "builtin",
          template_type: value,
          params: { ...(DEFAULT_PARAMS[value] || {}) },
          name: friendlyTemplateName(value),
        };
        return next;
      });
    },
    [cachedUploadedProfileRow, refreshUploadedProfileCache],
  );

  const loadAutopilotForm = useCallback(async () => {
    if (!loggedIn) return;
    try {
      const r = await fetch("/api/coinbase-live/autopilot", { headers: { Authorization: headers.Authorization } });
      if (!r.ok) {
        await refreshUploadedProfileCache();
        return;
      }
      const d = await r.json();
      setApInterval(String(Math.round(d.interval_sec ?? 60)));
      setApLookback(String(d.lookback_hours ?? 168));
      setApBuyUsd(String(d.buy_usd ?? 1000));
      setApSellFrac(String(d.sell_fraction ?? 0.25));
      const strats = d.strategies as AutopilotStrategy[] | undefined;
      if (strats?.length) {
        setStrategies(
          strats.map((s) => {
            const uploaded = isLikelyUploadedStrategyRow(s);
            return {
              ...s,
              params: { ...s.params },
              pickSource: uploaded ? ("uploaded" as const) : ("builtin" as const),
            };
          }),
        );
      } else {
        setStrategies([
          {
            id: `st-${Date.now()}`,
            name: friendlyTemplateName("RSIThresholdReversion"),
            template_type: "RSIThresholdReversion",
            params: { ...DEFAULT_PARAMS.RSIThresholdReversion },
            enabled: true,
            pickSource: "builtin",
          },
        ]);
      }
      await refreshUploadedProfileCache();
    } catch {
      /* ignore */
    }
  }, [loggedIn, headers.Authorization, refreshUploadedProfileCache]);

  useEffect(() => {
    void loadStatus();
    void loadFills();
    void loadAutopilotForm();
  }, [loadStatus, loadFills, loadAutopilotForm]);

  useEffect(() => {
    if (!loggedIn || !status?.linked || !status?.autopilot?.running) return;
    const tick = () => {
      if (liveVigilPollInFlight.current) return;
      liveVigilPollInFlight.current = true;
      void Promise.all([loadStatus(), loadFills()]).finally(() => {
        liveVigilPollInFlight.current = false;
      });
    };
    tick();
    const id = window.setInterval(tick, LIVE_VIGIL_POLL_MS);
    return () => window.clearInterval(id);
  }, [loggedIn, status?.linked, status?.autopilot?.running, loadStatus, loadFills]);

  useEffect(() => {
    if (!loggedIn) {
      setCachedUploadedProfileRow(null);
      setStrategyImportPreview({ ...EMPTY_STRATEGY_IMPORT_PREVIEW });
      setCoinbaseStatusLoading(false);
    }
  }, [loggedIn]);

  useEffect(() => {
    if (!cachedUploadedProfileRow) return;
    setStrategies((prev) =>
      prev.some((s) => s.pickSource === "uploaded")
        ? prev.map((s) =>
            s.pickSource === "uploaded"
              ? {
                  ...s,
                  template_type: cachedUploadedProfileRow.template_type,
                  params: { ...cachedUploadedProfileRow.params },
                  name: cachedUploadedProfileRow.name || "From uploaded strategy",
                }
              : s,
          )
        : prev,
    );
  }, [cachedUploadedProfileRow]);

  useEffect(() => {
    if (status?.product_id) setProductIdDraft(status.product_id);
  }, [status?.product_id]);

  useEffect(() => {
    if (!loggedIn) {
      setTradingGuard(null);
      setCoinbaseStatusUnauthorized(false);
      setStatus(null);
      return;
    }
    void fetchTradingGuard(headers.Authorization)
      .then(setTradingGuard)
      .catch(() => setTradingGuard({ captcha_required: false, turnstile_site_key: "" }));
  }, [loggedIn, headers.Authorization]);

  const saveTradingPair = async () => {
    if (!loggedIn) return;
    const norm = normalizeProductIdInput(productIdDraft);
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/coinbase-live/link/product", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ product_id: norm }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorDetail(d) || "Could not update trading pair");
      setBanner(typeof d.message === "string" ? d.message : `Trading pair set to ${norm}.`);
      await loadStatus();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Could not update trading pair");
    } finally {
      setBusy(false);
    }
  };

  const unlinkAccount = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/coinbase-live/link", { method: "DELETE", headers: { Authorization: headers.Authorization } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorDetail(d) || "Unlink failed");
      setBanner(typeof d.message === "string" ? d.message : "Coinbase unlinked.");
      await loadStatus();
      await loadFills();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAutopilot = async () => {
    if (status?.autopilot?.running) {
      setBanner("Stop live Vigil before saving config.");
      return;
    }
    if (!balanceKnown) {
      setBanner("Refresh status to load GBP balance before saving Live Vigil config.");
      return;
    }
    if (autopilotBuyInvalid) {
      setBanner("Enter a positive GBP amount for buy per signal.");
      return;
    }
    if (typeof gbpAvailable === "number" && exceedsGbpAvailable(apBuyNum, gbpAvailable)) {
      setBanner(`Buy per signal cannot exceed available GBP (${fmtGbp(gbpAvailable)}). Reduce the amount or refresh status.`);
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/coinbase-live/autopilot/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          interval_sec: Number(apInterval) || 60,
          lookback_hours: Number(apLookback) || 168,
          buy_usd: Number(apBuyUsd) || 1000,
          sell_fraction: Number(apSellFrac) || 0.25,
          strategies: strategies.map((s) => ({
            id: s.id,
            name: s.name,
            template_type: s.template_type,
            params: s.params,
            enabled: s.enabled,
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorDetail(d) || "Save failed");
      setBanner("Live Vigil config saved.");
      await loadAutopilotForm();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const startVigil = async (captchaToken?: string): Promise<boolean> => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/coinbase-live/autopilot/start", {
        method: "POST",
        headers,
        body: JSON.stringify(captchaToken ? { captcha_token: captchaToken } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorDetail(d) || "Start failed");
      setBanner(d.message || "Live Vigil started.");
      await loadStatus();
      return true;
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Start failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const stopVigil = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const r = await fetch("/api/coinbase-live/autopilot/stop", { method: "POST", headers: { Authorization: headers.Authorization } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorDetail(d) || "Stop failed");
      setBanner(d.message || "Live Vigil stopped.");
      await loadStatus();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadRealSessionStrategy = useCallback(async () => {
    const t = bearer.trim();
    if (!t) {
      setBanner("Sign in to download your strategy export.");
      return;
    }
    setSessionExportBusy(true);
    try {
      const r = await fetch("/strategy/export", { headers: { Authorization: `Bearer ${t}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBanner(apiErrorDetail(d as { detail?: unknown }) || "Strategy export failed.");
        return;
      }
      downloadJsonFile(strategyExportFilename("vigil-real-trading-strategy"), d);
      setBanner("Updated strategy export downloaded (profile + paper autopilot snapshot).");
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Export failed");
    } finally {
      setSessionExportBusy(false);
    }
  }, [bearer]);

  const finishLiveSession = useCallback(async () => {
    const auth = bearer.trim();
    setSessionEndBusy(true);
    try {
      if (auth) {
        await fetch("/api/coinbase-live/autopilot/stop", {
          method: "POST",
          headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        }).catch(() => {});
      }
      await fetch("/api/paper/halt", { method: "POST" }).catch(() => {});
      if (auth) {
        await fetch("/stop", {
          method: "POST",
          headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {});
      }
      setBanner("Session ended: Live Vigil stopped, paper trading block engaged, full agent stopped if it was running.");
      await loadStatus();
      await loadFills();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "End session failed");
    } finally {
      setSessionEndBusy(false);
    }
  }, [bearer, loadStatus, loadFills]);

  const handleLiveConfirm = async ({ captchaToken }: { captchaToken?: string }) => {
    const ok = await startVigil(captchaToken);
    if (ok) setLiveConfirmOpen(false);
  };

  const running = Boolean(status?.autopilot?.running);
  const gbpAvailable =
    status?.balances != null ? gbpFromBalances(status.balances) : undefined;
  const balanceKnown = useMemo(() => {
    if (!status?.linked) return false;
    if (status.balances_error) return false;
    if (status.balances == null) return false;
    return gbpAvailable !== undefined && Number.isFinite(gbpAvailable);
  }, [status?.linked, status?.balances, status?.balances_error, gbpAvailable]);

  const apBuyNum = parseMoneyInput(apBuyUsd);

  const autopilotBuyExceeds =
    balanceKnown && typeof gbpAvailable === "number" && Number.isFinite(apBuyNum) && exceedsGbpAvailable(apBuyNum, gbpAvailable);

  const autopilotBuyInvalid = !Number.isFinite(apBuyNum) || apBuyNum <= 0;

  const autopilotBuyHint = useMemo(() => {
    if (!status?.linked || !balanceKnown) return null;
    if (autopilotBuyExceeds && typeof gbpAvailable === "number") {
      return `Buy per signal cannot exceed available ${fmtGbp(gbpAvailable)}. Lower the amount or refresh status.`;
    }
    return null;
  }, [status?.linked, balanceKnown, autopilotBuyExceeds, gbpAvailable]);

  useEffect(() => {
    if (!balanceKnown || typeof gbpAvailable !== "number") return;
    setApBuyUsd((prev) => {
      const n = parseMoneyInput(prev);
      if (!Number.isFinite(n) || n <= gbpAvailable + GBP_CAP_EPS) return prev;
      return gbpAvailable.toFixed(2);
    });
  }, [balanceKnown, gbpAvailable]);

  const orgMode = Boolean(status?.org_mode);
  const presetFromEnv = Boolean(status?.preset_from_env);
  const presetPartial = Boolean(status?.preset_env_partial);
  const sharedOrg = Boolean(status?.using_shared_account);
  const orgMisconfigured = Boolean(orgMode && !status?.using_shared_account);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-6 py-24 max-w-4xl space-y-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Real trading (Coinbase)</h1>
          <p className="text-base text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Coinbase Advanced Trade (CDP) credentials are read from{" "}
            <code className="text-xs bg-muted px-1 rounded">backend/.env</code> (
            <code className="text-xs bg-muted px-1 rounded">COINBASE_PRESET_*</code> or organization{" "}
            <code className="text-xs bg-muted px-1 rounded">COINBASE_ORG_*</code>). All signed-in users share that account when preset or org keys
            are set; only one Live Vigil may run at a time. Real orders — not paper trading.
          </p>
        </div>

        {orgMisconfigured && loggedIn ? (
          <Alert variant="destructive">
            <AlertTitle>Organization mode misconfigured</AlertTitle>
            <AlertDescription>
              <code className="text-xs">COINBASE_ORG_TRADING</code> is on but org API keys are missing. Set{" "}
              <code className="text-xs">COINBASE_ORG_API_KEY_ID</code> and{" "}
              <code className="text-xs">COINBASE_ORG_API_KEY_SECRET</code> in backend/.env and restart the server.
            </AlertDescription>
          </Alert>
        ) : null}

        {presetPartial && loggedIn ? (
          <Alert variant="destructive">
            <AlertTitle>Preset Coinbase keys incomplete</AlertTitle>
            <AlertDescription>
              Set both <code className="text-xs">COINBASE_PRESET_API_KEY_ID</code> and{" "}
              <code className="text-xs">COINBASE_PRESET_API_KEY_SECRET</code> in backend/.env, or remove the partial values.
            </AlertDescription>
          </Alert>
        ) : null}

        {coinbaseStatusUnauthorized && loggedIn ? (
          <Alert variant="destructive">
            <AlertTitle>Vigil session expired or invalid</AlertTitle>
            <AlertDescription>
              The app could not load Coinbase status (HTTP 401). Your <code className="text-xs">.env</code> preset keys may already be
              correct — sign out and sign in with Civic again, then tap <strong>Refresh status</strong>. A stale browser token often looks
              like missing Coinbase credentials.
            </AlertDescription>
          </Alert>
        ) : null}

        {banner ? (
          <Alert
            variant={
              banner.includes("failed") ||
              banner.includes("error") ||
              banner.includes("Another user") ||
              banner.toLowerCase().includes("busy")
                ? "destructive"
                : "default"
            }
          >
            <AlertTitle>Notice</AlertTitle>
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        ) : null}

        {!loggedIn ? (
          <VigilAccessGate
            title="Sign in required"
            description="Real Coinbase trading is tied to your Vigil session. Log in with Civic to continue."
            returnTo="/real-trading"
          />
        ) : (
          <>
            <LiveTradingConfirmDialog
              open={liveConfirmOpen}
              onOpenChange={setLiveConfirmOpen}
              guard={tradingGuard}
              busy={busy}
              title="Confirm start Live Vigil"
              confirmLabel="Start Live Vigil"
              onConfirm={handleLiveConfirm}
            />
            {coinbaseStatusLoading && !coinbaseStatusUnauthorized ? (
              <Alert className="border-primary/25 bg-primary/5">
                <AlertTitle>Loading Coinbase status</AlertTitle>
                <AlertDescription className="text-sm text-muted-foreground">
                  Fetching link state, balances, and Live Vigil configuration…
                </AlertDescription>
              </Alert>
            ) : null}
            <CoinbaseLiveMarkets variant="compact" />

            {status?.linked && status.product_id && /-USD$/i.test(status.product_id) ? (
              <Alert>
                <AlertTitle>Trading pair uses USD as quote</AlertTitle>
                <AlertDescription className="text-sm">
                  Live Vigil orders use <span className="font-mono">{status.product_id}</span>. UK accounts usually need{" "}
                  <span className="font-mono">BTC-GBP</span> with a GBP balance on Coinbase.
                  {sharedOrg ? (
                    <>
                      {" "}
                      Set <code className="text-xs bg-muted px-1 rounded">COINBASE_PRESET_PRODUCT_ID=BTC-GBP</code> or{" "}
                      <code className="text-xs bg-muted px-1 rounded">COINBASE_ORG_PRODUCT_ID=BTC-GBP</code> in{" "}
                      <code className="text-xs bg-muted px-1 rounded">backend/.env</code> and restart the backend.
                    </>
                  ) : (
                    <> Use <strong>Save pair</strong> under credentials to switch to BTC-GBP (or the pair Advanced Trade lists for you).</>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Card className="overflow-hidden">
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180"
                  >
                    <div className="min-w-0 space-y-1">
                      <span className="text-base font-semibold leading-none tracking-tight">Coinbase credentials</span>
                      <span className="block text-sm text-muted-foreground">
                        Status, keys, trading pair, and session actions
                      </span>
                    </div>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
                      aria-hidden
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <CardContent className="space-y-4 border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                      {orgMisconfigured
                        ? "COINBASE_ORG_TRADING is enabled but org API keys are missing on the server."
                        : sharedOrg
                          ? presetFromEnv
                            ? "Trading uses COINBASE_PRESET_* from backend/.env."
                            : "Trading uses COINBASE_ORG_* credentials on the server."
                          : coinbaseStatusUnauthorized
                            ? "Sign in again to load status; preset keys in .env are only used after the API accepts your session."
                            : status?.linked
                              ? "This session uses encrypted credentials stored for your account (API link)."
                              : "Add your CDP API key id and private key to backend/.env, then restart the backend."}
                    </p>
                    {sharedOrg ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => void unlinkAccount()} disabled={busy}>
                          Clear my Vigil data
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={busy}>
                          Refresh status
                        </Button>
                      </div>
                    ) : status?.linked ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => void unlinkAccount()} disabled={busy}>
                          Unlink
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={busy}>
                          Refresh status
                        </Button>
                      </div>
                    ) : coinbaseStatusUnauthorized ? (
                      <div className="space-y-3 text-sm text-muted-foreground">
                        <p>
                          After signing in with Civic, use Refresh status. If this keeps appearing, clear site data for
                          this origin or try a private window.
                        </p>
                        <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={busy}>
                          Refresh status
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3 text-sm text-muted-foreground">
                        <p>
                          In <code className="rounded bg-muted px-1 text-xs">Encode_SYS/backend/.env</code> set:
                        </p>
                        <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                          <li>COINBASE_PRESET_API_KEY_ID=…</li>
                          <li>COINBASE_PRESET_API_KEY_SECRET=…</li>
                          <li>
                            COINBASE_PRESET_PRODUCT_ID=BTC-GBP{" "}
                            <span className="font-sans text-muted-foreground">(optional)</span>
                          </li>
                        </ul>
                        <p className="text-xs">
                          If those are already set, restart uvicorn from{" "}
                          <code className="rounded bg-muted px-1">Encode_SYS/backend</code> so the process reloads{" "}
                          <code className="rounded bg-muted px-1">.env</code>.
                        </p>
                        <p className="text-xs">
                          Optional <code className="rounded bg-muted px-1">COINBASE_CREDENTIALS_FERNET_KEY</code> enables{" "}
                          <code className="rounded bg-muted px-1">POST /api/coinbase-live/link</code> instead of preset env
                          keys.
                        </p>
                        <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={busy}>
                          Refresh status
                        </Button>
                      </div>
                    )}
                    {status?.linked ? (
                      <div className="space-y-4 border-t border-border pt-4">
                        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90">
                            Connection
                          </p>
                          <p className="mt-1.5 font-mono text-xs leading-relaxed text-foreground">
                            <span className="font-sans text-muted-foreground">{sharedOrg ? "Shared" : "Linked"}</span>
                            {" · "}
                            key <span className="text-foreground">{status.api_key_id_masked}</span>
                            {" · "}
                            product <span className="text-foreground">{status.product_id}</span>
                          </p>
                        </div>
                        {!sharedOrg ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="min-w-[200px] flex-1 space-y-1">
                                <Label htmlFor="coinbase-product-id">Advanced Trade product</Label>
                                <Input
                                  id="coinbase-product-id"
                                  value={productIdDraft}
                                  onChange={(e) => setProductIdDraft(e.target.value)}
                                  className="font-mono"
                                  placeholder="BTC-GBP"
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={
                                  busy ||
                                  normalizeProductIdInput(productIdDraft) ===
                                    normalizeProductIdInput(status?.product_id || "")
                                }
                                onClick={() => void saveTradingPair()}
                              >
                                Save pair
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Live Vigil trades this pair. Confirm the product above shows{" "}
                              <span className="font-mono">BTC-GBP</span> (or your real pair) before starting automation.
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            To change the trading pair on a server preset, set{" "}
                            <code className="rounded bg-muted px-1 font-mono text-[11px]">COINBASE_PRESET_PRODUCT_ID</code>{" "}
                            or{" "}
                            <code className="rounded bg-muted px-1 font-mono text-[11px]">COINBASE_ORG_PRODUCT_ID</code> in{" "}
                            <code className="rounded bg-muted px-1 font-mono text-[11px]">backend/.env</code> and restart
                            the backend.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>

            {status?.linked ? (
              <Card className="overflow-hidden border-border/80 bg-gradient-to-b from-vigil-surface/45 via-card to-card">
                <CardHeader className="space-y-3 pb-2">
                  <div className="flex gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.06] text-primary shadow-sm"
                      aria-hidden
                    >
                      <Wallet className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <CardTitle className="text-lg font-semibold tracking-tight sm:text-xl">Balances</CardTitle>
                      <CardDescription className="text-xs leading-relaxed sm:text-sm">
                        Available GBP for your Advanced Trade pair ({status.product_id || "BTC-GBP"}). Expand{" "}
                        <strong>Coinbase credentials</strong> and use <strong>Refresh status</strong> after deposits.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-1">
                  {status.balances_error ? (
                    <p className="text-sm text-destructive">{status.balances_error}</p>
                  ) : status.balances ? (
                    <div
                      className={cn(
                        "relative overflow-hidden rounded-2xl border p-5 sm:p-6",
                        "border-primary/20 bg-gradient-to-br from-vigil-surface-elevated/95 via-card to-primary/[0.04]",
                        "shadow-[0_0_0_1px_hsl(var(--primary)/0.08)_inset,0_12px_40px_-24px_hsl(var(--vigil-glow)/0.35)]",
                      )}
                    >
                      <div
                        className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-vigil-glow/25 blur-3xl"
                        aria-hidden
                      />
                      <div
                        className="pointer-events-none absolute -bottom-16 -left-10 h-36 w-48 rounded-full bg-primary/10 blur-3xl"
                        aria-hidden
                      />
                      <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Wallet balance · GBP for {status.product_id || "BTC-GBP"}
                      </p>
                      <p
                        className="relative mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl"
                        title="Available GBP on Coinbase Advanced Trade"
                      >
                        {fmtGbp(gbpFromBalances(status.balances))}
                      </p>
                      <p className="relative mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
                        This is spendable cash on your account — the amount Vigil can allocate when opening buys on your
                        pair (after fees and limits you set elsewhere).
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No balance data yet.</p>
                  )}
                  {status.runtime?.last_error ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      Last runner error: {status.runtime.last_error}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {status?.linked ? (
              <div className="space-y-4">
                <Alert>
                  <AlertTitle>Your strategy → both bots</AlertTitle>
                  <AlertDescription className="text-sm leading-relaxed space-y-2">
                    <p>
                      Upload a file or notes below so Vigil stores <strong>your</strong> rules in the shared profile
                      used on Paper Trading too. When you save, we map the extract to RSI/EMA templates and write them
                      into <strong>Paper Vigil</strong> and <strong>Live Vigil</strong> whenever each autopilot is{" "}
                      <strong>stopped</strong> (same rule as manual config edits).
                    </p>
                    <p>
                      After real fills accumulate, open the Paper Trading performance report for LLM-style comparison between
                      your profile and autonomous activity — that is the &quot;improve over time&quot; loop today (plus
                      strategy chat, which reads the same profile).
                    </p>
                  </AlertDescription>
                </Alert>
                <UniversalStrategyUpload
                  bearer={bearer}
                  onSaved={(info) => {
                    setStrategyImportPreview((prev) => ({
                      userSummary:
                        info?.userSummary !== undefined ? (info.userSummary || "").trim() : prev.userSummary,
                      rawSummary: info?.rawSummary !== undefined ? (info.rawSummary || "").trim() : prev.rawSummary,
                      mappingNote:
                        info?.liveNote !== undefined ? (info.liveNote || "").trim() : prev.mappingNote,
                      universalStrategy:
                        info?.universalStrategy !== undefined ? (info.universalStrategy ?? null) : prev.universalStrategy,
                    }));
                    const suggested = info?.liveStrategies;
                    const hasSuggestion = Boolean(suggested?.length);
                    const livePersisted = info?.autopilotApply?.live?.applied === true;
                    if (hasSuggestion && suggested) {
                      const first = suggested[0];
                      setCachedUploadedProfileRow({
                        ...first,
                        params: { ...first.params },
                        pickSource: "uploaded",
                      });
                      setStrategies(
                        suggested.map((s) => ({
                          ...s,
                          params: { ...s.params },
                          pickSource: "uploaded" as const,
                        })),
                      );
                    }
                    // Refetch only when there is no suggestion to show, or live config was written — otherwise
                    // stale server rows would overwrite the mapped templates (e.g. Live Vigil still running).
                    if (!hasSuggestion || livePersisted) {
                      void loadAutopilotForm();
                    }
                    const ap = info?.autopilotApply;
                    const parts: string[] = [];
                    if (info?.liveNote) parts.push(info.liveNote);
                    if (ap?.paper?.applied) parts.push("Paper Vigil templates updated.");
                    else if (ap?.paper?.reason === "paper_vigil_running") {
                      parts.push("Paper Vigil is running — stop it on Paper Trading, then save again to sync paper templates.");
                    }
                    if (ap?.live?.applied) parts.push("Live Vigil strategies saved for your account.");
                    else if (ap?.live?.reason === "live_vigil_running") {
                      parts.push("Live Vigil is running — stop it, then save again to persist live templates.");
                    }
                    if (parts.length === 0) {
                      parts.push("Strategy profile saved.");
                    }
                    parts.push("Tap Save config below if you change interval, lookback, or sizing.");
                    setBanner(parts.join(" "));
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || running || !loggedIn}
                    onClick={() => void loadLiveAutopilotSuggestion()}
                  >
                    Apply Vigil template from saved profile
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={strategyExportBusy || !loggedIn}
                    onClick={() => void downloadStrategyJsonExport()}
                  >
                    {strategyExportBusy ? "Preparing…" : "Download JSON (readable)"}
                  </Button>
                </div>
              </div>
            ) : null}

            {status?.linked ? (
              <Card>
                <CardHeader>
                  <CardTitle>Live Vigil (automation)</CardTitle>
                  <CardDescription>
                    Executes the RSI/EMA engine below on each tick; orders route to Coinbase with your cash. Pick{" "}
                    <strong>From uploaded strategy</strong> to preview parameters mapped from your saved import, or choose
                    a built-in template. Interval must be ≥ 60s. Stop before editing config.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Interval (sec)</Label>
                      <Input value={apInterval} onChange={(e) => setApInterval(e.target.value)} disabled={busy || running} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Lookback (hours)</Label>
                      <Input value={apLookback} onChange={(e) => setApLookback(e.target.value)} disabled={busy || running} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Buy GBP per signal</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        max={balanceKnown && typeof gbpAvailable === "number" ? gbpAvailable : undefined}
                        value={apBuyUsd}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!balanceKnown || typeof gbpAvailable !== "number") {
                            setApBuyUsd(raw);
                            return;
                          }
                          if (raw === "" || raw === ".") {
                            setApBuyUsd(raw);
                            return;
                          }
                          const n = parseMoneyInput(raw);
                          if (!Number.isFinite(n)) {
                            setApBuyUsd(raw);
                            return;
                          }
                          if (n > gbpAvailable) setApBuyUsd(gbpAvailable.toFixed(2));
                          else setApBuyUsd(raw);
                        }}
                        onBlur={() => {
                          if (!balanceKnown || typeof gbpAvailable !== "number") return;
                          const n = parseMoneyInput(apBuyUsd);
                          if (Number.isFinite(n) && n > gbpAvailable) setApBuyUsd(gbpAvailable.toFixed(2));
                        }}
                        disabled={busy || running}
                        aria-invalid={Boolean(autopilotBuyHint)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Sell fraction of BTC</Label>
                      <Input value={apSellFrac} onChange={(e) => setApSellFrac(e.target.value)} disabled={busy || running} />
                    </div>
                  </div>
                  {autopilotBuyHint ? <p className="text-sm text-destructive">{autopilotBuyHint}</p> : null}

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Strategies</Label>
                      <p className="text-xs text-muted-foreground">
                        One dropdown per row: built-in engines or your saved upload (same RSI/EMA mapping as the server).
                        The box below is the text Vigil stored from your import; the JSON under each row is the
                        executable parameter set for that engine.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5 space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Saved import preview
                      </p>
                      {strategyImportPreview.userSummary.trim() ? (
                        <p className="text-sm leading-relaxed text-foreground">{strategyImportPreview.userSummary}</p>
                      ) : null}
                      {strategyImportPreview.rawSummary.trim() &&
                      strategyImportPreview.rawSummary.trim() !== strategyImportPreview.userSummary.trim() ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Full extract summary
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-muted-foreground leading-relaxed">
                            {strategyImportPreview.rawSummary}
                          </p>
                        </details>
                      ) : null}
                      {strategyImportPreview.mappingNote.trim() ? (
                        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2">
                          <span className="font-medium text-foreground/85">Live mapping: </span>
                          {strategyImportPreview.mappingNote}
                        </p>
                      ) : null}
                      {strategyImportPreview.universalStrategy ? (
                        <div className="rounded-md border border-border/60 bg-background/60 p-3 space-y-1.5 text-xs leading-relaxed border-t border-border/50 pt-3 mt-1">
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                            Structured rules (same shape Vigil uses)
                          </p>
                          <ReadableUniversalFields u={strategyImportPreview.universalStrategy} />
                        </div>
                      ) : null}
                      {!strategyImportPreview.userSummary.trim() &&
                      !strategyImportPreview.rawSummary.trim() &&
                      !strategyImportPreview.mappingNote.trim() &&
                      !strategyImportPreview.universalStrategy ? (
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          No saved import in this session yet. Upload above and choose <strong>Save to Vigil</strong> —
                          your summary and mapping note will show here, matching what{" "}
                          <strong>From uploaded strategy</strong> uses for parameters.
                        </p>
                      ) : null}
                    </div>
                    {strategies.map((s, idx) => (
                      <div
                        key={s.id}
                        className={cn("rounded-lg border border-border/80 p-3 space-y-2", !s.enabled && "opacity-60")}
                      >
                        <div className="flex flex-wrap gap-2 items-center">
                          <input
                            type="checkbox"
                            title="Enable this strategy row"
                            checked={s.enabled}
                            onChange={(e) => {
                              const next = [...strategies];
                              next[idx] = { ...s, enabled: e.target.checked };
                              setStrategies(next);
                            }}
                            disabled={busy || running}
                          />
                          <select
                            className="text-sm border rounded-md px-2 py-1.5 bg-background min-w-[min(100%,260px)] max-w-full grow"
                            value={strategyRowSelectValue(s)}
                            onChange={(e) => void onStrategyTemplateSelect(idx, e.target.value)}
                            disabled={busy || running}
                          >
                            <option value={UPLOADED_STRATEGY_VALUE}>From uploaded strategy</option>
                            {TEMPLATES.map((t) => (
                              <option key={t} value={t}>
                                {friendlyTemplateName(t)} ({t})
                              </option>
                            ))}
                          </select>
                        </div>
                        <Textarea
                          className="font-mono text-xs min-h-[72px]"
                          value={JSON.stringify(s.params, null, 2)}
                          onChange={(e) => {
                            try {
                              const p = JSON.parse(e.target.value) as Record<string, number>;
                              const next = [...strategies];
                              next[idx] = { ...s, params: p };
                              setStrategies(next);
                            } catch {
                              /* keep typing */
                            }
                          }}
                          disabled={busy || running}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Last tick</p>
                    {running &&
                    !(
                      typeof status?.runtime?.last_tick_unix === "number" &&
                      Number.isFinite(status.runtime.last_tick_unix) &&
                      status.runtime.last_tick_unix > 0
                    ) &&
                    !status?.runtime?.last_diagnostics ? (
                      <p className="text-xs text-muted-foreground">Waiting for first scheduler tick…</p>
                    ) : null}
                    {typeof status?.runtime?.last_tick_unix === "number" &&
                    Number.isFinite(status.runtime.last_tick_unix) &&
                    status.runtime.last_tick_unix > 0 ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Time </span>
                        <span className="font-mono text-foreground tabular-nums">
                          {formatDateTimeGb(status.runtime.last_tick_unix)}
                        </span>
                      </p>
                    ) : !running && !status?.runtime?.last_diagnostics ? (
                      <p className="text-xs text-muted-foreground">
                        Diagnostics appear after Live Vigil completes at least one tick.
                      </p>
                    ) : null}
                    {status?.runtime?.last_diagnostics &&
                    typeof status.runtime.last_diagnostics === "object" ? (
                      <div className="space-y-1.5 text-xs font-mono">
                        <p>
                          <span className="text-muted-foreground">action </span>
                          <span className="text-foreground">
                            {String(status.runtime.last_diagnostics.action ?? "—")}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">edges </span>
                          <span className="text-foreground">
                            buy={String(status.runtime.last_diagnostics.buy_edges ?? "—")} sell=
                            {String(status.runtime.last_diagnostics.sell_edges ?? "—")}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">data </span>
                          <span className="text-foreground break-all">
                            {truncateLiveDiagLine(
                              String(status.runtime.last_diagnostics.data_source ?? "—"),
                              200,
                            )}
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">product </span>
                          <span className="text-foreground">
                            {String(status.runtime.last_diagnostics.product_id ?? "—")}
                          </span>
                        </p>
                        {Array.isArray(status.runtime.last_diagnostics.per_strategy) &&
                        status.runtime.last_diagnostics.per_strategy.length > 0 ? (
                          <details className="pt-1 border-t border-border/50">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-[11px]">
                              Strategy signals ({status.runtime.last_diagnostics.per_strategy.length})
                            </summary>
                            <ul className="mt-2 space-y-1 pl-0 list-none">
                              {status.runtime.last_diagnostics.per_strategy.map((row, i) => {
                                const p =
                                  row && typeof row === "object"
                                    ? (row as Record<string, unknown>)
                                    : {};
                                const name =
                                  typeof p.name === "string" && p.name.trim()
                                    ? p.name
                                    : typeof p.id === "string"
                                      ? p.id
                                      : `Row ${i + 1}`;
                                const sig =
                                  p.signal === null || p.signal === undefined ? "—" : String(p.signal);
                                const err =
                                  typeof p.error === "string" && p.error.trim()
                                    ? truncateLiveDiagLine(p.error)
                                    : "";
                                return (
                                  <li key={String(p.id ?? i)} className="text-[11px] leading-relaxed">
                                    <span className="text-foreground">{name}</span>
                                    <span className="text-muted-foreground"> → </span>
                                    <span className="text-foreground">{sig}</span>
                                    {err ? (
                                      <span className="text-destructive"> — {err}</span>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                    {(() => {
                      const rt = status?.runtime;
                      const diag = rt?.last_diagnostics;
                      const te =
                        diag && typeof diag === "object" && typeof diag.trade_error === "string"
                          ? diag.trade_error.trim()
                          : "";
                      const le = typeof rt?.last_error === "string" ? rt.last_error.trim() : "";
                      return (
                        <>
                          {te ? (
                            <p className="text-xs text-amber-700 dark:text-amber-300/95 leading-snug">
                              Trade error: {truncateLiveDiagLine(te, 280)}
                            </p>
                          ) : null}
                          {te && le && le !== te ? (
                            <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                              Runner error: {truncateLiveDiagLine(le, 280)}
                            </p>
                          ) : null}
                          {!te && le ? (
                            <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                              Last runner error: {truncateLiveDiagLine(le, 280)}
                            </p>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void saveAutopilot()}
                      disabled={busy || running || !balanceKnown || autopilotBuyExceeds || autopilotBuyInvalid}
                    >
                      Save config
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setLiveConfirmOpen(true)}
                      disabled={busy || running || !balanceKnown || autopilotBuyExceeds || autopilotBuyInvalid}
                    >
                      Start live Vigil
                    </Button>
                    <Button type="button" variant="destructive" onClick={() => void stopVigil()} disabled={busy || !running}>
                      Stop live Vigil
                    </Button>
                  </div>
                  {running ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                      Live Vigil is running on Coinbase — status refreshes about every {LIVE_VIGIL_POLL_MS / 1000}s while
                      this tab is open.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {status?.linked ? (
              <LiveTradingFloor
                bearer={bearer.trim()}
                running={running}
                fills={fills}
                onRefresh={loadStatus}
                onStop={stopVigil}
              />
            ) : null}

            <Card className="border-destructive/20 bg-card/80">
              <CardHeader>
                <CardTitle className="text-lg">Finish session</CardTitle>
                <CardDescription>
                  Download a JSON snapshot of your imported strategy profile and templates, or end the session: stop Live
                  Vigil, block paper trades and automation, and stop the full agent (same flow as Paper Trading).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2 w-full sm:w-auto"
                  disabled={sessionExportBusy || !bearer.trim()}
                  onClick={() => void downloadRealSessionStrategy()}
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                  {sessionExportBusy ? "Preparing…" : "Download updated strategy"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={sessionEndBusy}
                  onClick={() => void finishLiveSession()}
                >
                  {sessionEndBusy ? "Stopping…" : "End Vigil"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
