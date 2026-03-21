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
_execution_mode: str = "paper"  # "paper" | "live" — live on-chain path requires Pro + stub AgentKit wallet
_autopilot_owner_session_id: Optional[str] = None
_strategy_profile: Optional[Dict[str, Any]] = None
_blocked_trades: Deque[Dict[str, Any]] = deque(maxlen=MAX_BLOCKED)
_session_trades: List[Dict[str, Any]] = []
_live_stub_fills: Deque[Dict[str, Any]] = deque(maxlen=200)
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


def get_execution_mode() -> str:
    with _lock:
        return _execution_mode


def set_execution_mode(mode: str) -> None:
    global _execution_mode
    m = (mode or "paper").strip().lower()
    if m not in ("paper", "live"):
        raise ValueError("execution_mode must be paper or live")
    with _lock:
        _execution_mode = m


def get_autopilot_owner_session_id() -> Optional[str]:
    with _lock:
        return _autopilot_owner_session_id


def set_autopilot_owner_session_id(sid: Optional[str]) -> None:
    global _autopilot_owner_session_id
    with _lock:
        _autopilot_owner_session_id = sid


def get_session_is_pro(session_id: str) -> bool:
    with _lock:
        sess = _sessions.get(session_id) or {}
        return bool(sess.get("is_pro"))


def set_session_is_pro(session_id: str, is_pro: bool) -> None:
    with _lock:
        if session_id not in _sessions:
            _sessions[session_id] = {}
        _sessions[session_id]["is_pro"] = bool(is_pro)


def record_live_stub_fill(entry: Dict[str, Any]) -> None:
    with _lock:
        _live_stub_fills.appendleft(dict(entry))


def list_live_stub_fills(limit: int = 100) -> List[Dict[str, Any]]:
    with _lock:
        return list(_live_stub_fills)[:limit]


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
        merged = dict(payload)
        merged.setdefault("is_pro", False)
        _sessions[session_id] = merged


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
