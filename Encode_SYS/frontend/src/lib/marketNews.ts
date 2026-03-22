export type MarketArticle = {
  title: string;
  description: string;
  url: string;
  image_url: string;
  published_at: string;
  source: string;
  entities: string[];
};

export type StrategyInsights = {
  summary: string;
  considerations: string[];
  macro_todos: string[];
  asset_todos: string[];
  error: string | null;
};

export type MarketNewsResponse = {
  articles: unknown;
  meta?: Record<string, unknown> | null;
  error: string | null;
  strategy_insights?: unknown;
  detail?: string | string[];
};

/** User-facing message when the HTTP response is not OK (404, stale server, etc.). */
export function describeMarketNewsHttpFailure(
  res: Response,
  data: MarketNewsResponse,
  fallback: string,
): string {
  let msg: string | undefined =
    typeof data.error === "string" && data.error.trim() ? data.error.trim() : undefined;
  if (!msg && res.status === 404) {
    msg =
      "The news API was not found (HTTP 404). Restart the Vigil backend (uvicorn on port 8000) from the current project, or open the site from http://127.0.0.1:8000/.";
  }
  if (!msg && typeof data.detail === "string" && data.detail === "Not found") {
    msg =
      "The news API was not found. Restart the Vigil backend from the current codebase so GET /api/marketaux-news is registered.";
  }
  if (!msg && typeof data.detail === "string") {
    msg = data.detail;
  }
  return msg || fallback;
}

export function parseMarketArticles(raw: unknown): MarketArticle[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketArticle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const entities = Array.isArray(o.entities)
      ? o.entities.filter((x): x is string => typeof x === "string")
      : [];
    out.push({
      title: typeof o.title === "string" ? o.title : "",
      description: typeof o.description === "string" ? o.description : "",
      url: typeof o.url === "string" ? o.url : "#",
      image_url: typeof o.image_url === "string" ? o.image_url : "",
      published_at: typeof o.published_at === "string" ? o.published_at : "",
      source: typeof o.source === "string" ? o.source : "",
      entities,
    });
  }
  return out;
}

export function normalizeStrategyInsights(raw: unknown): StrategyInsights | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const strs = (k: string) =>
    Array.isArray(o[k]) ? o[k]!.filter((x): x is string => typeof x === "string") : [];
  return {
    summary: typeof o.summary === "string" ? o.summary : "",
    considerations: strs("considerations"),
    macro_todos: strs("macro_todos"),
    asset_todos: strs("asset_todos"),
    error: typeof o.error === "string" ? o.error : null,
  };
}

export function marketNewsUrl(limit: number, insights: boolean): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (insights) q.set("insights", "1");
  return `/api/marketaux-news?${q.toString()}`;
}
