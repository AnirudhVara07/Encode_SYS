from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

import requests

# Public Coinbase API — no auth required.
DEFAULT_SPOT_PAIR = "BTC-GBP"


def _spot_url(pair: str) -> str:
    p = (pair or DEFAULT_SPOT_PAIR).strip() or DEFAULT_SPOT_PAIR
    return f"https://api.coinbase.com/v2/prices/{p}/spot"


DEFAULT_SPOT_URL = _spot_url(DEFAULT_SPOT_PAIR)


def fetch_btc_usd_spot(
    *,
    url: Optional[str] = None,
    pair: str = DEFAULT_SPOT_PAIR,
    timeout_s: float = 15.0,
) -> Tuple[float, Dict[str, Any]]:
    """
    Returns (spot price per BTC in the pair's quote currency, raw_payload_snippet).

    Default pair is BTC-GBP (quote in GBP). The function name is historical.

    Raises requests.RequestException or ValueError on failure.
    """
    effective = (url or "").strip() or _spot_url(pair)
    res = requests.get(effective, timeout=timeout_s)
    res.raise_for_status()
    payload = res.json()
    data = payload.get("data") or {}
    amount = data.get("amount")
    if amount is None:
        raise ValueError(f"Unexpected spot response shape: {payload!r}")
    price = float(amount)
    if price <= 0:
        raise ValueError(f"Invalid spot price: {price}")
    meta = {
        "base": data.get("base"),
        "currency": data.get("currency"),
        "fetched_at_unix": time.time(),
        "source": "coinbase_v2_spot",
    }
    return price, meta
