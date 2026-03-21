from __future__ import annotations

import time
from typing import Any, Dict, Tuple

import requests

# Public Coinbase API — no auth required.
DEFAULT_SPOT_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot"


def fetch_btc_usd_spot(
    *,
    url: str = DEFAULT_SPOT_URL,
    timeout_s: float = 15.0,
) -> Tuple[float, Dict[str, Any]]:
    """
    Returns (price_usd_per_btc, raw_payload_snippet).

    Raises requests.RequestException or ValueError on failure.
    """
    res = requests.get(url, timeout=timeout_s)
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
