from __future__ import annotations

import asyncio
import json
import queue
import time
from functools import partial
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..agent import execution_gate
from ..agent import rules as agent_rules
from ..agent import session_jwt, state as agent_state
from ..agent.guardrail_digest import bucketed_series_for_blocked, recent_blocked
from ..agent.secrets_redact import redact_secrets_for_client
from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from ..paper import autopilot as paper_autopilot
from ..paper import backtest_replay as paper_backtest
from ..paper import performance as paper_performance
from ..paper import portfolio as paper_portfolio
from ..paper.paper_events import publish as publish_paper_event
from ..paper.paper_events import subscribe as subscribe_paper_events
from ..paper.paper_events import unsubscribe as unsubscribe_paper_events
from ..debug_session_log import write_debug as _dbg_write

router = APIRouter(prefix="/paper", tags=["paper"])
_optional_bearer = HTTPBearer(auto_error=False)

_FREE_BACKTEST_MAX_HOURS = 168
_PRO_BACKTEST_MAX_HOURS = 336  # 14 days


def _ensure_backtest_tier(*, lookback_hours: int, creds: Optional[HTTPAuthorizationCredentials]) -> None:
    if lookback_hours <= _FREE_BACKTEST_MAX_HOURS:
        return
    if lookback_hours > _PRO_BACKTEST_MAX_HOURS:
        raise HTTPException(
            status_code=400,
            detail=f"lookback_hours cannot exceed {_PRO_BACKTEST_MAX_HOURS} (14 days)",
        )
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "auth_required",
                "message": "14-day backtest requires a signed-in session (Authorization: Bearer)",
            },
        )
    try:
        pl = session_jwt.decode_token(creds.credentials)
        sid = str(pl.get("sid") or "")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}") from e
    if not sid or not agent_state.get_server_session(sid):
        raise HTTPException(status_code=401, detail="Session not found or expired")
    # Demo: any valid Civic-backed session may run 14-day replay; Pro is not required.


class PaperResetBody(BaseModel):
    starting_usd: float = Field(default=10_000.0, gt=0, description="Simulated GBP balance")


class PaperTradeBody(BaseModel):
    side: str = Field(..., description="buy or sell")
    usd: Optional[float] = Field(default=None, gt=0)
    btc: Optional[float] = Field(default=None, gt=0)


@router.post("/reset")
def paper_reset(body: PaperResetBody = PaperResetBody()):
    try:
        return paper_portfolio.reset(starting_usd=body.starting_usd)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Quote failed during reset: {e}") from e


@router.get("/status")
def paper_status():
    return paper_portfolio.get_status()


@router.get("/guardrails")
def paper_guardrails():
    blocks = agent_state.list_blocked_for(book="paper")
    posture = agent_rules.news_posture_snapshot()
    rules_summary = agent_rules.summarize_rules()
    rule_codes, series = bucketed_series_for_blocked(blocks, bucket_seconds=60.0)
    return {
        "book": "paper",
        "posture": posture,
        "rules_summary": rules_summary,
        "blocked_total": len(blocks),
        "series": series,
        "series_rule_codes": rule_codes,
        "recent_blocks": recent_blocked(blocks, limit=30),
        "kill_switch": agent_state.get_kill_switch(),
    }


# Narrative-only notional for the paper guardrails demo (blocked as demo_reckless_* codes, not max_notional).
_GUARDRAIL_DEMO_NOTIONAL_GBP = 250_000.0

_GUARDRAIL_DEMO_TICK: Dict[str, Dict[str, Any]] = {
    "headline_fomo": {
        "strategy_id": "guardrail-demo-headline",
        "name": "Demo: headline / social FOMO",
        "story": "Signal = trending headline + social velocity only; ignores book size, stops, and macro calendar.",
    },
    "size_vs_portfolio": {
        "strategy_id": "guardrail-demo-size",
        "name": "Demo: all-in notional",
        "story": "Proposed size is huge versus cash on hand — no reserve, no per-trade cap, no stress assumption.",
    },
    "martingale_no_stop": {
        "strategy_id": "guardrail-demo-martingale",
        "name": "Demo: double-down after loss",
        "story": "Increases size after a red trade with no stop and no max drawdown — unbounded loss path.",
    },
    "machine_gun_orders": {
        "strategy_id": "guardrail-demo-velocity",
        "name": "Demo: machine-gun buys",
        "story": "Would fire buys faster than a human can review — no cooldown, no rate limit, no intent audit.",
    },
}


class GuardrailDemoBody(BaseModel):
    scenario: str = Field(
        default="headline_fomo",
        description="Demo scenario key (headline_fomo | size_vs_portfolio | martingale_no_stop | machine_gun_orders)",
    )


