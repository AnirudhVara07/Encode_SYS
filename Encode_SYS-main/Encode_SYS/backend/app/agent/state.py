from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from typing import Any, Deque, Dict, List, Optional

MAX_BLOCKED = 200
MAX_SESSION_TRADES = 500

_lock = threading.Lock()
_kill_switch: bool = False
_autonomous: bool = False
_strategy_profile: Optional[Dict[str, Any]] = None
_blocked_trades: Deque[Dict[str, Any]] = deque(maxlen=MAX_BLOCKED)
_session_trades: List[Dict[str, Any]] = []
# In-memory sessions after Civic: session_id -> payload
_sessions: Dict[str, Dict[str, Any]] = {}
# FIFO lots for BTC-USD realized P&L: list of {btc_remaining, avg_cost_usd_per_btc}
_fifo_lots: List[Dict[str, float]] = []


def get_flags() -> Dict[str, bool]:
    with _lock:
        return {"kill_switch": _kill_switch, "autonomous": _autonomous}


def get_kill_switch() -> bool:
    with _lock:
        return _kill_switch


def set_kill_switch(v: bool) -> None:
    global _kill_switch
    with _lock:
        _kill_switch = v


def get_autonomous() -> bool:
    with _lock:
        return _autonomous


def set_autonomous(v: bool) -> None:
    global _autonomous
    with _lock:
        _autonomous = v


def get_strategy_profile() -> Optional[Dict[str, Any]]:
    with _lock:
        return dict(_strategy_profile) if _strategy_profile else None


def set_strategy_profile(profile: Dict[str, Any]) -> None:
    global _strategy_profile
    with _lock:
        _strategy_profile = dict(profile)


def record_blocked(
    *,
    rule_code: str,
    message: str,
    side: str,
    usd: Optional[float],
    btc: Optional[float],
    source: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    entry = {
        "id": str(uuid.uuid4()),
        "ts": time.time(),
        "type": "blocked",
        "rule_code": rule_code,
        "message": message,
        "side": side,
        "usd": usd,
        "btc": btc,
        "source": source,
        **(extra or {}),
    }
    with _lock:
        _blocked_trades.append(entry)
    return entry


def list_blocked() -> List[Dict[str, Any]]:
    with _lock:
        return list(_blocked_trades)


def clear_session_data() -> None:
    """Clear ledger, FIFO lots, and blocked list (e.g. new agent session or paper reset)."""
    global _session_trades, _fifo_lots
    with _lock:
        _session_trades = []
        _fifo_lots = []
        _blocked_trades.clear()


def store_server_session(session_id: str, payload: Dict[str, Any]) -> None:
    with _lock:
        _sessions[session_id] = payload


def get_server_session(session_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        p = _sessions.get(session_id)
        return dict(p) if p else None


def record_executed_trade(entry: Dict[str, Any]) -> None:
    with _lock:
        _session_trades.append(entry)
        while len(_session_trades) > MAX_SESSION_TRADES:
            _session_trades.pop(0)


def list_session_trades() -> List[Dict[str, Any]]:
    with _lock:
        return list(_session_trades)


def fifo_apply_buy(btc: float, price: float) -> None:
    with _lock:
        _fifo_lots.append({"btc_remaining": btc, "avg_cost_usd_per_btc": price})


def fifo_apply_sell(btc: float, price: float) -> float:
    """Return realized P&L in USD for this sell (FIFO)."""
    global _fifo_lots
    proceeds = btc * price
    cost = 0.0
    remaining = btc
    with _lock:
        new_lots: List[Dict[str, float]] = []
        for lot in _fifo_lots:
            if remaining <= 1e-18:
                new_lots.append(lot)
                continue
            take = min(lot["btc_remaining"], remaining)
            cost += take * lot["avg_cost_usd_per_btc"]
            remaining -= take
            left = lot["btc_remaining"] - take
            if left > 1e-18:
                new_lots.append({"btc_remaining": left, "avg_cost_usd_per_btc": lot["avg_cost_usd_per_btc"]})
        _fifo_lots = new_lots
    return proceeds - cost


def reset_fifo() -> None:
    global _fifo_lots
    with _lock:
        _fifo_lots = []
