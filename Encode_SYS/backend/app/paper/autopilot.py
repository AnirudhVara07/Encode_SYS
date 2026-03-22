"""
Vigil paper automation: multiple template strategies, edge-triggered majority vote, then one consolidated trade per tick.
"""

from __future__ import annotations

import os
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Literal, Optional

import requests

from ..agent import execution_gate
from ..agent import state as agent_state
from ..agent.live_wallet import UPGRADE_MESSAGE, live_wallet
from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from ..coinbase.sandbox_client import create_market_ioc_order_sandbox
from ..coinbase.spot_price import fetch_btc_usd_spot
from . import portfolio as paper_portfolio
from .paper_events import publish as publish_paper_event
from .signals import compute_latest_execution_signal, compute_strategy_diagnostics

OrderRouting = Literal["internal", "coinbase_sandbox"]

MAX_LOG = 50
MIN_INTERVAL_SEC = 60

TEMPLATE_PARAM_KEYS: Dict[str, tuple[str, ...]] = {
    "RSIThresholdReversion": ("rsi_len", "rsi_lower", "rsi_upper"),
    "RSICrossTrendFilter": ("rsi_len", "rsi_lower", "rsi_upper", "ema_len"),
    "EMACrossover": ("ema_fast", "ema_slow"),
}


@dataclass
class StrategyRow:
    id: str
    name: str
    template_type: str
    params: Dict[str, float]
    enabled: bool


@dataclass
class AutopilotConfig:
    interval_sec: float = 60.0
    lookback_hours: int = 168
    buy_usd: float = 1000.0
    sell_fraction: float = 0.25
    order_routing: OrderRouting = "internal"
    strategies: List[StrategyRow] = field(default_factory=list)


_lock = threading.Lock()
_config = AutopilotConfig(
    order_routing="internal",
    strategies=[
        StrategyRow(
            id="demo-rsi",
            name="RSI reversion (demo)",
            template_type="RSIThresholdReversion",
            params={"rsi_len": 14.0, "rsi_lower": 30.0, "rsi_upper": 70.0},
            enabled=True,
        ),
    ],
)
_running = False
_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_last_signals: Dict[str, Optional[str]] = {s.id: None for s in _config.strategies}
_log: Deque[Dict[str, Any]] = deque(maxlen=MAX_LOG)
_last_tick_unix: Optional[float] = None
_last_data_source: Optional[str] = None
_last_error: Optional[str] = None
_last_tick_diagnostics: Optional[Dict[str, Any]] = None


def _validate_strategy_row(row: StrategyRow) -> None:
    if row.template_type not in TEMPLATE_PARAM_KEYS:
        raise ValueError(f"Unknown template_type: {row.template_type}")
    keys = TEMPLATE_PARAM_KEYS[row.template_type]
    for k in keys:
        if k not in row.params:
            raise ValueError(f"Strategy {row.id!r} missing param {k!r}")