@router.post("/guardrails/demo-block")
def paper_guardrails_demo_block(body: GuardrailDemoBody = GuardrailDemoBody()):
    """
    Run a dedicated UI demo trade source (guardrail_demo): always blocked with a scenario-specific code/message,
    records an audit row, and publishes vigil_tick on the paper SSE stream (no portfolio change).
    """
    st = paper_portfolio.get_status()
    if not st.get("started"):
        raise HTTPException(status_code=400, detail="Start paper trading (POST /api/paper/reset) first")

    try:
        scenario_key = agent_rules.resolve_guardrail_demo_scenario(body.scenario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

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

    allowed, blocked = execution_gate.gate_or_block(
        side="buy",
        usd=_GUARDRAIL_DEMO_NOTIONAL_GBP,
        btc=None,
        source="guardrail_demo",
        paper_started=True,
        session_sub=gate_session_sub,
        book="paper",
        demo_scenario=scenario_key,
    )

    rule_code = str(blocked.get("rule_code") if blocked else "unknown")
    guardrail_message = str(blocked.get("message") if blocked else "")
    err_trade = f"Trade blocked ({rule_code}): {blocked.get('message') if blocked else 'rule failure'}"

    tick_meta = _GUARDRAIL_DEMO_TICK[scenario_key]

    tick_snapshot = {
        "action": "blocked" if not allowed else "demo_allowed",
        "buy_edges": 1,
        "sell_edges": 0,
        "data_source": "guardrail_demo",
        "demo_scenario": scenario_key,
        "per_strategy": [
            {
                "id": tick_meta["strategy_id"],
                "name": tick_meta["name"],
                "signal": "BUY",
                "diagnostics": None,
                "error": None,
                "params": {
                    "story": tick_meta["story"],
                    "simulated_notional_gbp": _GUARDRAIL_DEMO_NOTIONAL_GBP,
                },
            }
        ],
        "trade_error": err_trade if not allowed else None,
        "order_routing": "internal",
        "rule_code": rule_code if not allowed else None,
        "guardrail_message": guardrail_message if not allowed else None,
    }

    publish_paper_event(
        "vigil_tick",
        {
            "t": time.time(),
            **tick_snapshot,
        },
    )

    return {
        "ok": True,
        "allowed": allowed,
        "scenario": scenario_key,
        "rule_code": rule_code,
        "message": guardrail_message,
        "reasons": blocked.get("reasons") if isinstance(blocked, dict) else None,
        "blocked_id": str(blocked.get("id")) if blocked else None,
    }


@router.get("/quote")
def paper_quote():
    try:
        return paper_portfolio.refresh_quote()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch spot: {e}") from e


def _optional_civic_sub(creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer)) -> Optional[str]:
    if creds is None or not creds.credentials:
        return None
    try:
        pl = session_jwt.decode_token(creds.credentials)
        sid = str(pl.get("sid") or "")
    except Exception:
        return None
    if not sid:
        return None
    sess = agent_state.get_server_session(sid)
    if not sess:
        return None
    sub = sess.get("sub")
    return str(sub).strip() if isinstance(sub, str) and sub.strip() else None


@router.post("/trade")
def paper_trade(body: PaperTradeBody, session_sub: Optional[str] = Depends(_optional_civic_sub)):
    side = body.side.strip().lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    try:
        if side == "buy":
            return paper_portfolio.market_order(side="buy", usd=body.usd, btc=None, session_sub=session_sub)
        return paper_portfolio.market_order(side="sell", usd=None, btc=body.btc, session_sub=session_sub)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Trade failed: {e}") from e


