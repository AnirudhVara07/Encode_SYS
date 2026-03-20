from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any, Dict, Optional
import requests


@dataclass(frozen=True)
class CoinbaseOrderResponse:
    success: bool
    raw: Dict[str, Any]


def create_market_ioc_order_sandbox(
    *,
    product_id: str,
    side: str,
    base_size_btc: float,
    client_order_id: Optional[str] = None,
    bearer_jwt: Optional[str] = None,
    sandbox_base_url: str = "https://api-sandbox.coinbase.com",
    timeout_s: float = 30.0,
) -> CoinbaseOrderResponse:
    """
    Places an Advanced Trade market IOC order in Coinbase's sandbox.

    Request schema (per Coinbase docs):
      POST /api/v3/brokerage/orders
      Authorization: Bearer <JWT> (JWT signed using CDP API Key secret)
      Body includes: client_order_id, product_id, side, order_configuration.market_market_ioc.base_size
    """
    if side not in {"BUY", "SELL"}:
        raise ValueError("side must be BUY or SELL")
    if base_size_btc <= 0:
        raise ValueError("base_size_btc must be > 0")

    order_id = client_order_id or f"vigil-demo-{int(time.time())}"
    url = f"{sandbox_base_url}/api/v3/brokerage/orders"

    payload: Dict[str, Any] = {
        "client_order_id": order_id,
        "product_id": product_id,
        "side": side,
        "order_configuration": {
            "market_market_ioc": {
                # Coinbase expects string quantities for size fields.
                "base_size": str(base_size_btc),
            }
        },
    }

    headers = {"Content-Type": "application/json"}
    if bearer_jwt:
        headers["Authorization"] = f"Bearer {bearer_jwt}"

    # If no auth token is supplied, keep the demo safe and predictable.
    if not bearer_jwt:
        return CoinbaseOrderResponse(
            success=True,
            raw={
                "success": True,
                "mock": True,
                "note": "No Coinbase bearer JWT provided; demo skipped actual order submission.",
                "request": payload,
            },
        )

    res = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout_s)
    try:
        data = res.json()
    except Exception:
        data = {"success": False, "status_code": res.status_code, "text": res.text[:500]}

    # Coinbase typically includes a `success` boolean.
    success = bool(data.get("success", False))
    return CoinbaseOrderResponse(success=success, raw=data)

