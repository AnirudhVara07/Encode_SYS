"""BTC-USD hourly candles from Coinbase sandbox API, with synthetic fallback for demos."""

from __future__ import annotations

import json
import math
import random
import time
from typing import Any, Dict, List, Optional

import requests


def parse_candles_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and "candles" in payload and isinstance(payload["candles"], list):
        return payload["candles"]
    raise ValueError("Unexpected candles payload format from Coinbase")


def fetch_coinbase_candles_btc_usd(
    *,
    product_id: str = "BTC-USD",
    lookback_hours: int = 168,
    granularity: str = "ONE_HOUR",
    limit: int = 350,
    sandbox_base_url: str = "https://api-sandbox.coinbase.com",
) -> List[Dict[str, Any]]:
    end = int(time.time())
    start = end - int(lookback_hours * 3600)

    url = f"{sandbox_base_url}/api/v3/brokerage/products/{product_id}/candles"
    params = {
        "start": str(start),
        "end": str(end),
        "granularity": granularity,
        "limit": str(limit),
    }

    res = requests.get(url, params=params, timeout=30)
    text = (res.text or "").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        try:
            payload, _ = json.JSONDecoder().raw_decode(text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse Coinbase candles JSON: {e}") from e

    if not res.ok:
        raise ValueError(f"Coinbase candles request failed: {payload}")

    candles = parse_candles_payload(payload)
    normalized: List[Dict[str, Any]] = []
    for c in candles:
        normalized.append(
            {
                "start": c.get("start") or c.get("timestamp"),
                "open": float(c["open"]),
                "high": float(c["high"]),
                "low": float(c["low"]),
                "close": float(c["close"]),
                "volume": float(c.get("volume") or 0.0),
            }
        )
    return normalized


def generate_synthetic_candles_btc_usd(
    *,
    lookback_hours: int = 168,
    granularity: str = "ONE_HOUR",
    limit: int = 350,
    seed: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Deterministic fallback candles so the demo can run even when Coinbase is unreachable.
    """
    candle_seconds = 3600
    if granularity == "ONE_HOUR":
        candle_seconds = 3600
    elif granularity == "FIVE_MINUTE":
        candle_seconds = 300
    elif granularity == "ONE_DAY":
        candle_seconds = 86400

    bars = min(limit, max(10, int((lookback_hours * 3600) / candle_seconds)))
    end = int(time.time())
    start = end - bars * candle_seconds

    rng = random.Random(seed if seed is not None else start)

    price = 50000.0
    candles: List[Dict[str, Any]] = []
    vol_regime = 1.0
    for i in range(bars):
        ts = start + i * candle_seconds
        o = price
        vol_regime = max(0.45, min(2.4, vol_regime * 0.92 + rng.uniform(0.08, 0.28)))
        if rng.random() < 0.14:
            ret = rng.gauss(-0.0001, 0.028 * vol_regime)
        elif rng.random() < 0.08:
            ret = rng.gauss(0.0003, 0.018 * vol_regime)
        else:
            ret = rng.gauss(0.0002, 0.0085 * vol_regime)
        if i > 0 and i % 19 == 0:
            ret += rng.choice([-1.0, 1.0]) * abs(rng.gauss(0.0, 0.022 * vol_regime))
        ret += 0.009 * math.sin(i / 5.8)
        c = max(0.01, o * (1.0 + ret))

        base_spread = abs(c - o)
        spread = base_spread * rng.uniform(0.2, 1.2) + o * rng.uniform(0.0001, 0.001)
        hi = max(o, c) + spread * rng.uniform(0.1, 1.0)
        lo = min(o, c) - spread * rng.uniform(0.1, 1.0)
        lo = max(0.0001, lo)

        candles.append(
            {
                "start": ts,
                "open": float(o),
                "high": float(hi),
                "low": float(lo),
                "close": float(c),
                "volume": float(rng.uniform(10.0, 500.0)),
            }
        )
        price = c

    return candles
