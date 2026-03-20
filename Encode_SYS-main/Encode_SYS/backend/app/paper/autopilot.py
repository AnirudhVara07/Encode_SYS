"""
Vigil paper automation: multiple template strategies, edge-triggered majority vote, then one consolidated trade per tick.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional

import requests

from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from . import portfolio as paper_portfolio
from .signals import compute_latest_execution_signal

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
    interval_sec: float = 300.0
    lookback_hours: int = 168
    buy_usd: float = 1000.0
    sell_fraction: float = 0.25
    strategies: List[StrategyRow] = field(default_factory=list)


_lock = threading.Lock()
_config = AutopilotConfig(
    strategies=[
        StrategyRow(
            id="demo-rsi",
            name="RSI reversion (demo)",
            template_type="RSIThresholdReversion",
            params={"rsi_len": 14.0, "rsi_lower": 30.0, "rsi_upper": 70.0},
            enabled=True,
        ),
    ]
)
_running = False
_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_last_signals: Dict[str, Optional[str]] = {s.id: None for s in _config.strategies}
_log: Deque[Dict[str, Any]] = deque(maxlen=MAX_LOG)
_last_tick_unix: Optional[float] = None
_last_data_source: Optional[str] = None
_last_error: Optional[str] = None


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
        except Exception as e:
            per_strategy.append({"id": s.id, "name": s.name, "signal": None, "error": str(e)})
            new_last[s.id] = prev
            continue

        per_strategy.append({"id": s.id, "name": s.name, "signal": cur, "error": None})
        if cur == "BUY" and prev != "BUY":
            buy_edges += 1
        if cur == "SELL" and prev != "SELL":
            sell_edges += 1
        new_last[s.id] = cur

    action = "hold"
    err_trade: Optional[str] = None
    try:
        if buy_edges > sell_edges:
            paper_portfolio.market_order(side="buy", usd=cfg.buy_usd, btc=None, source="vigil")
            action = "buy"
        elif sell_edges > buy_edges:
            st = paper_portfolio.get_status()
            btc_bal = float(st.get("btc_balance") or 0.0)
            if btc_bal > 0:
                sell_btc = btc_bal * cfg.sell_fraction
                paper_portfolio.market_order(side="sell", usd=None, btc=sell_btc, source="vigil")
                action = "sell"
            else:
                action = "sell_skipped_no_btc"
        else:
            action = "hold"
    except Exception as e:
        err_trade = str(e)
        action = f"error:{e}"

    with _lock:
        _last_signals.update(new_last)
        _last_tick_unix = time.time()
        _last_data_source = data_src
        _last_error = err_trade

    _append_log(
        {
            "level": "error" if err_trade else "info",
            "message": f"tick {action} buy_edges={buy_edges} sell_edges={sell_edges}",
            "action": action,
            "buy_edges": buy_edges,
            "sell_edges": sell_edges,
            "data_source": data_src,
            "per_strategy": per_strategy,
            "trade_error": err_trade,
        }
    )


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
            "interval_sec": _config.interval_sec,
            "lookback_hours": _config.lookback_hours,
            "buy_usd": _config.buy_usd,
            "sell_fraction": _config.sell_fraction,
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
            "log": log_list,
        }