class AutopilotStrategyIn(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    template_type: str = Field(..., min_length=1)
    params: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class AutopilotConfigBody(BaseModel):
    interval_sec: float = Field(default=60.0, ge=60)
    lookback_hours: int = Field(default=168, ge=24, le=720)
    buy_usd: float = Field(default=1000.0, gt=0)
    sell_fraction: float = Field(default=0.25, gt=0, le=1)
    order_routing: str = Field(default="internal", description="internal | coinbase_sandbox")
    strategies: List[AutopilotStrategyIn] = Field(default_factory=list)


@router.get("/autopilot")
def paper_autopilot_get():
    return paper_autopilot.status()


@router.put("/autopilot/config")
def paper_autopilot_put_config(body: AutopilotConfigBody):
    if paper_autopilot.is_running():
        raise HTTPException(status_code=409, detail="Stop Vigil before changing config")
    try:
        raw_list = [s.model_dump() for s in body.strategies]
        paper_autopilot.set_config(
            interval_sec=body.interval_sec,
            lookback_hours=body.lookback_hours,
            buy_usd=body.buy_usd,
            sell_fraction=body.sell_fraction,
            order_routing=body.order_routing,
            strategies=raw_list,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    return paper_autopilot.status()


@router.post("/autopilot/start")
def paper_autopilot_start():
    try:
        return paper_autopilot.start()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e


@router.post("/autopilot/stop")
def paper_autopilot_stop():
    return paper_autopilot.stop()


_GRANULARITY_SEC = {
    "ONE_MINUTE": 60,
    "FIVE_MINUTE": 300,
    "FIFTEEN_MINUTE": 900,
    "ONE_HOUR": 3600,
    "SIX_HOUR": 21600,
    "ONE_DAY": 86400,
}


@router.get("/market/candles")
def paper_market_candles(
    product_id: str = Query("BTC-GBP", min_length=3, max_length=32),
    granularity: str = Query("ONE_HOUR"),
    limit: int = Query(168, ge=10, le=350),
):
    gran = granularity.strip().upper()
    if gran not in _GRANULARITY_SEC:
        raise HTTPException(
            status_code=400,
            detail=f"granularity must be one of {', '.join(sorted(_GRANULARITY_SEC))}",
        )
    pid = product_id.strip() or "BTC-GBP"
    sec = _GRANULARITY_SEC[gran]
    lookback_hours = max(24, min(720, int((limit * sec) / 3600) + 2))
    try:
        candles = fetch_coinbase_candles_btc_usd(
            product_id=pid,
            lookback_hours=lookback_hours,
            granularity=gran,
            limit=limit,
        )
        src = "coinbase_sandbox"
    except Exception as e:
        candles = generate_synthetic_candles_btc_usd(
            lookback_hours=lookback_hours,
            granularity=gran,
            limit=limit,
            seed=int(time.time()) & 0xFFFFFFFF,
        )
        src = f"synthetic_fallback:{e}"
    tail = candles[-limit:] if len(candles) > limit else candles
    # region agent log
    _dbg_write(
        location="paper_routes.py:paper_market_candles",
        message="candles_response",
        data={
            "tail_len": len(tail),
            "raw_len": len(candles),
            "data_source_prefix": (src[:120] if isinstance(src, str) else str(src)[:120]),
            "product_id": pid,
            "granularity": gran,
        },
        hypothesis_id="B",
    )
    # endregion
    return {"product_id": pid, "granularity": gran, "candles": tail, "data_source": src}


def _qget_timeout(q: queue.Queue, timeout_s: float) -> Optional[str]:
    try:
        return q.get(timeout=timeout_s)
    except queue.Empty:
        return None


@router.get("/events")
async def paper_events_sse():
    async def gen():
        # region agent log
        _dbg_write(
            location="paper_routes.py:paper_events_sse",
            message="sse_stream_open",
            data={},
            hypothesis_id="F",
        )
        # endregion
        q = subscribe_paper_events()
        try:
            snap = {
                "event": "snapshot",
                "data": {
                    "kill_switch": agent_state.get_kill_switch(),
                    "autopilot": paper_autopilot.status(),
                    "portfolio_started": bool(paper_portfolio.get_status().get("started")),
                },
            }
            yield f"data: {json.dumps(snap, default=str)}\n\n"
            loop = asyncio.get_running_loop()
            while True:
                line = await loop.run_in_executor(None, partial(_qget_timeout, q, 25.0))
                if line is None:
                    yield ": ping\n\n"
                else:
                    yield f"data: {line}\n\n"
        finally:
            unsubscribe_paper_events(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/halt")
def paper_halt():
    agent_state.set_kill_switch(True)
    paper_autopilot.stop()
    st = paper_autopilot.status()
    publish_paper_event("trading_halt", {"kill_switch": True, "autopilot_running": st.get("running")})
    return {"ok": True, "kill_switch": True, "autopilot": st}


@router.post("/resume")
def paper_resume():
    agent_state.set_kill_switch(False)
    publish_paper_event("trading_resume", {"kill_switch": False})
    return {"ok": True, "kill_switch": False}


@router.get("/performance-summary")
def paper_performance_summary():
    st = paper_portfolio.get_status()
    if not st.get("started"):
        raise HTTPException(status_code=400, detail="Start paper trading (POST /api/paper/reset) first")
    fills = list(st.get("fills") or [])
    start = float(st.get("starting_quote_usdc") or 0)
    if start <= 0:
        start = 10_000.0
    curve = list(st.get("equity_curve") or [])
    return paper_performance.summarize_fills(
        fills_newest_first=fills,
        starting_quote_usdc=start,
        equity_curve=curve,
        label="Paper",
    )


class BacktestBody(BaseModel):
    lookback_hours: int = Field(default=168, ge=24, le=_PRO_BACKTEST_MAX_HOURS)
    starting_usdc: float = Field(default=10_000.0, gt=0)
    buy_usd: float = Field(default=1_000.0, gt=0)
    sell_fraction: float = Field(default=0.25, gt=0, le=1)
    strategies: Optional[List[Dict[str, Any]]] = None


@router.post("/backtest-7d")
def paper_backtest_7d(
    body: BacktestBody = BacktestBody(),
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    """
    Stateless replay on hourly candles. Up to 7 days (168h) for everyone; up to 14 days (336h) for Pro + Bearer.
    """
    _ensure_backtest_tier(lookback_hours=body.lookback_hours, creds=creds)
    try:
        return paper_backtest.replay_vigil_backtest(
            lookback_hours=body.lookback_hours,
            starting_usdc=body.starting_usdc,
            buy_usd=body.buy_usd,
            sell_fraction=body.sell_fraction,
            strategies=body.strategies,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
