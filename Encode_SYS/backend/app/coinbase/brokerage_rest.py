from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional
import requests

log = logging.getLogger("vigil.coinbase_rest")

from .cdp_jwt import _PROD_HOST, _SANDBOX_HOST, build_rest_jwt


@dataclass(frozen=True)
class CoinbaseOrderResponse:
    success: bool
    raw: Dict[str, Any]


def _request_jwt(
    api_key_id: str,
    api_key_secret: str,
    *,
    method: str,
    path: str,
    host: str,
) -> str:
    return build_rest_jwt(
        api_key_id=api_key_id,
        api_key_secret=api_key_secret,
        request_method=method,
        request_path=path,
        host=host,
    )


def create_market_ioc_order(
    *,
    base_url: str,
    product_id: str,
    side: str,
    base_size: float,
    api_key_id: str,
    api_key_secret: str,
    client_order_id: Optional[str] = None,
    timeout_s: float = 30.0,
) -> CoinbaseOrderResponse:
    """
    Advanced Trade market IOC. base_size is base currency units (e.g. BTC for BTC-GBP).
    """
    if side not in {"BUY", "SELL"}:
        raise ValueError("side must be BUY or SELL")
    if base_size <= 0:
        raise ValueError("base_size must be > 0")

    host = _host_from_base_url(base_url)
    jwt = _request_jwt(api_key_id, api_key_secret, method="POST", path="/api/v3/brokerage/orders", host=host)

    import time as _time

    oid = client_order_id or f"vigil-{int(_time.time())}"
    url = f"{base_url.rstrip('/')}/api/v3/brokerage/orders"
    bs = _coinbase_numeric_string(base_size)
    if not bs:
        raise ValueError("base_size must be a positive numeric value")
    payload: Dict[str, Any] = {
        "client_order_id": oid,
        "product_id": normalize_brokerage_product_id(product_id),
        "side": side,
        "order_configuration": {
            "market_market_ioc": {
                "base_size": str(bs),
            }
        },
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {jwt}"}
    res = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout_s)
    try:
        data = res.json()
    except Exception:
        data = {"success": False, "status_code": res.status_code, "text": (res.text or "")[:800]}
    if not isinstance(data, dict):
        data = {"success": False, "raw": data}
    success = bool(data.get("success", False))
    return CoinbaseOrderResponse(success=success, raw=data)


def get_transaction_summary_spot(
    *,
    base_url: str,
    api_key_id: str,
    api_key_secret: str,
    timeout_s: float = 25.0,
) -> Dict[str, Any]:
    """GET /api/v3/brokerage/transaction_summary (spot) — fee tier / taker rate."""
    host = _host_from_base_url(base_url)
    path = "/api/v3/brokerage/transaction_summary"
    jwt = _request_jwt(api_key_id, api_key_secret, method="GET", path=path, host=host)
    url = f"{base_url.rstrip('/')}{path}"
    res = requests.get(
        url,
        params={"product_type": "SPOT"},
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=timeout_s,
    )
    try:
        data = res.json()
    except Exception:
        return {"ok": False, "status_code": res.status_code, "text": (res.text or "")[:800]}
    if not isinstance(data, dict):
        return {"ok": res.ok, "status_code": res.status_code, "data": data}
    out = dict(data)
    out["ok"] = res.ok
    out["status_code"] = res.status_code
    return out


def normalize_brokerage_product_id(product_id: str) -> str:
    """Coinbase Advanced Trade uses hyphenated ids (e.g. BTC-GBP)."""
    p = (product_id or "BTC-GBP").strip() or "BTC-GBP"
    return p.replace("_", "-").upper()


