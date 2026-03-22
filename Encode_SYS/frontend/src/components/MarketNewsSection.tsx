import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTimeGb } from "@/lib/dateFormat";
import {
  describeMarketNewsHttpFailure,
  marketNewsUrl,
  normalizeStrategyInsights,
  parseMarketArticles,
  type MarketArticle,
  type MarketNewsResponse,
  type StrategyInsights,
} from "@/lib/marketNews";
import { cn } from "@/lib/utils";
import { useScrollReveal } from "./useScrollReveal";

function formatWhen(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTimeGb(d);
}

type MarketNewsSectionProps = {
  /** e.g. tighter top when placed directly under live prices */
  className?: string;
};

const MarketNewsSection = ({ className }: MarketNewsSectionProps) => {
  const { ref, isVisible } = useScrollReveal();
  const [articles, setArticles] = useState<MarketArticle[]>([]);
  const [insights, setInsights] = useState<StrategyInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryFetchError, setSummaryFetchError] = useState<string | null>(null);
  const [moreNewsOpen, setMoreNewsOpen] = useState(false);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryFetchError(null);
    try {
      const res = await fetch(marketNewsUrl(12, true));
      const data = (await res.json()) as MarketNewsResponse;
      if (!res.ok) {
        setSummaryFetchError(describeMarketNewsHttpFailure(res, data, "Could not load AI summary."));
        return;
      }
      if (data.error) {
        setSummaryFetchError(data.error);
        return;
      }
      setInsights(normalizeStrategyInsights(data.strategy_insights));
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
      setError(null);
      try {
        const res = await fetch(marketNewsUrl(12, false));
        const data = (await res.json()) as MarketNewsResponse;
        if (cancelled) return;
        if (!res.ok) {
          setArticles([]);
          setInsights(null);
          setError(describeMarketNewsHttpFailure(res, data, "Could not load news."));
          return;
        }
        if (data.error) {
          setArticles([]);
          setInsights(null);
          setError(data.error);
          return;
        }
        setArticles(parseMarketArticles(data.articles));
      } catch {
        if (!cancelled) {
          setArticles([]);
          setInsights(null);
          setError("Could not load news.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMoreNewsOpen(false);
  }, [articles]);

  return (
    <section
      id="market-news"
      className={cn("relative py-32 px-6 scroll-mt-24", className)}
      ref={ref}
    >
      <div className="container mx-auto max-w-5xl">
        <div
          className={`text-center mb-8 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
        >
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-primary">Markets</span>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight">Current headlines</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-xl mx-auto">
            Market and macro-leaning headlines covering equities, indices, ETFs, funds, FX, and crypto. Powered by
            MarketAux.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border bg-vigil-surface/60 p-10 text-center text-sm text-muted-foreground animate-pulse">
            Loading news…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-vigil-surface/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            {/MARKETAUX_API_TOKEN|MARKETAUX.*not configured|invalid_api_token/i.test(error) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Set <code className="font-mono text-[11px]">MARKETAUX_API_TOKEN</code> in{" "}
                <code className="font-mono text-[11px]">backend/.env</code> and restart the server.
              </p>
            ) : null}
            {/stale or mismatched|Restart uvicorn|not available on the running server|HTTP 404/i.test(error) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                If you use Vite on port 8080, keep the API running on 8000. After <code className="font-mono text-[11px]">git pull</code>, always restart uvicorn so new routes load.
              </p>
            ) : null}
          </div>
        ) : articles.length === 0 ? (
          <div className="rounded-2xl border border-border bg-vigil-surface/60 p-8 text-center text-sm text-muted-foreground">
            No articles returned.
          </div>
        ) : (
          <>
            <div className="mb-8 rounded-2xl border border-primary/25 bg-vigil-surface/80 p-6 sm:p-8">
              <h3 className="text-lg font-semibold tracking-tight">AI summary</h3>
              {insights === null && !summaryLoading ? (
                <Button type="button" className="mt-4 w-fit" onClick={() => void fetchSummary()}>
                  Get summary
                </Button>
              ) : null}
              {summaryLoading ? (
                <p className="mt-4 text-sm text-muted-foreground animate-pulse">Generating summary…</p>
              ) : null}
              {summaryFetchError ? <p className="mt-3 text-sm text-destructive/90">{summaryFetchError}</p> : null}
              {insights ? (
                <>
                  {insights.error ? (
                    <p className="mt-3 text-sm text-muted-foreground">{insights.error}</p>
                  ) : null}
                  {insights.summary ? (
                    <p className="mt-4 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{insights.summary}</p>
                  ) : null}
                  {insights.considerations.length > 0 ? (
                    <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
                      {insights.considerations.map((c, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {c}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!summaryLoading ? (
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void fetchSummary()}>
                      Refresh summary
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {articles.slice(0, 2).map((a, i) => (
                <article
                  key={`${a.url}-${i}`}
                  className={`group rounded-2xl border border-border bg-vigil-surface/60 overflow-hidden flex flex-col transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
                  style={{ transitionDelay: `${Math.min(i, 5) * 80}ms` }}
                >
                  {a.image_url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-[2/1] overflow-hidden bg-muted"
                    >
                      <img
                        src={a.image_url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  <div className="p-5 flex flex-col flex-1 min-h-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground font-mono uppercase tracking-wide">
                      {a.source ? <span>{a.source}</span> : null}
                      {a.source && a.published_at ? <span aria-hidden>·</span> : null}
                      {a.published_at ? <time dateTime={a.published_at}>{formatWhen(a.published_at)}</time> : null}
                    </div>
                    <h3 className="mt-2 text-base font-semibold leading-snug">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors"
                      >
                        {a.title || "Untitled"}
                      </a>
                    </h3>
                    {a.description ? (
                      <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-3">{a.description}</p>
                    ) : null}
                    {a.entities.length > 0 ? (
                      <p className="mt-3 text-[11px] text-muted-foreground font-mono truncate" title={a.entities.join(", ")}>
                        {a.entities.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {articles.length > 2 ? (
              <>
                {!moreNewsOpen ? (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setMoreNewsOpen(true)}
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      View more
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    </button>
                  </div>
                ) : null}

                <div
                  className={cn(
                    "overflow-hidden transition-[max-height,opacity] duration-500 ease-out motion-reduce:transition-none",
                    moreNewsOpen ? "max-h-[min(120rem,200vh)] opacity-100" : "max-h-0 opacity-0",
                  )}
                  aria-hidden={!moreNewsOpen}
                >
                  {articles[2] ? (
                    <article
                      key={`${articles[2].url}-2`}
                      className={`group mt-4 rounded-2xl border border-border bg-vigil-surface/60 overflow-hidden flex flex-col transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}`}
                    >
                      {articles[2].image_url ? (
                        <a
                          href={articles[2].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-[2/1] overflow-hidden bg-muted sm:aspect-[3/1]"
                        >
                          <img
                            src={articles[2].image_url}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        </a>
                      ) : null}
                      <div className="p-5 flex flex-col flex-1 min-h-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground font-mono uppercase tracking-wide">
                          {articles[2].source ? <span>{articles[2].source}</span> : null}
                          {articles[2].source && articles[2].published_at ? <span aria-hidden>·</span> : null}
                          {articles[2].published_at ? (
                            <time dateTime={articles[2].published_at}>{formatWhen(articles[2].published_at)}</time>
                          ) : null}
                        </div>
                        <h3 className="mt-2 text-base font-semibold leading-snug">
                          <a
                            href={articles[2].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                          >
                            {articles[2].title || "Untitled"}
                          </a>
                        </h3>
                        {articles[2].description ? (
                          <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-3">
                            {articles[2].description}
                          </p>
                        ) : null}
                        {articles[2].entities.length > 0 ? (
                          <p
                            className="mt-3 text-[11px] text-muted-foreground font-mono truncate"
                            title={articles[2].entities.join(", ")}
                          >
                            {articles[2].entities.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ) : null}
                </div>

                {moreNewsOpen ? (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setMoreNewsOpen(false)}
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      View less
                      <ChevronUp className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}

        <p className="mt-4 text-center text-[11px] text-muted-foreground font-mono">
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

export default MarketNewsSection;
