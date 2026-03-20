from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple

from ..agent import execution_gate, ledger as agent_ledger
from ..agent import state as agent_state
from ..coinbase.spot_price import fetch_btc_usd_spot

Side = Literal["buy", "sell"]
MAX_FILLS_RETURN = 50
MAX_EQUITY_POINTS = 500


@dataclass
class PaperPortfolioState:
    usd_cash: float = 0.0
    btc_balance: float = 0.0
    started: bool = False
    last_price: Optional[float] = None
    last_price_ts: Optional[float] = None
    last_quote_meta: Dict[str, Any] = field(default_factory=dict)
    fills: List[Dict[str, Any]] = field(default_factory=list)
    equity_snapshots: List[Dict[str, Any]] = field(default_factory=list)


_lock = threading.Lock()
_state = PaperPortfolioState()


def _append_equity(price: float) -> None:
    eq = _state.usd_cash + _state.btc_balance * price
    _state.equity_snapshots.append(
        {
            "t": time.time(),
            "usd_equity": round(eq, 8),
            "btc_price": price,
        }
    )
    if len(_state.equity_snapshots) > MAX_EQUITY_POINTS:
        _state.equity_snapshots = _state.equity_snapshots[-MAX_EQUITY_POINTS:]


def reset(*, starting_usd: float = 100_000.0) -> Dict[str, Any]:
    if starting_usd <= 0:
        raise ValueError("starting_usd must be > 0")
    with _lock:
        _state.usd_cash = float(starting_usd)
        _state.btc_balance = 0.0
        _state.started = True
        _state.fills.clear()
        _state.equity_snapshots.clear()
        _state.last_price = None
        _state.last_price_ts = None
        _state.last_quote_meta = {}
        try:
            price, meta = fetch_btc_usd_spot()
            _state.last_price = price
            _state.last_price_ts = time.time()
            _state.last_quote_meta = meta
            _append_equity(price)
        except Exception:
            # Reset still succeeds; user can refresh quote later.
            pass
        agent_state.clear_session_data()
        return get_status_unlocked()


def get_status_unlocked() -> Dict[str, Any]:
    fills = list(reversed(_state.fills))[:MAX_FILLS_RETURN]
    equity = list(_state.equity_snapshots[-200:])
    eq_now = None
    if _state.last_price is not None:
        eq_now = _state.usd_cash + _state.btc_balance * _state.last_price
    return {
        "started": _state.started,
        "usd_cash": round(_state.usd_cash, 8),
        "btc_balance": round(_state.btc_balance, 12),
        "last_btc_price_usd": _state.last_price,
        "last_quote_unix": _state.last_price_ts,
        "quote_meta": dict(_state.last_quote_meta),
        "usd_equity_mark": round(eq_now, 8) if eq_now is not None else None,
        "fills": fills,
        "equity_curve": equity,
    }


def get_status() -> Dict[str, Any]:
    with _lock:
        return get_status_unlocked()


def refresh_quote() -> Dict[str, Any]:
    with _lock:
        if not _state.started:
            raise RuntimeError("Portfolio not started; call reset first")
        price, meta = fetch_btc_usd_spot()
        _state.last_price = price
        _state.last_price_ts = time.time()
        _state.last_quote_meta = meta
        _append_equity(price)
        return get_status_unlocked()


def market_order(
    *,
    side: Side,
    usd: Optional[float] = None,
    btc: Optional[float] = None,
    source: str = "manual",
    session_sub: Optional[str] = None,
) -> Dict[str, Any]:
    st_pre = get_status()
    if not st_pre.get("started"):
        raise RuntimeError("Portfolio not started; call reset first")

    allowed, blocked = execution_gate.gate_or_block(
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        paper_started=True,
        session_sub=session_sub,
    )
    if not allowed:
        raise RuntimeError(
            f"Trade blocked ({blocked.get('rule_code') if blocked else 'unknown'}): "
            f"{blocked.get('message') if blocked else 'rule failure'}"
        )

    with _lock:
        if not _state.started:
            raise RuntimeError("Portfolio not started; call reset first")

        price, meta = fetch_btc_usd_spot()
        _state.last_price = price
        _state.last_price_ts = time.time()
        _state.last_quote_meta = meta

        if side == "buy":
            if usd is None or usd <= 0:
                raise ValueError("buy requires usd > 0")
            if btc is not None:
                raise ValueError("buy accepts usd only")
            if usd > _state.usd_cash + 1e-12:
                raise ValueError("Insufficient USD cash")
            btc_qty = usd / price
            _state.usd_cash -= usd
            _state.btc_balance += btc_qty
            fill = {
                "id": str(uuid.uuid4()),
                "side": "buy",
                "btc": round(btc_qty, 12),
                "usd": round(usd, 8),
                "price": price,
                "ts": time.time(),
            }
        else:
            if btc is None or btc <= 0:
                raise ValueError("sell requires btc > 0")
            if usd is not None:
                raise ValueError("sell accepts btc only")
            if btc > _state.btc_balance + 1e-15:
                raise ValueError("Insufficient BTC balance")
            usd_proceeds = btc * price
            _state.btc_balance -= btc
            _state.usd_cash += usd_proceeds
            fill = {
                "id": str(uuid.uuid4()),
                "side": "sell",
                "btc": round(btc, 12),
                "usd": round(usd_proceeds, 8),
                "price": price,
                "ts": time.time(),
            }

        _state.fills.append(fill)
        _append_equity(price)
        out = get_status_unlocked()
    agent_ledger.record_fill(fill=dict(fill), source=source)
    return out
