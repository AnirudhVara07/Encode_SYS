"""
Replay Vigil-style edge voting over historical hourly candles (default 7 days).
Stateless — does not mutate the live paper portfolio.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import requests

from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from .performance import enrich_fills_newest_first, summarize_fills
from .signals import compute_latest_execution_signal


def _default_strategies() -> List[Dict[str, Any]]:
    return [
        {
            "id": "bt-rsi",
            "name": "RSI reversion",
            "template_type": "RSIThresholdReversion",
            "params": {"rsi_len": 14.0, "rsi_lower": 30.0, "rsi_upper": 70.0},
            "enabled": True,
        },
    ]


def replay_vigil_backtest(
    *,
    lookback_hours: int = 168,
    starting_usdc: float = 10_000.0,
    buy_usd: float = 1_000.0,
    sell_fraction: float = 0.25,
    strategies: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    if lookback_hours < 24 or lookback_hours > 720:
        raise ValueError("lookback_hours must be 24–720")
    if starting_usdc <= 0:
        raise ValueError("starting_usdc must be > 0")

    try:
        candles = fetch_coinbase_candles_btc_usd(lookback_hours=lookback_hours)
        data_source = "coinbase_sandbox"
    except (ValueError, requests.exceptions.RequestException) as e:
        candles = generate_synthetic_candles_btc_usd(lookback_hours=lookback_hours, seed=42)
        data_source = f"synthetic_fallback:{e}"

    candles = sorted(candles, key=lambda c: int(c.get("start") or c.get("timestamp") or 0))
    if len(candles) < 50:
        raise ValueError("Not enough candles for backtest")

    strat_specs = strategies if strategies else _default_strategies()
    enabled = [s for s in strat_specs if s.get("enabled", True)]
    if not enabled:
        raise ValueError("At least one enabled strategy required")

    rows: List[Dict[str, Any]] = []
    for s in enabled:
        rows.append(
            {
                "id": str(s.get("id") or uuid.uuid4()),
                "name": str(s.get("name") or "strategy"),
                "template_type": str(s.get("template_type") or ""),
                "params": {k: float(v) for k, v in dict(s.get("params") or {}).items()},
                "enabled": True,
            }
        )

    last_sig: Dict[str, Optional[str]] = {r["id"]: None for r in rows}
    usdc = float(starting_usdc)
    btc = 0.0
    fills: List[Dict[str, Any]] = []
    equity: List[Dict[str, Any]] = []

    def snap_equity(ts: float, price: float) -> None:
        eq = usdc + btc * price
        equity.append(
            {
                "t": ts,
                "usd_equity": round(eq, 8),
                "equity_usdc": round(eq, 8),
                "btc_price": round(price, 4),
                "btc_holdings": round(btc, 12),
                "usdc_cash": round(usdc, 8),
            }
        )

    min_i = 40
    p0 = float(candles[min_i - 1]["close"])
    t0 = float(candles[min_i - 1].get("start") or time.time())
    snap_equity(t0, p0)

    for i in range(min_i, len(candles)):
        window = candles[: i + 1]
        price = float(window[-1]["close"])
        ts = int(window[-1].get("start") or window[-1].get("timestamp") or time.time())
        buy_edges = 0
        sell_edges = 0
        per: List[Dict[str, Any]] = []
        new_last = dict(last_sig)
        for r in rows:
            prev = new_last.get(r["id"])
            try:
                cur = compute_latest_execution_signal(
                    template_type=r["template_type"],
                    candles_raw=window,
                    best_params=r["params"],
                )
            except Exception as e:
                per.append({"id": r["id"], "signal": None, "error": str(e)})
                new_last[r["id"]] = prev
                continue
            per.append({"id": r["id"], "signal": cur})
            if cur == "BUY" and prev != "BUY":
                buy_edges += 1
            if cur == "SELL" and prev != "SELL":
                sell_edges += 1
            new_last[r["id"]] = cur

        reasoning = (
            f"Backtest bar {i}: buy_edges={buy_edges} sell_edges={sell_edges} "
            + "; ".join(f"{p['id']}={p.get('signal')}" for p in per)
        )
        last_sig = new_last

        if buy_edges > sell_edges and buy_usd <= usdc + 1e-12:
            qty = buy_usd / price
            usdc -= buy_usd
            btc += qty
            fills.append(
                {
                    "id": str(uuid.uuid4()),
                    "side": "buy",
                    "btc": round(qty, 12),
                    "usd": round(buy_usd, 8),
                    "price": price,
                    "entry_price": price,
                    "exit_price": None,
                    "ts": float(ts),
                    "reasoning": reasoning,
                    "execution_mode": "backtest",
                    "quote_currency": "GBP",
                }
            )
        elif sell_edges > buy_edges and btc > 1e-18:
            sell_btc = btc * sell_fraction
            proceeds = sell_btc * price
            btc -= sell_btc
            usdc += proceeds
            fills.append(
                {
                    "id": str(uuid.uuid4()),
                    "side": "sell",
                    "btc": round(sell_btc, 12),
                    "usd": round(proceeds, 8),
                    "price": price,
                    "entry_price": None,
                    "exit_price": price,
                    "ts": float(ts),
                    "reasoning": reasoning,
                    "execution_mode": "backtest",
                    "quote_currency": "GBP",
                }
            )

        snap_equity(float(ts), price)

    fills_nf = list(reversed(fills))
    fills_enriched = enrich_fills_newest_first(fills_nf)
    summary = summarize_fills(
        fills_newest_first=fills_nf,
        starting_quote_usdc=starting_usdc,
        equity_curve=equity,
        label="Backtest",
    )
    strategies_snapshot = [
        {
            "id": r["id"],
            "name": r["name"],
            "template_type": r["template_type"],
            "params": dict(r["params"]),
            "enabled": bool(r.get("enabled", True)),
        }
        for r in rows
    ]
    return {
        "kind": "backtest",
        "lookback_hours": lookback_hours,
        "data_source": data_source,
        "fills": fills_enriched[:200],
        "summary": summary,
        "strategies": strategies_snapshot,
    }
