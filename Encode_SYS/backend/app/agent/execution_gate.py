from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from . import state as agent_state
from .rules import TradeContext, evaluate


def check_trade_allowed(
    *,
    side: str,
    usd: Optional[float],
    btc: Optional[float],
    source: str,
    paper_started: bool,
    session_sub: Optional[str] = None,
) -> Tuple[bool, str, str]:
    ctx = TradeContext(
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        paper_started=paper_started,
        session_sub=session_sub,
    )
    return evaluate(ctx)


def gate_or_block(
    *,
    side: str,
    usd: Optional[float],
    btc: Optional[float],
    source: str,
    paper_started: bool,
    session_sub: Optional[str] = None,
    news_snapshot_id: Optional[str] = None,
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    If blocked, records blocked trade and returns (False, entry).
    """
    ok, code, msg = check_trade_allowed(
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        paper_started=paper_started,
        session_sub=session_sub,
    )
    if ok:
        return True, None
    extra: Dict[str, Any] = {}
    if news_snapshot_id:
        extra["news_snapshot_id"] = news_snapshot_id
    entry = agent_state.record_blocked(
        rule_code=code,
        message=msg,
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        extra=extra,
    )
    try:
        from . import ws_bus

        ws_bus.broadcast({"event": "blocked", "data": entry})
    except Exception:
        pass
    return False, entry
