from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

from ..agent import execution_gate
from ..coinbase.brokerage_rest import create_market_ioc_order, list_brokerage_accounts, summarize_balances
from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from ..coinbase.spot_price import fetch_btc_usd_spot
from ..paper.autopilot import (
    MIN_INTERVAL_SEC,
    StrategyRow,
    TEMPLATE_PARAM_KEYS,
    _coerce_params,
    _validate_strategy_row,
)
from ..paper.signals import compute_latest_execution_signal, compute_strategy_diagnostics
from . import store
from .fills import record_coinbase_live_fill
from .live_events import publish as publish_live_event
from .org_config import get_effective_credentials
from .store import LinkedCredentials

_PROD_BASE = "https://api.coinbase.com"


@dataclass
class UserRuntime:
    last_signals: Dict[str, Optional[str]] = field(default_factory=dict)
    last_tick_unix: float = 0.0
    last_error: Optional[str] = None
    last_diagnostics: Optional[Dict[str, Any]] = None


_lock = threading.Lock()
_users: Dict[str, UserRuntime] = {}
_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def _ensure_user_rt(civic_sub: str) -> UserRuntime:
    with _lock:
        return _users.setdefault(civic_sub, UserRuntime())


def ensure_scheduler_started() -> None:
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _stop.clear()
        _thread = threading.Thread(target=_scheduler_loop, name="coinbase-live-vigil", daemon=True)
        _thread.start()


def stop_scheduler_for_tests() -> None:
    _stop.set()
    global _thread
    if _thread:
        _thread.join(timeout=2.0)
        _thread = None


def _scheduler_loop() -> None:
    while not _stop.is_set():
        try:
            subs = store.list_running_civic_subs()
        except Exception:
            subs = []
        now = time.time()
        for civic_sub in subs:
            rt = _ensure_user_rt(civic_sub)
            try:
                row = store.get_autopilot_row(civic_sub)
            except Exception as e:
                rt.last_error = str(e)
                continue
            interval = max(float(row.get("interval_sec") or 60), MIN_INTERVAL_SEC)
            if rt.last_tick_unix > 0 and now - rt.last_tick_unix < interval:
                continue
            creds = get_effective_credentials(civic_sub)
            if not creds:
                rt.last_error = "Credentials missing"
                continue
            try:
                _tick_once(civic_sub, creds, row, rt)
                rt.last_tick_unix = time.time()
                # Broadcast tick diagnostics to all SSE subscribers
                if rt.last_diagnostics:
                    publish_live_event(
                        "vigil_tick",
                        {**rt.last_diagnostics, "t": rt.last_tick_unix, "civic_sub": civic_sub},
                    )
            except Exception as e:
                rt.last_error = str(e)
        time.sleep(5.0)


def _strategies_from_cfg(raw: List[Dict[str, Any]]) -> List[StrategyRow]:
    rows: List[StrategyRow] = []
    for item in raw:
        sid = str(item.get("id") or "").strip() or str(uuid.uuid4())
        name = str(item.get("name") or "").strip() or sid[:8]
        tt = str(item.get("template_type") or "").strip()
        enabled = bool(item.get("enabled", True))
        params_raw = item.get("params")
        if not isinstance(params_raw, dict):
            raise ValueError(f"Strategy {sid!r} params must be an object")
        row = StrategyRow(
            id=sid,
            name=name,
            template_type=tt,
            params=_coerce_params(params_raw),
            enabled=enabled,
        )
        _validate_strategy_row(row)
        rows.append(row)
    return rows


def _load_candles(product_id: str, lookback_hours: int) -> tuple[List[Dict[str, Any]], str]:
    try:
        return (
            fetch_coinbase_candles_btc_usd(
                product_id=product_id,
                lookback_hours=lookback_hours,
                sandbox_base_url=_PROD_BASE,
                use_public_market_candles=True,
            ),
            "coinbase_production",
        )
    except (ValueError, requests.exceptions.RequestException) as e:
        seed = int(time.time()) & 0xFFFFFFFF
        return (
            generate_synthetic_candles_btc_usd(lookback_hours=lookback_hours, seed=seed),
            f"synthetic_fallback:{e}",
        )


def _btc_available(creds: LinkedCredentials) -> float:
    raw = list_brokerage_accounts(
        base_url=_PROD_BASE,
        api_key_id=creds.api_key_id,
        api_key_secret=creds.api_key_secret,
        timeout_s=25.0,
    )
    if not raw.get("ok", True) and raw.get("status_code", 0) not in (200,):
        return 0.0
    summary = summarize_balances(raw if isinstance(raw, dict) else {})
    return float(summary.get("btc_available") or 0.0)


