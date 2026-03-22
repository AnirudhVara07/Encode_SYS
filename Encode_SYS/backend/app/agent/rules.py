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


# UI guardrail demo: each variant is a different "reckless" narrative; all blocked before any fill.
_GUARDRAIL_DEMO_SCENARIOS: Dict[str, Tuple[str, str]] = {
    "headline_fomo": (
        "demo_reckless_headline",
        "Blocked (demo): buy fired only on a breaking headline and social momentum — no second data source, "
        "no stop, no max loss. That is headline-chasing, not a risk-bounded strategy.",
    ),
    "size_vs_portfolio": (
        "demo_reckless_size",
        "Blocked (demo): proposed notional is huge versus book cash — no reserve, no position cap, "
        "one bad print could wipe the portfolio. Sizing has to respect capital and buffers.",
    ),
    "martingale_no_stop": (
        "demo_reckless_no_stop",
        "Blocked (demo): bot doubled down after a loss with no stop and no drawdown limit — classic martingale risk. "
        "Guardrails exist to cap how much loss can stack before someone reviews.",
    ),
    "machine_gun_orders": (
        "demo_reckless_velocity",
        "Blocked (demo): automation would spam buys faster than a human could supervise — no cooldown, "
        "no intent checksum. Velocity and audit gates stop runaway bots.",
    ),
}
_GUARDRAIL_DEMO_DEFAULT = "headline_fomo"


def guardrail_demo_scenario_keys() -> Tuple[str, ...]:
    return tuple(_GUARDRAIL_DEMO_SCENARIOS.keys())


def resolve_guardrail_demo_scenario(key: Optional[str]) -> str:
    k = (key or _GUARDRAIL_DEMO_DEFAULT).strip().lower()
    if k not in _GUARDRAIL_DEMO_SCENARIOS:
        raise ValueError(f"Unknown guardrail demo scenario {key!r}; use one of {guardrail_demo_scenario_keys()}")
    return k


@dataclass
class TradeContext:
    side: str  # buy | sell
    usd: Optional[float]
    btc: Optional[float]
    source: str  # manual | vigil | guardrail_demo
    paper_started: bool
    session_sub: Optional[str] = None
    book: str = "paper"  # paper | coinbase_live
    demo_scenario: Optional[str] = None  # guardrail_demo only; key into _GUARDRAIL_DEMO_SCENARIOS


def _news_strict_blocks_vigil() -> Tuple[bool, str]:
    if os.getenv("NEWS_STRICT_MODE", "").lower() not in ("1", "true", "yes"):
        return False, ""
    for h in list_macro_matching_headline_titles(max_titles=1):
        return True, f"news_strict: headline matches macro filter ({h[:80]}…)"
    return False, ""


def collect_rule_failures(ctx: TradeContext) -> List[Tuple[str, str]]:
    """
    Every rule that fails for this context, in pipeline order (not short-circuited).
    Used for audit rows and UI so one blocked trade can list multiple causes (e.g. kill switch + demo narrative).
    """
    failures: List[Tuple[str, str]] = []

    if agent_state.get_kill_switch():
        failures.append(("kill_switch", "Global kill switch is ON"))

    book = (ctx.book or "paper").strip().lower()
    if book not in ("paper", "coinbase_live"):
        failures.append(("invalid_book", "book must be paper or coinbase_live"))
        return failures

    if book == "paper" and not ctx.paper_started:
        failures.append(("paper_not_started", "Paper portfolio not started"))

    src = (ctx.source or "").strip().lower()
    if src == "guardrail_demo":
        if book != "paper":
            failures.append(("invalid_source", "guardrail_demo is only used for the paper book"))
        else:
            try:
                sk = resolve_guardrail_demo_scenario(ctx.demo_scenario)
            except ValueError as e:
                failures.append(("demo_invalid_scenario", str(e)))
            else:
                code, msg = _GUARDRAIL_DEMO_SCENARIOS[sk]
                failures.append((code, msg))
        return failures

    max_quote = float(os.getenv("AGENT_MAX_TRADE_GBP") or os.getenv("AGENT_MAX_TRADE_USD", "1e12"))
    if ctx.side == "buy" and ctx.usd is not None and ctx.usd > max_quote:
        failures.append(
            ("max_notional", f"Trade amount {ctx.usd} exceeds max notional (AGENT_MAX_TRADE_GBP or AGENT_MAX_TRADE_USD)"),
        )

    if ctx.side == "sell" and ctx.btc is not None:
        max_btc = float(os.getenv("AGENT_MAX_TRADE_BTC", "1e9"))
        if ctx.btc > max_btc:
            failures.append(("max_btc", "Sell btc exceeds AGENT_MAX_TRADE_BTC"))

    min_cash = float(os.getenv("AGENT_MIN_GBP_CASH_AFTER_BUY") or os.getenv("AGENT_MIN_USD_CASH_AFTER_BUY", "0"))
    if book == "paper" and ctx.side == "buy" and ctx.usd is not None and min_cash > 0:
        from ..paper import portfolio as paper_portfolio

        st = paper_portfolio.get_status()
        cash = float(st.get("usd_cash") or 0.0)
        if cash - ctx.usd < min_cash - 1e-9:
            failures.append(("min_cash_reserve", f"Buy would leave GBP cash below {min_cash}"))

    if ctx.source == "vigil":
        strict, msg = _news_strict_blocks_vigil()
        if strict:
            failures.append(("news_block", msg))

    if os.getenv("AGENT_REQUIRE_SESSION", "").lower() in ("1", "true", "yes"):
        if not ctx.session_sub:
            failures.append(("session_required", "AGENT_REQUIRE_SESSION is set but no session"))

    return failures


def evaluate(ctx: TradeContext) -> Tuple[bool, str, str]:
    """
    Ordered rules. Returns (allowed, code, message) for the first failing rule (chart / primary code).
    """
    failures = collect_rule_failures(ctx)
    if not failures:
        return True, "ok", ""
    code, msg = failures[0]
    return False, code, msg


def summarize_rules() -> List[Dict[str, Any]]:
    return [
        {"id": "kill_switch", "description": "Blocks all trades when ON"},
        {"id": "paper_not_started", "description": "Paper portfolio must be reset (paper book only)"},
        {
            "id": "max_notional",
            "description": f"AGENT_MAX_TRADE_GBP={os.getenv('AGENT_MAX_TRADE_GBP') or os.getenv('AGENT_MAX_TRADE_USD', '1e12')}",
        },
        {"id": "news_block", "description": "NEWS_STRICT_MODE blocks Vigil automation on macro headlines"},
        {
            "id": "demo_reckless_headline",
            "description": "UI demo: headline/social FOMO only (POST /api/paper/guardrails/demo-block)",
        },
        {
            "id": "demo_reckless_size",
            "description": "UI demo: notional vs portfolio / no reserve (demo-block)",
        },
        {
            "id": "demo_reckless_no_stop",
            "description": "UI demo: martingale-style doubling, no stop (demo-block)",
        },
        {
            "id": "demo_reckless_velocity",
            "description": "UI demo: unsupervised order spam velocity (demo-block)",
        },
        {"id": "demo_invalid_scenario", "description": "Invalid demo scenario id in request body"},
        {"id": "session_required", "description": "Optional AGENT_REQUIRE_SESSION"},
    ]