def spot_retail_portfolio_id_for_pair(accounts_payload: Dict[str, Any], *, product_id: str) -> Optional[str]:
    """
    Best-effort retail_portfolio_id from GET /brokerage/accounts for spot preview/orders.
    Prefer the fiat (quote) wallet's portfolio when it matches the product's quote currency.
    """
    accounts = accounts_payload.get("accounts")
    if not isinstance(accounts, list):
        accounts = accounts_payload.get("data") if isinstance(accounts_payload.get("data"), list) else []
    norm = normalize_brokerage_product_id(product_id)
    quote = norm.split("-", 1)[-1].upper() if "-" in norm else ""

    def _plat_ok(p: str) -> bool:
        u = (p or "").upper()
        if not u or "UNSPECIFIED" in u:
            return True
        return "CONSUMER" in u and "CFM" not in u and "INTX" not in u

    for a in accounts:
        if not isinstance(a, dict):
            continue
        rpid = (a.get("retail_portfolio_id") or "").strip()
        if not rpid or not _plat_ok(str(a.get("platform") or "")):
            continue
        if a.get("active") is False:
            continue
        cur = (a.get("currency") or "").strip().upper()
        if quote and cur == quote:
            return rpid

    for a in accounts:
        if not isinstance(a, dict):
            continue
        rpid = (a.get("retail_portfolio_id") or "").strip()
        if not rpid or not _plat_ok(str(a.get("platform") or "")):
            continue
        if a.get("active") is False:
            continue
        return rpid
    return None


def preview_market_buy_quote_size(
    *,
    base_url: str,
    product_id: str,
    quote_size: Any,
    api_key_id: str,
    api_key_secret: str,
    retail_portfolio_id: Optional[str] = None,
    timeout_s: float = 25.0,
) -> Dict[str, Any]:
    """
    POST /api/v3/brokerage/orders/preview — market IOC buy sized in quote (e.g. GBP for BTC-GBP).

    We intentionally omit ``commission_rate`` in the JSON body: Coinbase's public Python SDK
    (``preview_order`` / ``preview_market_order``) does not send it, and the gateway can return
    proto JSON parse errors (e.g. unexpected token at the rate value) when that field is present
    in the wrong wire shape. Coinbase applies the account fee tier server-side for the preview.
    """
    host = _host_from_base_url(base_url)
    path = "/api/v3/brokerage/orders/preview"
    jwt = _request_jwt(api_key_id, api_key_secret, method="POST", path=path, host=host)
    url = f"{base_url.rstrip('/')}{path}"
    qsz = _coinbase_numeric_string(quote_size)
    if not qsz:
        return {
            "ok": False,
            "status_code": 400,
            "text": "invalid quote_size (must be a non-empty numeric string)",
        }
    pid = normalize_brokerage_product_id(product_id)
    payload: Dict[str, Any] = {
        "product_id": pid,
        "side": "BUY",
        "order_configuration": {"market_market_ioc": {"quote_size": qsz}},
    }
    rpid = (retail_portfolio_id or "").strip()
    if rpid:
        payload["retail_portfolio_id"] = rpid
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {jwt}"}

    log.info(
        "[preview-payload] POST %s  payload=%s",
        url, json.dumps({k: v for k, v in payload.items()}, default=str),
    )

    res = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout_s)

    log.info(
        "[preview-payload] response HTTP %s  body=%s",
        res.status_code, (res.text or "")[:500],
    )

    try:
        data = res.json()
    except Exception:
        return {"ok": False, "status_code": res.status_code, "text": (res.text or "")[:800]}
    if not isinstance(data, dict):
        return {"ok": res.ok, "status_code": res.status_code, "data": data}
    out = dict(data)
    out["ok"] = res.ok
    out["status_code"] = res.status_code
    return out