def _tick_once(civic_sub: str, creds: LinkedCredentials, cfg_row: Dict[str, Any], rt: UserRuntime) -> None:
    strategies = _strategies_from_cfg(cfg_row.get("strategies") or [])
    enabled = [s for s in strategies if s.enabled]
    if not enabled:
        rt.last_error = None
        rt.last_diagnostics = {"action": "hold", "message": "No enabled strategies"}
        return

    cfg_buy = float(cfg_row.get("buy_usd") or 0)
    cfg_sell_frac = float(cfg_row.get("sell_fraction") or 0.25)
    lookback = int(cfg_row.get("lookback_hours") or 168)

    candles, data_src = _load_candles(creds.product_id, lookback)
    buy_edges = 0
    sell_edges = 0
    per_strategy: List[Dict[str, Any]] = []
    new_last: Dict[str, Optional[str]] = dict(rt.last_signals)

    for s in enabled:
        prev = new_last.get(s.id)
        try:
            cur = compute_latest_execution_signal(
                template_type=s.template_type,
                candles_raw=candles,
                best_params=s.params,
            )
            diag = compute_strategy_diagnostics(
                template_type=s.template_type,
                candles_raw=candles,
                best_params=s.params,
            )
        except Exception as e:
            per_strategy.append({"id": s.id, "name": s.name, "signal": None, "diagnostics": None, "error": str(e)})
            new_last[s.id] = prev
            continue

        per_strategy.append(
            {"id": s.id, "name": s.name, "signal": cur, "diagnostics": diag, "error": None, "params": dict(s.params)}
        )
        if cur == "BUY" and prev != "BUY":
            buy_edges += 1
        if cur == "SELL" and prev != "SELL":
            sell_edges += 1
        new_last[s.id] = cur

    reasoning = (
        f"Coinbase live Vigil: buy_edges={buy_edges} sell_edges={sell_edges}; "
        + ", ".join(f"{p.get('name') or p.get('id')}:{p.get('signal')}" for p in per_strategy)
    )

    action = "hold"
    err_trade: Optional[str] = None
    rule_code: Optional[str] = None
    guardrail_message: Optional[str] = None

    try:
        if buy_edges > sell_edges:
            allowed, blocked = execution_gate.gate_or_block(
                side="buy",
                usd=cfg_buy,
                btc=None,
                source="vigil",
                paper_started=False,
                session_sub=civic_sub,
                book="coinbase_live",
            )
            if not allowed:
                if blocked:
                    rule_code = str(blocked.get("rule_code") or "")
                    guardrail_message = str(blocked.get("message") or "")[:240]
                err_trade = (
                    f"Trade blocked ({blocked.get('rule_code') if blocked else 'unknown'}): "
                    f"{blocked.get('message') if blocked else 'rule failure'}"
                )
                action = "blocked"
            else:
                price, _meta = fetch_btc_usd_spot(pair=creds.product_id)
                base_size = cfg_buy / price
                res = create_market_ioc_order(
                    base_url=_PROD_BASE,
                    product_id=creds.product_id,
                    side="BUY",
                    base_size=base_size,
                    api_key_id=creds.api_key_id,
                    api_key_secret=creds.api_key_secret,
                    client_order_id=f"vigil-live-{civic_sub[:8]}-{int(time.time())}",
                )
                if not res.success:
                    err_trade = str(res.raw)[:800] if res.raw else "Order rejected"
                    action = "order_failed"
                else:
                    action = "buy"
                    record_coinbase_live_fill(
                        civic_sub,
                        {
                            "id": str(uuid.uuid4()),
                            "ts": time.time(),
                            "side": "buy",
                            "usd": cfg_buy,
                            "btc": base_size,
                            "price": price,
                            "source": "vigil",
                            "reasoning": reasoning,
                            "execution_mode": "coinbase_live",
                            "coinbase_response": res.raw,
                        },
                    )
        elif sell_edges > buy_edges:
            btc_bal = _btc_available(creds)
            if btc_bal > 0:
                sell_btc = btc_bal * cfg_sell_frac
                allowed, blocked = execution_gate.gate_or_block(
                    side="sell",
                    usd=None,
                    btc=sell_btc,
                    source="vigil",
                    paper_started=False,
                    session_sub=civic_sub,
                    book="coinbase_live",
                )
                if not allowed:
                    if blocked:
                        rule_code = str(blocked.get("rule_code") or "")
                        guardrail_message = str(blocked.get("message") or "")[:240]
                    err_trade = (
                        f"Trade blocked ({blocked.get('rule_code') if blocked else 'unknown'}): "
                        f"{blocked.get('message') if blocked else 'rule failure'}"
                    )
                    action = "blocked"
                else:
                    price, _meta = fetch_btc_usd_spot(pair=creds.product_id)
                    res = create_market_ioc_order(
                        base_url=_PROD_BASE,
                        product_id=creds.product_id,
                        side="SELL",
                        base_size=sell_btc,
                        api_key_id=creds.api_key_id,
                        api_key_secret=creds.api_key_secret,
                        client_order_id=f"vigil-live-{civic_sub[:8]}-{int(time.time())}",
                    )
                    if not res.success:
                        err_trade = str(res.raw)[:800] if res.raw else "Order rejected"
                        action = "order_failed"
                    else:
                        action = "sell"
                        record_coinbase_live_fill(
                            civic_sub,
                            {
                                "id": str(uuid.uuid4()),
                                "ts": time.time(),
                                "side": "sell",
                                "usd": sell_btc * price,
                                "btc": sell_btc,
                                "price": price,
                                "source": "vigil",
                                "reasoning": reasoning,
                                "execution_mode": "coinbase_live",
                                "coinbase_response": res.raw,
                            },
                        )
            else:
                action = "sell_skipped_no_btc"
        else:
            action = "hold"
    except Exception as e:
        err_trade = str(e)
        action = f"error:{e}"

    rt.last_signals = new_last
    rt.last_error = err_trade
    rt.last_diagnostics = {
        "action": action,
        "buy_edges": buy_edges,
        "sell_edges": sell_edges,
        "data_source": data_src,
        "per_strategy": per_strategy,
        "trade_error": err_trade,
        "product_id": creds.product_id,
        "rule_code": rule_code,
        "guardrail_message": guardrail_message,
    }


def runtime_snapshot(civic_sub: str) -> Dict[str, Any]:
    rt = _ensure_user_rt(civic_sub)
    return {
        "last_tick_unix": rt.last_tick_unix or None,
        "last_error": rt.last_error,
        "last_diagnostics": rt.last_diagnostics,
    }


def reset_runtime_signals(civic_sub: str) -> None:
    with _lock:
        if civic_sub in _users:
            _users[civic_sub].last_signals = {}


def drop_runtime(civic_sub: str) -> None:
    with _lock:
        _users.pop(civic_sub, None)
