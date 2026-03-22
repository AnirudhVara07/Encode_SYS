from __future__ import annotations

import asyncio
import json
import logging
import queue
import time
import uuid
from functools import partial
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

log = logging.getLogger("vigil.coinbase_live")

from ..agent.secrets_redact import redact_secrets_for_client
from ..coinbase.brokerage_rest import (
    _coinbase_numeric_string,
    create_market_ioc_order,
    get_transaction_summary_spot,
    list_brokerage_accounts,
    normalize_brokerage_product_id,
    preview_market_buy_quote_size,
    spot_retail_portfolio_id_for_pair,
    summarize_balances,
)
from ..coinbase.spot_price import fetch_btc_usd_spot
from ..coinbase_live import org_config, store
from ..coinbase_live.store import LinkedCredentials
from ..coinbase_live.crypto_util import get_fernet
from ..coinbase_live.fills import clear_fills, list_fills, record_coinbase_live_fill
from ..coinbase_live.live_events import publish as publish_live_event
from ..coinbase_live.live_events import subscribe as subscribe_live_events
from ..coinbase_live.live_events import unsubscribe as unsubscribe_live_events
from ..agent import execution_gate, rules as agent_rules, state as agent_state
from ..agent.guardrail_digest import hourly_series_for_blocked, recent_blocked
from ..coinbase_live.runner import (
    drop_runtime,
    ensure_scheduler_started,
    reset_runtime_signals,
    runtime_snapshot,
)
from ..paper.autopilot import MIN_INTERVAL_SEC
from ..trading_guard import live_trading_captcha_config, verify_live_trading_captcha
from .deps import get_current_session

router = APIRouter(prefix="/coinbase-live", tags=["coinbase-live"])

_PROD_BASE = "https://api.coinbase.com"
# Float tolerance when comparing buy notional to list-accounts GBP available.
_GBP_BUY_TOLERANCE = 1e-4


def _balances_public_payload(balances: Any) -> Optional[Dict[str, Any]]:
    """Expose only GBP/BTC available to the client.

    Older static bundles rendered an 'All wallets' panel when by_currency was present;
    strip any extra keys from list-accounts aggregation.
    """
    if balances is None or not isinstance(balances, dict):
        return None
    return {
        "gbp_available": balances.get("gbp_available"),
        "btc_available": balances.get("btc_available"),
    }


# Cache taker fee rate from transaction_summary (per Vigil user) to limit Coinbase API calls.
_taker_rate_cache: Dict[str, Tuple[float, str]] = {}
_TAKER_CACHE_TTL_SEC = 300.0
_DEFAULT_TAKER_RATE = "0.006"


