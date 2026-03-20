from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import state as agent_state
from . import ws_bus


def record_fill(*, fill: Dict[str, Any], source: str) -> Dict[str, Any]:
    side = fill.get("side")
    btc = float(fill.get("btc") or 0.0)
    price = float(fill.get("price") or 0.0)
    realized_pnl: Optional[float] = None
    if side == "buy":
        agent_state.fifo_apply_buy(btc, price)
    elif side == "sell":
        realized_pnl = agent_state.fifo_apply_sell(btc, price)

    entry = {
        "type": "executed",
        "fill_id": fill.get("id"),
        "side": side,
        "btc": btc,
        "usd": fill.get("usd"),
        "price": price,
        "ts": fill.get("ts"),
        "source": source,
        "realized_pnl_usd": realized_pnl,
    }
    agent_state.record_executed_trade(entry)
    try:
        ws_bus.broadcast({"event": "fill", "data": entry})
    except Exception:
        pass
    return entry


def closed_round_trips_stats() -> Dict[str, Any]:
    """Aggregate realized P&L from sells only (FIFO matched)."""
    trades = agent_state.list_session_trades()
    sells = [t for t in trades if t.get("type") == "executed" and t.get("side") == "sell"]
    pnls = [float(t["realized_pnl_usd"]) for t in sells if t.get("realized_pnl_usd") is not None]
    wins = sum(1 for p in pnls if p > 1e-12)
    losses = sum(1 for p in pnls if p < -1e-12)
    flat = sum(1 for p in pnls if abs(p) <= 1e-12)
    total = sum(pnls)
    return {
        "closed_trade_count": len(pnls),
        "wins": wins,
        "losses": losses,
        "breakeven": flat,
        "win_rate": (wins / len(pnls)) if pnls else None,
        "total_realized_pnl_usd": round(total, 8),
    }


def autonomous_trades() -> List[Dict[str, Any]]:
    return [t for t in agent_state.list_session_trades() if t.get("source") == "vigil"]
