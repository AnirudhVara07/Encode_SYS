import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatDateGbFromIso } from "@/lib/dateFormat";
import { cn } from "@/lib/utils";

type StrategyInsights = {
  summary: string;
  considerations: string[];
  macro_todos: string[];
  asset_todos: string[];
  error: string | null;
};

type DemoArticle = {
  title: string;
  description: string;
  url: string;
  image_url: string;
  published_at: string;
  source: string;
  entities: string[];
};

type MarketNewsResponse = {
  articles: unknown[];
  error: string | null;
  strategy_insights?: StrategyInsights;
};

function normalizeInsights(raw: unknown): StrategyInsights | null {
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

function parseArticles(raw: unknown): DemoArticle[] {
  if (!Array.isArray(raw)) return [];
  const out: DemoArticle[] = [];
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

function TodoColumn({
  title,
  description,
  items,
  idPrefix,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  items: string[];
  idPrefix: string;
  checked: Record<string, boolean>;
  onToggle: (id: string, v: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Card className="border-border/80 bg-vigil-surface/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {items.map((text, i) => {
          const id = `${idPrefix}-${i}`;
          return (
            <div key={id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/40 p-3">
              <Checkbox
                id={id}
                checked={checked[id] ?? false}
                onCheckedChange={(v) => onToggle(id, v === true)}
                className="mt-0.5"
              />
              <Label htmlFor={id} className="text-sm font-normal leading-snug cursor-pointer text-foreground/90">
                {text}
              </Label>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Demo: MarketAux headlines on load; OpenRouter-backed AI summary only after "Get summary".
 */
const DemoAiNewsPanel = () => {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [articles, setArticles] = useState<DemoArticle[]>([]);
  const [insights, setInsights] = useState<StrategyInsights | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryFetchError, setSummaryFetchError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryFetchError(null);
    try {
      const res = await fetch("/api/marketaux-news?limit=12&insights=1");
      const data = (await res.json()) as MarketNewsResponse;
      // #region agent log
      {
        const rawSi = data.strategy_insights;
        const normProbe = normalizeInsights(rawSi);
        fetch("http://127.0.0.1:7525/ingest/58246f49-c20a-4cf3-8c2c-5b5ed0515952", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "16c4fd" },
          body: JSON.stringify({
            sessionId: "16c4fd",
            runId: "pre",
            hypothesisId: "H1",
            location: "DemoAiNewsPanel.tsx:afterSummaryFetch",
            message: "summary fetch parsed",
            data: {
              ok: res.ok,
              topError: typeof data.error === "string" ? data.error.length : -1,
              hasSiKey: Object.prototype.hasOwnProperty.call(data, "strategy_insights"),
              rawSiType: rawSi === undefined ? "undefined" : rawSi === null ? "null" : typeof rawSi,
              normIsNull: normProbe === null,
              summaryLen: normProbe?.summary?.length ?? -1,
              siErrorLen: normProbe?.error ? normProbe.error.length : 0,
              macroN: normProbe?.macro_todos?.length ?? -1,
              assetN: normProbe?.asset_todos?.length ?? -1,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      if (!res.ok) {
        setSummaryFetchError(typeof data.error === "string" ? data.error : "Could not load AI summary.");
        return;
      }
      if (data.error) {
        setSummaryFetchError(data.error);
        return;
      }
      setInsights(normalizeInsights(data.strategy_insights));
    } catch {
      setSummaryFetchError("Could not load AI summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch("/api/marketaux-news?limit=12");
        const data = (await res.json()) as MarketNewsResponse;
        if (cancelled) return;
        if (!res.ok) {
          setArticles([]);
          setInsights(null);
          setFetchError(typeof data.error === "string" ? data.error : "Could not load news briefing.");
          return;
        }
        if (data.error) {
          setArticles([]);
          setInsights(null);
          setFetchError(data.error);
          return;
        }
        setArticles(parseArticles(data.articles));
      } catch {
        if (!cancelled) {
          setArticles([]);
          setInsights(null);
          setFetchError("Could not load news briefing.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = (id: string, v: boolean) => {
    setChecked((prev) => ({ ...prev, [id]: v }));
  };

  return (
    <section className="px-6 pb-10 scroll-mt-24" aria-label="AI summary and market headlines for Vigil demo" id="demo-ai-news">
      <div className="container mx-auto max-w-5xl space-y-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-primary">Relevant markets &amp; macro</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">AI summary &amp; headlines</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Filtered financial headlines (MarketAux) plus a ChatGPT-class <strong className="font-medium text-foreground/80">AI summary</strong> of the
            set, demo only, not advice.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border bg-vigil-surface/60 p-10 text-center text-sm text-muted-foreground animate-pulse">
            Loading headlines…
          </div>
        ) : fetchError ? (
          <Card className="border-destructive/30 bg-vigil-surface/60">
            <CardContent className="pt-6 text-sm text-muted-foreground">{fetchError}</CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {articles.length > 0 ? (
              <div className="rounded-2xl border border-primary/25 bg-vigil-surface/80 p-6 sm:p-8 space-y-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">AI lens</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">AI summary</h3>
                </div>
                {insights === null && !summaryLoading ? (
                  <Button type="button" className="w-fit" onClick={() => void fetchSummary()}>
                    Get summary
                  </Button>
                ) : null}
                {summaryLoading ? (
                  <p className="text-sm text-muted-foreground animate-pulse">Generating summary…</p>
                ) : null}
                {summaryFetchError ? <p className="text-sm text-destructive/90">{summaryFetchError}</p> : null}
                {insights ? (
                  <>
                    {insights.error ? (
                      <p className="text-sm text-muted-foreground">{insights.error}</p>
                    ) : null}
                    {insights.summary ? (
                      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{insights.summary}</p>
                    ) : null}

                    <div
                      className={cn(
                        "grid gap-4",
                        insights.macro_todos.length > 0 && insights.asset_todos.length > 0 ? "md:grid-cols-2" : "",
                      )}
                    >
                      <TodoColumn
                        title="Macro checklist"
                        description="Rates, inflation, policy, FX, liquidity, tick off as you review your run."
                        items={insights.macro_todos}
                        idPrefix="macro"
                        checked={checked}
                        onToggle={onToggle}
                      />
                      <TodoColumn
                        title="Assets &amp; markets checklist"
                        description="Symbols, sectors, and instruments surfaced in the news set."
                        items={insights.asset_todos}
                        idPrefix="asset"
                        checked={checked}
                        onToggle={onToggle}
                      />
                    </div>

                    {insights.considerations.length > 0 ? (
                      <Card className="border-border/80 bg-vigil-surface/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Strategy angles</CardTitle>
                          <CardDescription>Extra considerations for Pine / paper workflows</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                            {insights.considerations.map((c, i) => (
                              <li key={i} className="leading-relaxed">
                                {c}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    ) : null}

                    {!insights.summary &&
                    insights.macro_todos.length === 0 &&
                    insights.asset_todos.length === 0 &&
                    !insights.error ? (
                      <p className="text-sm text-muted-foreground">No AI output, add OPENROUTER_API_KEY in backend/.env and try again.</p>
                    ) : null}
                    {!summaryLoading ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void fetchSummary()}>
                        Refresh summary
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {articles.length > 0 ? (
              <div>
                <h3 className="text-lg font-semibold tracking-tight mb-4">Headlines</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {articles.map((a, i) => (
                    <Card key={`${a.url}-${i}`} className="border-border/80 bg-vigil-surface/50 overflow-hidden flex flex-col">
                      {a.image_url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-[2/1] overflow-hidden bg-muted"
                        >
                          <img src={a.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </a>
                      ) : null}
                      <CardHeader className="pb-2">
                        <CardDescription className="font-mono text-[11px] uppercase tracking-wide">
                          {a.source}
                          {a.published_at ? ` · ${formatDateGbFromIso(a.published_at)}` : ""}
                        </CardDescription>
                        <CardTitle className="text-base leading-snug">
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                          >
                            {a.title || "Untitled"}
                          </a>
                        </CardTitle>
                      </CardHeader>
                      {a.description ? (
                        <CardContent className="pt-0">
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{a.description}</p>
                          {a.entities.length > 0 ? (
                            <p
                              className="mt-2 text-[11px] text-muted-foreground font-mono truncate"
                              title={a.entities.join(", ")}
                            >
                              {a.entities.join(" · ")}
                            </p>
                          ) : null}
                        </CardContent>
                      ) : null}
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No headlines returned.</p>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground font-mono">
          News data from{" "}
          <a
            href="https://www.marketaux.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            MarketAux
          </a>
        </p>
      </div>
    </section>
  );
};

export default DemoAiNewsPanel;