def _unwrap_order_preview(payload: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("order_preview", "preview", "result"):
        inner = payload.get(key)
        if isinstance(inner, dict):
            return inner
    return payload


def _taker_fee_rate_cached(civic_sub: str, creds: LinkedCredentials) -> str:
    now = time.time()
    hit = _taker_rate_cache.get(civic_sub)
    if hit and hit[0] > now:
        cached = _coinbase_numeric_string(hit[1])
        return cached if cached else _DEFAULT_TAKER_RATE
    raw = get_transaction_summary_spot(
        base_url=_PROD_BASE,
        api_key_id=creds.api_key_id,
        api_key_secret=creds.api_key_secret,
        timeout_s=20.0,
    )
    rate = _DEFAULT_TAKER_RATE
    if raw.get("ok") and isinstance(raw.get("fee_tier"), dict):
        tr = raw["fee_tier"].get("taker_fee_rate")
        if isinstance(tr, str) and tr.strip():
            rate = tr.strip()
        elif isinstance(tr, (int, float)) and tr == tr:  # not NaN
            # API may return a JSON number; preview must send a string or Coinbase returns proto parse errors.
            x = float(tr)
            s = f"{x:.12f}".rstrip("0").rstrip(".")
            if s:
                rate = s
    normalized = _coinbase_numeric_string(rate)
    rate = normalized if normalized else _DEFAULT_TAKER_RATE
    _taker_rate_cache[civic_sub] = (now + _TAKER_CACHE_TTL_SEC, rate)
    return rate


def _gbp_available_for_credentials(creds: LinkedCredentials) -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch available GBP from Coinbase Advanced Trade list-accounts.
    Returns (gbp_float, None) on success, or (None, error_detail) on failure.
    """
    raw = list_brokerage_accounts(
        base_url=_PROD_BASE,
        api_key_id=creds.api_key_id,
        api_key_secret=creds.api_key_secret,
        timeout_s=25.0,
    )
    sc = int(raw.get("status_code") or 0)
    if sc != 200:
        snippet = redact_secrets_for_client(str(raw.get("text") or raw.get("message") or raw)[:300])
        return None, f"Coinbase accounts HTTP {sc}: {snippet}"
    summary = summarize_balances(raw if isinstance(raw, dict) else {})
    return float(summary.get("gbp_available") or 0.0), None


def _mask_key_id(key_id: str) -> str:
    k = (key_id or "").strip()
    if len(k) <= 8:
        return "****"
    return f"{k[:4]}…{k[-4:]}"


def _mask_sub(sub: str) -> str:
    s = (sub or "").strip()
    if len(s) <= 8:
        return "****"
    return f"{s[:3]}…{s[-3:]}"


class CoinbaseLinkBody(BaseModel):
    api_key_id: str = Field(..., min_length=3, max_length=256)
    api_key_secret: str = Field(..., min_length=10, max_length=8192)
    product_id: str = Field(default="BTC-GBP", min_length=3, max_length=32)


class CoinbaseProductBody(BaseModel):
    product_id: str = Field(..., min_length=3, max_length=32)


class CoinbaseTradeBody(BaseModel):
    side: str = Field(..., description="buy or sell")
    usd: Optional[float] = Field(default=None, gt=0, description="Quote notional (GBP for BTC-GBP)")
    btc: Optional[float] = Field(default=None, gt=0)
    captcha_token: Optional[str] = Field(default=None, description="Turnstile token when TURNSTILE_SECRET_KEY is set")


class CoinbaseAutopilotStartBody(BaseModel):
    captcha_token: Optional[str] = Field(default=None, description="Turnstile token when TURNSTILE_SECRET_KEY is set")


class AutopilotStrategyIn(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    template_type: str = Field(..., min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class CoinbaseAutopilotBody(BaseModel):
    interval_sec: float = Field(default=60.0, ge=60)
    lookback_hours: int = Field(default=168, ge=24, le=720)
    buy_usd: float = Field(default=1000.0, gt=0, description="GBP spent per buy signal (BTC-GBP)")
    sell_fraction: float = Field(default=0.25, gt=0, le=1)
    strategies: List[AutopilotStrategyIn] = Field(default_factory=list)


def _require_linked(civic_sub: str):
    creds = org_config.get_effective_credentials(civic_sub)
    if not creds:
        if org_config.preset_env_partial():
            raise HTTPException(
                status_code=503,
                detail="Set both COINBASE_PRESET_API_KEY_ID and COINBASE_PRESET_API_KEY_SECRET in backend/.env (or clear the partial values).",
            )
        if org_config.is_org_mode():
            raise HTTPException(
                status_code=503,
                detail="Organization Coinbase mode is on but COINBASE_ORG_API_KEY_ID / COINBASE_ORG_API_KEY_SECRET are missing or invalid.",
            )
        raise HTTPException(
            status_code=400,
            detail=(
                "No Coinbase credentials: set COINBASE_PRESET_API_KEY_ID and COINBASE_PRESET_API_KEY_SECRET in backend/.env and restart, "
                "or POST /api/coinbase-live/link with COINBASE_CREDENTIALS_FERNET_KEY set."
            ),
        )
    return creds


def _autopilot_running(civic_sub: str) -> bool:
    return bool(store.get_autopilot_row(civic_sub).get("running"))


@router.get("/trading-guard")
def coinbase_trading_guard():
    """Public config for the SPA: whether captcha is required and Turnstile site key."""
    return live_trading_captcha_config()


@router.get("/guardrails")
def coinbase_guardrails(session: Dict[str, Any] = Depends(get_current_session)):
    civic = str(session.get("sub") or "")
    blocks = agent_state.list_blocked_for(book="coinbase_live", owner_sub=civic)
    posture = agent_rules.news_posture_snapshot()
    rules_summary = agent_rules.summarize_rules()
    rule_codes, series = hourly_series_for_blocked(blocks)
    return {
        "book": "coinbase_live",
        "posture": posture,
        "rules_summary": rules_summary,
        "blocked_total": len(blocks),
        "series": series,
        "series_rule_codes": rule_codes,
        "recent_blocks": recent_blocked(blocks, limit=30),
        "kill_switch": agent_state.get_kill_switch(),
    }


@router.post("/link")
def coinbase_link(body: CoinbaseLinkBody, session: Dict[str, Any] = Depends(get_current_session)):
    ensure_scheduler_started()
    civic_sub = session["sub"]
    if org_config.is_org_mode():
        raise HTTPException(
            status_code=400,
            detail="Organization mode enabled; Coinbase keys are configured on the server (COINBASE_ORG_* env).",
        )
    if org_config.preset_env_configured():
        raise HTTPException(
            status_code=400,
            detail="Coinbase keys are configured on the server (COINBASE_PRESET_* env). Remove them to use per-user linking via this endpoint.",
        )
    try:
        get_fernet()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    kid = body.api_key_id.strip()
    secret = body.api_key_secret.strip()
    pid = normalize_brokerage_product_id(body.product_id or "BTC-GBP")

    raw = list_brokerage_accounts(
        base_url=_PROD_BASE,
        api_key_id=kid,
        api_key_secret=secret,
        timeout_s=30.0,
    )
    sc = int(raw.get("status_code") or 0)
    if sc != 200:
        raise HTTPException(
            status_code=400,
            detail=redact_secrets_for_client(
                f"Coinbase rejected credentials (HTTP {sc}): {raw.get('text') or raw.get('message') or str(raw)}"[:800]
            ),
        )

    try:
        store.upsert_credentials(
            civic_sub=civic_sub,
            api_key_id=kid,
            api_key_secret=secret,
            product_id=pid,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    return {
        "ok": True,
        "api_key_id_masked": _mask_key_id(kid),
        "product_id": pid,
        "message": "Coinbase Advanced Trade linked (credentials encrypted at rest).",
    }


@router.patch("/link/product")
def coinbase_link_product(body: CoinbaseProductBody, session: Dict[str, Any] = Depends(get_current_session)):
    """Update stored trading pair for per-user SQLite links (not preset/org env)."""
    ensure_scheduler_started()
    civic_sub = session["sub"]
    if org_config.is_org_mode():
        raise HTTPException(
            status_code=400,
            detail=(
                "Trading pair comes from COINBASE_ORG_PRODUCT_ID in backend/.env — set it to BTC-GBP "
                "(or the pair you trade) and restart the backend."
            ),
        )
    if org_config.preset_env_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                "Trading pair comes from COINBASE_PRESET_PRODUCT_ID in backend/.env — set it to BTC-GBP "
                "(or the pair you trade) and restart the backend."
            ),
        )
    if not store.load_credentials(civic_sub):
        raise HTTPException(
            status_code=400,
            detail="No encrypted Coinbase link for this user. Link API keys first, or use preset/org keys from .env.",
        )
    pid = normalize_brokerage_product_id(body.product_id)
    if not store.update_linked_product_id(civic_sub=civic_sub, product_id=pid):
        raise HTTPException(status_code=500, detail="Failed to update stored trading pair.")
    return {"ok": True, "product_id": pid, "message": f"Trading pair updated to {pid}."}


@router.delete("/link")
def coinbase_unlink(session: Dict[str, Any] = Depends(get_current_session)):
    civic_sub = session["sub"]
    if _autopilot_running(civic_sub):
        store.set_autopilot_running(civic_sub, False)
    if org_config.is_org_mode():
        store.delete_autopilot_row_only(civic_sub)
        clear_fills(civic_sub)
        drop_runtime(civic_sub)
        return {
            "ok": True,
            "message": "Your saved Vigil config and local fill history were cleared. Organization Coinbase keys were not changed.",
        }
    if org_config.preset_env_configured():
        store.delete_autopilot_row_only(civic_sub)
        clear_fills(civic_sub)
        drop_runtime(civic_sub)
        return {
            "ok": True,
            "message": "Your saved Vigil config and local fill history were cleared. Preset Coinbase keys in .env were not changed.",
        }
    store.delete_credentials(civic_sub)
    clear_fills(civic_sub)
    drop_runtime(civic_sub)
    return {"ok": True, "message": "Unlinked and local fill history cleared."}


@router.get("/status")
def coinbase_status(session: Dict[str, Any] = Depends(get_current_session)):
    ensure_scheduler_started()
    civic_sub = session["sub"]
    meta = store.get_linked_meta(civic_sub)
    ap = store.get_autopilot_row(civic_sub)
    rt = runtime_snapshot(civic_sub)
    om = org_config.is_org_mode()
    oc = org_config.org_credentials_configured()
    pe = org_config.preset_env_configured()
    pep = org_config.preset_env_partial()
    using_shared = org_config.uses_shared_coinbase_account()
    linked = bool(meta) or using_shared
    eff = org_config.get_effective_credentials(civic_sub)
    if pe:
        key_masked = org_config.preset_env_key_id_masked()
    elif om and oc:
        key_masked = org_config.org_mode_key_id_masked()
    elif meta:
        key_masked = _mask_key_id(meta["api_key_id"])
    elif eff:
        key_masked = _mask_key_id(eff.api_key_id)
    else:
        key_masked = None
    product = eff.product_id if eff else None
    out: Dict[str, Any] = {
        "linked": linked,
        "org_mode": om,
        "using_shared_account": using_shared,
        "preset_from_env": pe,
        "preset_env_partial": pep,
        "api_key_id_masked": key_masked,
        "product_id": product,
        "autopilot": {
            "running": ap.get("running"),
            "interval_sec": ap.get("interval_sec"),
            "lookback_hours": ap.get("lookback_hours"),
            "buy_usd": ap.get("buy_usd"),
            "sell_fraction": ap.get("sell_fraction"),
            "strategies": ap.get("strategies"),
        },
        "runtime": rt,
        "balances": None,
        "balances_error": None,
    }
    if eff:
        try:
            raw = list_brokerage_accounts(
                base_url=_PROD_BASE,
                api_key_id=eff.api_key_id,
                api_key_secret=eff.api_key_secret,
                timeout_s=25.0,
            )
            if int(raw.get("status_code") or 0) == 200:
                out["balances"] = summarize_balances(raw)
            else:
                out["balances_error"] = redact_secrets_for_client(str(raw)[:500])
        except Exception as e:
            out["balances_error"] = redact_secrets_for_client(str(e))
    elif linked:
        out["balances_error"] = (
            "Coinbase API credentials are not available for this session. "
            "Set COINBASE_PRESET_* (or COINBASE_ORG_*) in backend/.env and restart, "
            "or link your API keys in this app if per-user linking is enabled."
        )
    out["balances"] = _balances_public_payload(out.get("balances"))
    return out


@router.get("/fills")
def coinbase_fills(limit: int = 50, session: Dict[str, Any] = Depends(get_current_session)):
    civic_sub = session["sub"]
    return {"fills": list_fills(civic_sub, limit=min(limit, 200))}


@router.get("/manual-buy-quote")
def manual_buy_quote(gbp: float, session: Dict[str, Any] = Depends(get_current_session)):
    """
    Preview a market IOC buy in quote size (GBP for BTC-GBP): indicative BTC and Coinbase commission.
    Uses Advanced Trade order preview + cached taker rate from transaction_summary.
    """
    civic_sub = session["sub"]
    creds = _require_linked(civic_sub)
    if not (gbp > 0) or gbp > 50_000_000:
        raise HTTPException(status_code=400, detail="gbp must be a positive amount within a reasonable range")
    product_id = normalize_brokerage_product_id(creds.product_id or "BTC-GBP")
    qsz = f"{float(gbp):.2f}"
    commission_rate = _taker_fee_rate_cached(civic_sub, creds)

    log.info(
        "[preview-diag] product_id=%s  quote_size=%s  api_key_id=%s  creds.product_id_raw=%r",
        product_id, qsz, _mask_key_id(creds.api_key_id), creds.product_id,
    )

    preview = preview_market_buy_quote_size(
        base_url=_PROD_BASE,
        product_id=product_id,
        quote_size=qsz,
        api_key_id=creds.api_key_id,
        api_key_secret=creds.api_key_secret,
        timeout_s=25.0,
    )
    sc = int(preview.get("status_code") or 0)

    log.info(
        "[preview-diag] first attempt HTTP %s  ok=%s  body_keys=%s  error_snippet=%s",
        sc, preview.get("ok"), list(preview.keys())[:12],
        str(preview.get("error_details") or preview.get("message") or preview.get("error") or "")[:300],
    )

    def _preview_err_lower(p: Dict[str, Any]) -> str:
        return str(
            p.get("error_details") or p.get("message") or p.get("error") or p.get("text") or ""
        ).lower()

    if (not preview.get("ok") or sc >= 400) and "account is not available" in _preview_err_lower(preview):
        log.info("[preview-diag] 'account is not available' detected — fetching brokerage accounts for retry")
        acct = list_brokerage_accounts(
            base_url=_PROD_BASE,
            api_key_id=creds.api_key_id,
            api_key_secret=creds.api_key_secret,
            timeout_s=25.0,
        )
        acct_sc = int(acct.get("status_code") or 0)
        acct_list = acct.get("accounts") or []
        acct_summary = [
            {
                "currency": (a.get("currency") or "?"),
                "active": a.get("active"),
                "platform": a.get("platform"),
                "retail_portfolio_id": (a.get("retail_portfolio_id") or "")[:12] + "…",
            }
            for a in (acct_list if isinstance(acct_list, list) else [])[:20]
            if isinstance(a, dict)
        ]
        log.info(
            "[preview-diag] list-accounts HTTP %s  ok=%s  num_accounts=%s  accounts_summary=%s",
            acct_sc, acct.get("ok"), len(acct_list) if isinstance(acct_list, list) else "N/A", acct_summary,
        )

        if acct_sc == 200 and acct.get("ok"):
            rpid = spot_retail_portfolio_id_for_pair(acct, product_id=product_id)
            log.info("[preview-diag] resolved retail_portfolio_id=%s for product_id=%s", rpid, product_id)
            if rpid:
                preview = preview_market_buy_quote_size(
                    base_url=_PROD_BASE,
                    product_id=product_id,
                    quote_size=qsz,
                    api_key_id=creds.api_key_id,
                    api_key_secret=creds.api_key_secret,
                    retail_portfolio_id=rpid,
                    timeout_s=25.0,
                )
                sc = int(preview.get("status_code") or 0)
                log.info(
                    "[preview-diag] retry with rpid HTTP %s  ok=%s  error_snippet=%s",
                    sc, preview.get("ok"),
                    str(preview.get("error_details") or preview.get("message") or preview.get("error") or "")[:300],
                )
            else:
                log.warning(
                    "[preview-diag] could not resolve retail_portfolio_id — "
                    "no account with quote currency matching %s found in %d accounts",
                    product_id, len(acct_list) if isinstance(acct_list, list) else 0,
                )

    if not preview.get("ok") or sc >= 400:
        snippet = redact_secrets_for_client(
            str(preview.get("error_details") or preview.get("message") or preview.get("text") or preview)[:500]
        )
        if "account is not available" in snippet.lower():
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Coinbase preview failed (HTTP {sc}): {snippet}. "
                    f"Coinbase could not attach order preview to a tradable spot portfolio for {product_id}. "
                    "Use a CDP Advanced Trade API key with trade permission, ensure Advanced Trade is enabled on "
                    "coinbase.com, and that your quote wallet (e.g. GBP for BTC-GBP) exists and is active. "
                    "If the pair is wrong for your region, relink and set product_id to a pair you can trade."
                ),
            )
        raise HTTPException(status_code=502, detail=f"Coinbase preview failed (HTTP {sc}): {snippet}")

    if preview.get("success") is False:
        msg = preview.get("message") or preview.get("error") or preview.get("error_response") or preview
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(msg)[:600]))

    body = _unwrap_order_preview(preview)
    errs = body.get("errs") or preview.get("errs") or []
    warnings = body.get("warning") or preview.get("warnings") or preview.get("warning") or []

    def _to_float(val: Any) -> Optional[float]:
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    commission_raw = body.get("commission_total")
    base_raw = body.get("base_size")
    avg_px = body.get("est_average_filled_price")

    out: Dict[str, Any] = {
        "ok": True,
        "product_id": product_id,
        "gbp": float(gbp),
        "commission_gbp": _to_float(commission_raw),
        "btc": _to_float(base_raw),
        "est_avg_price_gbp": str(avg_px) if avg_px is not None else None,
        "taker_fee_rate": commission_rate,
        "preview_warnings": warnings if isinstance(warnings, list) else [],
        "preview_errs": errs if isinstance(errs, list) else [],
    }
    if commission_raw is not None:
        out["commission_gbp_str"] = str(commission_raw)
    if base_raw is not None:
        out["btc_str"] = str(base_raw)
    return out


@router.post("/trade")
def coinbase_trade(
    body: CoinbaseTradeBody,
    request: Request,
    session: Dict[str, Any] = Depends(get_current_session),
):
    ensure_scheduler_started()
    civic_sub = session["sub"]
    try:
        verify_live_trading_captcha(body.captcha_token, request.client.host if request.client else None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    creds = _require_linked(civic_sub)
    side = body.side.strip().lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be buy or sell")

    if side == "buy":
        usd = body.usd
        if usd is None or usd <= 0:
            raise HTTPException(status_code=400, detail="buy requires usd > 0")
        allowed, blocked = execution_gate.gate_or_block(
            side="buy",
            usd=usd,
            btc=None,
            source="manual",
            paper_started=False,
            session_sub=civic_sub,
            book="coinbase_live",
        )
        if not allowed:
            raise HTTPException(
                status_code=400,
                detail=blocked.get("message") if blocked else "Trade blocked",
            )
        gbp_avail, bal_err = _gbp_available_for_credentials(creds)
        if gbp_avail is None:
            raise HTTPException(
                status_code=503,
                detail=f"Cannot verify GBP balance ({bal_err or 'unknown error'}). Refresh status and try again.",
            )
        if float(usd) > gbp_avail + _GBP_BUY_TOLERANCE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Buy amount ({float(usd):.2f} GBP) exceeds available GBP ({gbp_avail:.2f}). "
                    "Reduce the amount or refresh balances."
                ),
            )
        price, _ = fetch_btc_usd_spot(pair=creds.product_id)
        base_size = usd / price
        res = create_market_ioc_order(
            base_url=_PROD_BASE,
            product_id=creds.product_id,
            side="BUY",
            base_size=base_size,
            api_key_id=creds.api_key_id,
            api_key_secret=creds.api_key_secret,
            client_order_id=f"vigil-manual-{civic_sub[:8]}-{int(time.time())}",
        )
        if not res.success:
            raise HTTPException(status_code=502, detail=redact_secrets_for_client(str(res.raw)[:800]))
        stored = record_coinbase_live_fill(
            civic_sub,
            {
                "id": str(uuid.uuid4()),
                "ts": time.time(),
                "side": "buy",
                "usd": usd,
                "btc": base_size,
                "price": price,
                "source": "manual",
                "execution_mode": "coinbase_live",
                "coinbase_response": res.raw,
            },
        )
        return {"ok": True, "fill": res.raw, "attestation": stored.get("attestation")}

    btc = body.btc
    if btc is None or btc <= 0:
        raise HTTPException(status_code=400, detail="sell requires btc > 0")
    allowed, blocked = execution_gate.gate_or_block(
        side="sell",
        usd=None,
        btc=btc,
        source="manual",
        paper_started=False,
        session_sub=civic_sub,
        book="coinbase_live",
    )
    if not allowed:
        raise HTTPException(
            status_code=400,
            detail=blocked.get("message") if blocked else "Trade blocked",
        )
    price, _ = fetch_btc_usd_spot(pair=creds.product_id)
    res = create_market_ioc_order(
        base_url=_PROD_BASE,
        product_id=creds.product_id,
        side="SELL",
        base_size=btc,
        api_key_id=creds.api_key_id,
        api_key_secret=creds.api_key_secret,
        client_order_id=f"vigil-manual-{civic_sub[:8]}-{int(time.time())}",
    )
    if not res.success:
        raise HTTPException(status_code=502, detail=redact_secrets_for_client(str(res.raw)[:800]))
    stored = record_coinbase_live_fill(
        civic_sub,
        {
            "id": str(uuid.uuid4()),
            "ts": time.time(),
            "side": "sell",
            "usd": btc * price,
            "btc": btc,
            "price": price,
            "source": "manual",
            "execution_mode": "coinbase_live",
            "coinbase_response": res.raw,
        },
    )
    return {"ok": True, "fill": res.raw, "attestation": stored.get("attestation")}


@router.get("/autopilot")
def coinbase_autopilot_get(session: Dict[str, Any] = Depends(get_current_session)):
    civic_sub = session["sub"]
    row = store.get_autopilot_row(civic_sub)
    row = dict(row)
    row["runtime"] = runtime_snapshot(civic_sub)
    return row


@router.put("/autopilot/config")
def coinbase_autopilot_put(body: CoinbaseAutopilotBody, session: Dict[str, Any] = Depends(get_current_session)):
    civic_sub = session["sub"]
    creds = _require_linked(civic_sub)
    if _autopilot_running(civic_sub):
        raise HTTPException(status_code=409, detail="Stop live Vigil before changing config")
    if body.interval_sec < MIN_INTERVAL_SEC:
        raise HTTPException(status_code=400, detail=f"interval_sec must be >= {MIN_INTERVAL_SEC}")
    raw_list = [s.model_dump() for s in body.strategies]
    if not raw_list:
        raw_list = [
            {
                "id": "st-default",
                "name": "RSI reversion",
                "template_type": "RSIThresholdReversion",
                "params": {"rsi_len": 14, "rsi_lower": 30, "rsi_upper": 70},
                "enabled": True,
            }
        ]
    from ..paper.autopilot import StrategyRow, _coerce_params, _validate_strategy_row

    for item in raw_list:
        sid = str(item.get("id") or "").strip() or str(uuid.uuid4())
        name = str(item.get("name") or "").strip() or sid[:8]
        tt = str(item.get("template_type") or "").strip()
        enabled = bool(item.get("enabled", True))
        pr = item.get("params")
        if not isinstance(pr, dict):
            raise HTTPException(status_code=400, detail=f"Strategy {sid!r} params must be an object")
        row = StrategyRow(
            id=sid,
            name=name,
            template_type=tt,
            params=_coerce_params(pr),
            enabled=enabled,
        )
        try:
            _validate_strategy_row(row)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    gbp_avail, bal_err = _gbp_available_for_credentials(creds)
    if gbp_avail is None:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot verify GBP balance ({bal_err or 'unknown error'}). Refresh status before saving config.",
        )
    buy = float(body.buy_usd)
    if buy > gbp_avail + _GBP_BUY_TOLERANCE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Buy per signal ({buy:.2f} GBP) exceeds available GBP ({gbp_avail:.2f}). "
                "Reduce Vigil buy size or add funds, then refresh status."
            ),
        )

    store.save_autopilot_config(
        civic_sub=civic_sub,
        interval_sec=float(body.interval_sec),
        lookback_hours=int(body.lookback_hours),
        buy_usd=float(body.buy_usd),
        sell_fraction=float(body.sell_fraction),
        strategies=raw_list,
    )
    reset_runtime_signals(civic_sub)
    return store.get_autopilot_row(civic_sub)


@router.post("/autopilot/start")
def coinbase_autopilot_start(
    request: Request,
    body: CoinbaseAutopilotStartBody = CoinbaseAutopilotStartBody(),
    session: Dict[str, Any] = Depends(get_current_session),
):
    civic_sub = session["sub"]
    try:
        verify_live_trading_captcha(body.captcha_token, request.client.host if request.client else None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    creds = _require_linked(civic_sub)
    if _autopilot_running(civic_sub):
        return {**store.get_autopilot_row(civic_sub), "message": "Already running"}
    ap_row = store.get_autopilot_row(civic_sub)
    buy_cfg = float(ap_row.get("buy_usd") or 0.0)
    gbp_avail, bal_err = _gbp_available_for_credentials(creds)
    if gbp_avail is None:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot verify GBP balance ({bal_err or 'unknown error'}). Refresh status before starting Live Vigil.",
        )
    if buy_cfg > gbp_avail + _GBP_BUY_TOLERANCE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Saved Vigil buy size ({buy_cfg:.2f} GBP) exceeds available GBP ({gbp_avail:.2f}). "
                "Save a smaller buy per signal or add funds, then refresh status."
            ),
        )
    if org_config.uses_shared_coinbase_account():
        other = store.get_running_civic_sub_other_than(civic_sub)
        if other:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "org_vigil_busy",
                    "message": "Another user is already running Live Vigil on the shared Coinbase account. Stop it first.",
                    "owner_sub_masked": _mask_sub(other),
                },
            )
    store.set_autopilot_running(civic_sub, True)
    ensure_scheduler_started()
    return {**store.get_autopilot_row(civic_sub), "message": "Live Vigil started"}


@router.post("/autopilot/stop")
def coinbase_autopilot_stop(session: Dict[str, Any] = Depends(get_current_session)):
    civic_sub = session["sub"]
    store.set_autopilot_running(civic_sub, False)
    return {**store.get_autopilot_row(civic_sub), "message": "Live Vigil stopped"}


def _qget_timeout(q: queue.Queue, timeout_s: float) -> Optional[str]:
    try:
        return q.get(timeout=timeout_s)
    except queue.Empty:
        return None


@router.get("/events")
async def coinbase_live_events_sse(
    request: Request,
    token: Optional[str] = None,
    session: Optional[Dict[str, Any]] = None,
):
    """SSE stream for live Coinbase trading: vigil_tick events + initial snapshot.

    Accepts auth via Authorization header OR ?token= query param (required for browser EventSource).
    """
    from ..agent import session_jwt

    # Resolve session from header or query token
    raw_token: Optional[str] = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        raw_token = auth_header[7:].strip()
    elif token:
        raw_token = token.strip()

    if not raw_token:
        from fastapi.responses import Response
        return Response(status_code=401, content="Missing token")

    try:
        payload = session_jwt.decode_token(raw_token)
    except Exception:
        from fastapi.responses import Response
        return Response(status_code=401, content="Invalid token")

    from ..agent import state as _agent_state_local

    sid = str(payload.get("sid") or "")
    sess = _agent_state_local.get_server_session(sid) if sid else None
    if not sess:
        from fastapi.responses import Response
        return Response(status_code=401, content="Session expired")

    civic_sub = str(payload.get("sub") or "")

    async def gen():
        q = subscribe_live_events()
        try:
            rt = runtime_snapshot(civic_sub)
            row = store.get_autopilot_row(civic_sub)
            snap = {
                "event": "snapshot",
                "data": {
                    "kill_switch": agent_state.get_kill_switch(),
                    "autopilot": {
                        "running": bool(row.get("running")),
                        "last_tick_diagnostics": rt.get("last_diagnostics"),
                        "last_tick_unix": rt.get("last_tick_unix"),
                        "last_error": rt.get("last_error"),
                    },
                },
            }
            yield f"data: {json.dumps(snap, default=str)}\n\n"
            loop = asyncio.get_running_loop()
            while True:
                line = await loop.run_in_executor(None, partial(_qget_timeout, q, 25.0))
                if line is None:
                    yield ": ping\n\n"
                else:
                    # Only forward tick events relevant to this user
                    try:
                        parsed = json.loads(line)
                        data = parsed.get("data") or {}
                        if parsed.get("event") == "vigil_tick" and data.get("civic_sub") != civic_sub:
                            continue
                    except Exception:
                        pass
                    yield f"data: {line}\n\n"
        finally:
            unsubscribe_live_events(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/kill-switch")
def coinbase_kill_switch_get(session: Dict[str, Any] = Depends(get_current_session)):
    return {"kill_switch": agent_state.get_kill_switch()}


@router.post("/kill-switch/clear")
def coinbase_kill_switch_clear(session: Dict[str, Any] = Depends(get_current_session)):
    agent_state.set_kill_switch(False)
    publish_live_event("kill_switch_cleared", {"kill_switch": False})
    return {"ok": True, "kill_switch": False, "message": "Kill switch cleared"}
