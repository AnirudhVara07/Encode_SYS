from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from . import state as agent_state
from .rules import TradeContext, collect_rule_failures, evaluate


def check_trade_allowed(
    *,
    side: str,
    usd: Optional[float],
    btc: Optional[float],
    source: str,
    paper_started: bool,
    session_sub: Optional[str] = None,
    book: str = "paper",
    demo_scenario: Optional[str] = None,
) -> Tuple[bool, str, str]:
    ctx = TradeContext(
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        paper_started=paper_started,
        session_sub=session_sub,
        book=book,
        demo_scenario=demo_scenario,
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
    book: str = "paper",
    demo_scenario: Optional[str] = None,
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    If blocked, records blocked trade and returns (False, entry).
    """
    ctx = TradeContext(
        side=side,
        usd=usd,
        btc=btc,
        source=source,
        paper_started=paper_started,
        session_sub=session_sub,
        book=book,
        demo_scenario=demo_scenario,
    )
    failures = collect_rule_failures(ctx)
    if not failures:
        return True, None
    code, msg = failures[0]
    reasons = [{"rule_code": c, "message": m} for c, m in failures]
    extra: Dict[str, Any] = {
        "book": (book or "paper").strip().lower(),
    }
    if session_sub:
        extra["owner_sub"] = session_sub
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
        reasons=reasons,
    )
    try:
        from . import ws_bus

        ws_bus.broadcast({"event": "blocked", "data": entry})
    except Exception:
        pass
    return False, entry