def list_brokerage_accounts(
    *,
    base_url: str,
    api_key_id: str,
    api_key_secret: str,
    timeout_s: float = 30.0,
) -> Dict[str, Any]:
    """
    Paginate through /api/v3/brokerage/accounts (default page size 49; max 250).
    JWT uses path /api/v3/brokerage/accounts only (no query); limit/cursor are normal query params.
    """
    host = _host_from_base_url(base_url)
    base = f"{base_url.rstrip('/')}/api/v3/brokerage/accounts"
    jwt = _request_jwt(api_key_id, api_key_secret, method="GET", path="/api/v3/brokerage/accounts", host=host)
    merged: List[Any] = []
    cursor: Optional[str] = None
    last: Dict[str, Any] = {}
    res_ok = True
    status_code = 200

    for _ in range(40):
        params: Dict[str, Any] = {"limit": 250}
        if cursor:
            params["cursor"] = cursor
        res = requests.get(
            base,
            params=params,
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=timeout_s,
        )
        status_code = res.status_code
        res_ok = res.ok
        try:
            data = res.json()
        except Exception:
            return {"ok": False, "status_code": res.status_code, "text": (res.text or "")[:800]}
        if not isinstance(data, dict):
            return {"ok": res.ok, "status_code": res.status_code, "data": data}
        last = dict(data)
        batch = data.get("accounts")
        if isinstance(batch, list):
            merged.extend(batch)
        if not data.get("has_next"):
            break
        nxt = data.get("cursor")
        if not nxt or nxt == cursor:
            break
        cursor = str(nxt)

    out = last
    out["accounts"] = merged
    out["ok"] = res_ok
    out["status_code"] = status_code
    return out


def _coinbase_numeric_string(val: Any) -> str:
    """
    Coinbase preview/order JSON maps several proto string fields (e.g. commission_rate, quote_size).
    Sending JSON numbers (unquoted) triggers gateway errors like:
    proto: syntax error ... unexpected token "0.012"
    """
    if isinstance(val, str):
        return val.strip()
    if val is None or isinstance(val, bool):
        return ""
    x: float
    if isinstance(val, Decimal):
        if not val.is_finite():
            return ""
        x = float(val)
    elif isinstance(val, (int, float)):
        x = float(val)
    else:
        return ""
    if not math.isfinite(x):
        return ""
    s = f"{x:.12f}".rstrip("0").rstrip(".")
    return s if s else "0"


def _host_from_base_url(base_url: str) -> str:
    u = base_url.rstrip("/")
    if "sandbox" in u:
        return _SANDBOX_HOST
    return _PROD_HOST


def _coerce_balance_value(obj: Any) -> Optional[float]:
    if obj is None:
        return None
    if isinstance(obj, (int, float)):
        return float(obj)
    if isinstance(obj, str):
        try:
            return float(obj)
        except ValueError:
            return None
    if isinstance(obj, dict):
        v = obj.get("value")
        if v is not None and isinstance(v, str):
            try:
                return float(v)
            except ValueError:
                return None
        if isinstance(v, (int, float)):
            return float(v)
    return None


def summarize_balances(accounts_payload: Dict[str, Any]) -> Dict[str, Any]:
    """Best-effort extract of GBP and BTC available from list-accounts JSON (no per-currency map in the API)."""
    by_currency: Dict[str, float] = {}
    accounts = accounts_payload.get("accounts")
    if not isinstance(accounts, list):
        accounts = accounts_payload.get("data") if isinstance(accounts_payload.get("data"), list) else []

    for a in accounts:
        if not isinstance(a, dict):
            continue
        avail = a.get("available_balance") or a.get("available") or a.get("balance")
        cur = (a.get("currency") or a.get("currency_code") or "").strip().upper()
        if not cur and isinstance(avail, dict):
            cur = (str(avail.get("currency") or "")).strip().upper()
        if not cur:
            continue
        val = _coerce_balance_value(avail)
        if val is None:
            continue
        by_currency[cur] = by_currency.get(cur, 0.0) + val

    gbp_available = by_currency.get("GBP", 0.0)
    btc = by_currency.get("BTC", 0.0)
    # Expose only quote/base wallets the app uses — omit full per-currency map for the client.
    return {
        "gbp_available": gbp_available,
        "btc_available": btc,
    }