def _coerce_params(raw: Dict[str, Any]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for k, v in raw.items():
        out[k] = float(v)
    return out


def get_config_snapshot() -> Dict[str, Any]:
    with _lock:
        return {
            "interval_sec": _config.interval_sec,
            "lookback_hours": _config.lookback_hours,
            "buy_usd": _config.buy_usd,
            "sell_fraction": _config.sell_fraction,
            "order_routing": _config.order_routing,
            "strategies": [
                {
                    "id": s.id,
                    "name": s.name,
                    "template_type": s.template_type,
                    "params": dict(s.params),
                    "enabled": s.enabled,
                }
                for s in _config.strategies
            ],
        }


def set_config(
    *,
    interval_sec: float,
    lookback_hours: int,
    buy_usd: float,
    sell_fraction: float,
    order_routing: str,
    strategies: List[Dict[str, Any]],
) -> Dict[str, Any]:
    global _last_signals
    if interval_sec < MIN_INTERVAL_SEC:
        raise ValueError(f"interval_sec must be >= {MIN_INTERVAL_SEC}")
    if lookback_hours < 24 or lookback_hours > 720:
        raise ValueError("lookback_hours must be between 24 and 720")
    if buy_usd <= 0:
        raise ValueError("buy_usd must be > 0")
    if sell_fraction <= 0 or sell_fraction > 1:
        raise ValueError("sell_fraction must be in (0, 1]")
    routing = (order_routing or "internal").strip().lower()
    if routing not in ("internal", "coinbase_sandbox"):
        raise ValueError("order_routing must be internal or coinbase_sandbox")

    rows: List[StrategyRow] = []
    for item in strategies:
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

    with _lock:
        _config.interval_sec = float(interval_sec)
        _config.lookback_hours = int(lookback_hours)
        _config.buy_usd = float(buy_usd)
        _config.sell_fraction = float(sell_fraction)
        _config.order_routing = routing  # type: ignore[assignment]
        _config.strategies = rows
        # Reset edge memory when strategy set changes
        _last_signals = {s.id: None for s in rows}

    return get_config_snapshot()


def _append_log(entry: Dict[str, Any]) -> None:
    entry = dict(entry)
    entry["t"] = time.time()
    _log.append(entry)


def _load_candles(lookback_hours: int) -> tuple[List[Dict[str, Any]], str]:
    try:
        return (
            fetch_coinbase_candles_btc_usd(lookback_hours=lookback_hours),
            "coinbase_sandbox",
        )
    except (ValueError, requests.exceptions.RequestException) as e:
        seed = int(time.time()) & 0xFFFFFFFF
        return (
            generate_synthetic_candles_btc_usd(lookback_hours=lookback_hours, seed=seed),
            f"synthetic_fallback:{e}",
        )


def _tick_once() -> None:
    global _last_tick_unix, _last_data_source, _last_error
    with _lock:
        cfg = AutopilotConfig(
            interval_sec=_config.interval_sec,
            lookback_hours=_config.lookback_hours,
            buy_usd=_config.buy_usd,
            sell_fraction=_config.sell_fraction,
            order_routing=_config.order_routing,
            strategies=list(_config.strategies),
        )
        last_map = dict(_last_signals)

    enabled = [s for s in cfg.strategies if s.enabled]
    if not enabled:
        with _lock:
            _last_error = None
            _last_tick_unix = time.time()
            _last_data_source = None
        _append_log({"level": "info", "message": "No enabled strategies; skipping tick"})
        return

    candles, data_src = _load_candles(cfg.lookback_hours)
    buy_edges = 0
    sell_edges = 0
    per_strategy: List[Dict[str, Any]] = []
    new_last: Dict[str, Optional[str]] = dict(last_map)

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

    action = "hold"
    err_trade: Optional[str] = None
    rule_code: Optional[str] = None
    guardrail_message: Optional[str] = None
    sid = agent_state.get_autopilot_owner_session_id()
    gate_session_sub: Optional[str] = None
    if sid:
        sess = agent_state.get_server_session(sid)
        if isinstance(sess, dict):
            cs = sess.get("sub")
            if isinstance(cs, str) and cs.strip():
                gate_session_sub = cs.strip()
        if gate_session_sub is None:
            gate_session_sub = sid
    mode = agent_state.get_execution_mode()
    is_pro = agent_state.get_session_is_pro(sid) if sid else False
    reasoning = (
        f"Vigil autopilot: buy_edges={buy_edges} sell_edges={sell_edges}; "
        + ", ".join(
            f"{p.get('name') or p.get('id')}:{p.get('signal')}" for p in per_strategy
        )
    )
    product_id = (os.getenv("COINBASE_SANDBOX_PRODUCT_ID") or "BTC-GBP").strip() or "BTC-GBP"

    def _sandbox_buy() -> None:
        nonlocal action, err_trade, rule_code, guardrail_message
        jwt = (os.getenv("COINBASE_BEARER_JWT") or "").strip()
        if not jwt:
            err_trade = "Exchange credentials not configured (server)"
            action = "sandbox_no_credentials"
            return
        allowed, blocked = execution_gate.gate_or_block(
            side="buy",
            usd=cfg.buy_usd,
            btc=None,
            source="vigil",
            paper_started=True,
            session_sub=gate_session_sub,
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
            return
        price, meta = fetch_btc_usd_spot(pair=product_id)
        base_size = cfg.buy_usd / price
        res = create_market_ioc_order_sandbox(
            product_id=product_id,
            side="BUY",
            base_size_btc=base_size,
            bearer_jwt=jwt,
        )
        if not res.success:
            err_trade = str(res.raw)[:800] if res.raw else "Order rejected"
            action = "sandbox_order_failed"
            return
        paper_portfolio.mirror_vigil_fill_after_gate(
            side="buy",
            usd=cfg.buy_usd,
            btc=None,
            price=price,
            quote_meta=meta,
            source="vigil",
            reasoning=reasoning,
            execution_mode="exchange",
            extra_fill_fields={"coinbase_response": res.raw},
        )
        action = "buy_sandbox"

    def _sandbox_sell(sell_btc: float) -> None:
        nonlocal action, err_trade, rule_code, guardrail_message
        jwt = (os.getenv("COINBASE_BEARER_JWT") or "").strip()
        if not jwt:
            err_trade = "Exchange credentials not configured (server)"
            action = "sandbox_no_credentials"
            return
        allowed, blocked = execution_gate.gate_or_block(
            side="sell",
            usd=None,
            btc=sell_btc,
            source="vigil",
            paper_started=True,
            session_sub=gate_session_sub,
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
            return
        price, meta = fetch_btc_usd_spot(pair=product_id)
        res = create_market_ioc_order_sandbox(
            product_id=product_id,
            side="SELL",
            base_size_btc=sell_btc,
            bearer_jwt=jwt,
        )
        if not res.success:
            err_trade = str(res.raw)[:800] if res.raw else "Order rejected"
            action = "sandbox_order_failed"
            return
        paper_portfolio.mirror_vigil_fill_after_gate(
            side="sell",
            usd=None,
            btc=sell_btc,
            price=price,
            quote_meta=meta,
            source="vigil",
            reasoning=reasoning,
            execution_mode="exchange",
            extra_fill_fields={"coinbase_response": res.raw},
        )
        action = "sell_sandbox"

    try:
        if buy_edges > sell_edges:
            if mode == "live":
                if not is_pro:
                    err_trade = UPGRADE_MESSAGE
                    action = "upgrade_required"
                else:
                    price, _meta = fetch_btc_usd_spot(pair=product_id)
                    res = live_wallet.try_execute(
                        side="buy",
                        usd=cfg.buy_usd,
                        btc=None,
                        price_usd=price,
                        reasoning=reasoning,
                        session_id=sid,
                    )
                    if not res.get("ok"):
                        err_trade = str(res.get("message") or "live execution failed")
                        action = "live_blocked"
                    else:
                        action = "live_buy_stub"
            elif cfg.order_routing == "coinbase_sandbox":
                _sandbox_buy()
            else:
                paper_portfolio.market_order(
                    side="buy",
                    usd=cfg.buy_usd,
                    btc=None,
                    source="vigil",
                    session_sub=gate_session_sub,
                    reasoning=reasoning,
                    execution_mode="paper",
                )
                action = "buy"
        elif sell_edges > buy_edges:
            st = paper_portfolio.get_status()
            btc_bal = float(st.get("btc_balance") or 0.0)
            if btc_bal > 0:
                sell_btc = btc_bal * cfg.sell_fraction
                if mode == "live":
                    if not is_pro:
                        err_trade = UPGRADE_MESSAGE
                        action = "upgrade_required"
                    else:
                        price, _meta = fetch_btc_usd_spot(pair=product_id)
                        res = live_wallet.try_execute(
                            side="sell",
                            usd=None,
                            btc=sell_btc,
                            price_usd=price,
                            reasoning=reasoning,
                            session_id=sid,
                        )
                        if not res.get("ok"):
                            err_trade = str(res.get("message") or "live execution failed")
                            action = "live_blocked"
                        else:
                            action = "live_sell_stub"
                elif cfg.order_routing == "coinbase_sandbox":
                    _sandbox_sell(sell_btc)
                else:
                    paper_portfolio.market_order(
                        side="sell",
                        usd=None,
                        btc=sell_btc,
                        source="vigil",
                        session_sub=gate_session_sub,
                        reasoning=reasoning,
                        execution_mode="paper",
                    )
                    action = "sell"
            else:
                action = "sell_skipped_no_btc"
        else:
            action = "hold"
    except RuntimeError as e:
        err_trade = str(e)
        if err_trade.startswith("Trade blocked"):
            action = "blocked"
            m = re.match(r"Trade blocked \(([^)]+)\):\s*(.*)", err_trade, re.DOTALL)
            if m:
                rule_code = m.group(1).strip()
                guardrail_message = m.group(2).strip()[:240]
        else:
            action = f"error:{e}"
    except Exception as e:
        err_trade = str(e)
        action = f"error:{e}"

    tick_snapshot = {
        "action": action,
        "buy_edges": buy_edges,
        "sell_edges": sell_edges,
        "data_source": data_src,
        "per_strategy": per_strategy,
        "trade_error": err_trade,
        "order_routing": cfg.order_routing,
        "rule_code": rule_code,
        "guardrail_message": guardrail_message,
    }

    with _lock:
        _last_signals.update(new_last)
        _last_tick_unix = time.time()
        _last_data_source = data_src
        _last_error = err_trade
        _last_tick_diagnostics = dict(tick_snapshot)

    log_entry = {
        "level": "error" if err_trade else "info",
        "message": f"tick {action} buy_edges={buy_edges} sell_edges={sell_edges}",
        **tick_snapshot,
    }
    _append_log(log_entry)

    try:
        publish_paper_event(
            "vigil_tick",
            {
                "t": time.time(),
                **tick_snapshot,
            },
        )
    except Exception:
        pass


def _loop() -> None:
    global _last_error
    while not _stop.is_set():
        try:
            _tick_once()
        except Exception as e:
            with _lock:
                _last_error = str(e)
            _append_log({"level": "error", "message": f"tick failed: {e}", "action": "error"})
        with _lock:
            interval = max(MIN_INTERVAL_SEC, float(_config.interval_sec))
        if _stop.wait(timeout=interval):
            break


def start() -> Dict[str, Any]:
    global _running, _thread
    st = paper_portfolio.get_status()
    if not st.get("started"):
        raise RuntimeError("Start the paper portfolio (reset) before Vigil")
    with _lock:
        if _running:
            raise RuntimeError("Vigil already running")
        if not any(s.enabled for s in _config.strategies):
            raise RuntimeError("Add at least one enabled strategy before starting")
        _stop.clear()
        _running = True
        _thread = threading.Thread(target=_loop, name="vigil-paper", daemon=True)
        _thread.start()
    return status()


def stop() -> Dict[str, Any]:
    global _running, _thread
    with _lock:
        was = _running
    if was:
        _stop.set()
        t = _thread
        if t is not None:
            t.join(timeout=15.0)
    with _lock:
        _running = False
        _thread = None
    return status()


def is_running() -> bool:
    with _lock:
        return _running


def status() -> Dict[str, Any]:
    with _lock:
        log_list = list(_log)[-20:]
        return {
            "running": _running,
            "kill_switch": agent_state.get_kill_switch(),
            "interval_sec": _config.interval_sec,
            "lookback_hours": _config.lookback_hours,
            "buy_usd": _config.buy_usd,
            "sell_fraction": _config.sell_fraction,
            "order_routing": _config.order_routing,
            "strategies": [
                {
                    "id": s.id,
                    "name": s.name,
                    "template_type": s.template_type,
                    "params": dict(s.params),
                    "enabled": s.enabled,
                    "last_signal": _last_signals.get(s.id),
                }
                for s in _config.strategies
            ],
            "last_tick_unix": _last_tick_unix,
            "last_data_source": _last_data_source,
            "last_error": _last_error,
            "last_tick_diagnostics": _last_tick_diagnostics,
            "log": log_list,
        }
