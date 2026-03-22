import { useEffect, useMemo, useState } from "react";

const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com";

export type CoinbaseTick = {
  productId: string;
  price: number;
  open24h: number;
  bestBid: number;
  bestAsk: number;
  time: string;
};

export type CoinbaseFeedStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

function parseTickerMessage(raw: unknown): CoinbaseTick | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "ticker" || typeof m.product_id !== "string") return null;
  const price = Number(m.price);
  const open24h = Number(m.open_24h);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    productId: m.product_id,
    price,
    open24h: Number.isFinite(open24h) ? open24h : price,
    bestBid: Number(m.best_bid),
    bestAsk: Number(m.best_ask),
    time: typeof m.time === "string" ? m.time : "",
  };
}

/**
 * Subscribes to Coinbase Exchange public ticker channel (no API key).
 * Note: Coinbase lists crypto spot pairs (e.g. BTC-GBP), not traditional equities.
 */
export function useCoinbaseTicker(productIds: readonly string[]) {
  const [ticks, setTicks] = useState<Record<string, CoinbaseTick>>({});
  const [status, setStatus] = useState<CoinbaseFeedStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const key = useMemo(() => [...productIds].sort().join(","), [productIds]);

  useEffect(() => {
    const ids = key.split(",").filter(Boolean);
    if (ids.length === 0) {
      setTicks({});
      setStatus("idle");
      return;
    }

    setTicks({});

    let ws: WebSocket | null = null;
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimer = () => {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const connect = () => {
      if (cancelled) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      setLastError(null);

      try {
        ws = new WebSocket(COINBASE_WS);
      } catch (e) {
        setStatus("error");
        setLastError(e instanceof Error ? e.message : "WebSocket failed");
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setStatus("live");
        ws?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: ids,
            channels: ["ticker"],
          }),
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as unknown;
          const tick = parseTickerMessage(msg);
          if (!tick) return;
          setTicks((prev) => ({ ...prev, [tick.productId]: tick }));
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        if (!cancelled) setLastError("Feed connection error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        ws = null;
        setStatus("error");
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearTimer();
      const delay = Math.min(30_000, 800 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        ws?.close();
        ws = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      cancelled = true;
      clearTimer();
      ws?.close();
      ws = null;
    };
  }, [key]);

  return { ticks, status, lastError };
}
