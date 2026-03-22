from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from . import state as agent_state

# Macro headline pattern when NEWS_STRICT_MODE blocks Vigil automation only
_MACRO_HEADLINE_RE = re.compile(
    os.getenv("NEWS_MACRO_REGEX", r"CPI|FOMC|NFP|recession|Fed rate|GDP|inflation|unemployment"),
    re.IGNORECASE,
)


def macro_regex_pattern() -> str:
    return os.getenv("NEWS_MACRO_REGEX", r"CPI|FOMC|NFP|recession|Fed rate|GDP|inflation|unemployment")


def list_macro_matching_headline_titles(*, max_titles: int = 50) -> List[str]:
    """Headlines that match the macro regex (same signal as NEWS_STRICT_MODE vigil block)."""
    try:
        from . import news_service
    except ImportError:
        return []
    out: List[str] = []
    for h in news_service.get_headline_titles():
        if h and _MACRO_HEADLINE_RE.search(h):
            out.append((h or "")[:200])
            if len(out) >= max_titles:
                break
    return out


def news_posture_snapshot() -> Dict[str, Any]:
    strict = os.getenv("NEWS_STRICT_MODE", "").lower() in ("1", "true", "yes")
    matches = list_macro_matching_headline_titles() if strict else []
    return {
        "strict": strict,
        "macro_regex": macro_regex_pattern(),
        "matching_headlines": matches,
        "matching_count": len(matches),
    }


@dataclass
class TradeContext:
    side: str  # buy | sell
    usd: Optional[float]
    btc: Optional[float]
    source: str  # manual | vigil
    paper_started: bool
    session_sub: Optional[str] = None
    book: str = "paper"  # paper | coinbase_live


def _news_strict_blocks_vigil() -> Tuple[bool, str]:
    if os.getenv("NEWS_STRICT_MODE", "").lower() not in ("1", "true", "yes"):
        return False, ""
    for h in list_macro_matching_headline_titles(max_titles=1):
        return True, f"news_strict: headline matches macro filter ({h[:80]}…)"
    return False, ""


def evaluate(ctx: TradeContext) -> Tuple[bool, str, str]:
    """
    Ordered rules. Returns (allowed, code, message).
    """
    if agent_state.get_kill_switch():
        return False, "kill_switch", "Global kill switch is ON"

    book = (ctx.book or "paper").strip().lower()
    if book not in ("paper", "coinbase_live"):
        return False, "invalid_book", "book must be paper or coinbase_live"

    if book == "paper" and not ctx.paper_started:
        return False, "paper_not_started", "Paper portfolio not started"

    max_quote = float(os.getenv("AGENT_MAX_TRADE_GBP") or os.getenv("AGENT_MAX_TRADE_USD", "1e12"))
    if ctx.side == "buy" and ctx.usd is not None and ctx.usd > max_quote:
        return False, "max_notional", f"Trade amount {ctx.usd} exceeds max notional (AGENT_MAX_TRADE_GBP or AGENT_MAX_TRADE_USD)"

    if ctx.side == "sell" and ctx.btc is not None:
        # optional max btc per sell
        max_btc = float(os.getenv("AGENT_MAX_TRADE_BTC", "1e9"))
        if ctx.btc > max_btc:
            return False, "max_btc", f"Sell btc exceeds AGENT_MAX_TRADE_BTC"

    min_cash = float(os.getenv("AGENT_MIN_GBP_CASH_AFTER_BUY") or os.getenv("AGENT_MIN_USD_CASH_AFTER_BUY", "0"))
    if book == "paper" and ctx.side == "buy" and ctx.usd is not None and min_cash > 0:
        from ..paper import portfolio as paper_portfolio

        st = paper_portfolio.get_status()
        cash = float(st.get("usd_cash") or 0.0)
        if cash - ctx.usd < min_cash - 1e-9:
            return False, "min_cash_reserve", f"Buy would leave GBP cash below {min_cash}"

    if ctx.source == "vigil":
        strict, msg = _news_strict_blocks_vigil()
        if strict:
            return False, "news_block", msg

    if os.getenv("AGENT_REQUIRE_SESSION", "").lower() in ("1", "true", "yes"):
        if not ctx.session_sub:
            return False, "session_required", "AGENT_REQUIRE_SESSION is set but no session"

    return True, "ok", ""


def summarize_rules() -> List[Dict[str, Any]]:
    return [
        {"id": "kill_switch", "description": "Blocks all trades when ON"},
        {"id": "paper_not_started", "description": "Paper portfolio must be reset (paper book only)"},
        {
            "id": "max_notional",
            "description": f"AGENT_MAX_TRADE_GBP={os.getenv('AGENT_MAX_TRADE_GBP') or os.getenv('AGENT_MAX_TRADE_USD', '1e12')}",
        },
        {"id": "news_block", "description": "NEWS_STRICT_MODE blocks Vigil automation on macro headlines"},
        {"id": "session_required", "description": "Optional AGENT_REQUIRE_SESSION"},
    ]
