from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator

from ..agent import civic_oauth, ledger as agent_ledger
from ..agent import llm_report
from ..agent import news_service
from ..agent import session_jwt
from ..agent import state as agent_state
from ..agent import ws_bus
from ..agent import rules as agent_rules
from ..agent.strategy_profile import build_profile_from_trades
from ..paper import autopilot as paper_autopilot
from ..paper import portfolio as paper_portfolio

router = APIRouter(tags=["agent"])
security = HTTPBearer(auto_error=False)


class AuthCodeBody(BaseModel):
    code: str = Field(..., min_length=1)
    redirect_uri: Optional[str] = None


class StartBody(BaseModel):
    reset_paper: bool = False
    starting_usd: float = Field(default=100_000.0, gt=0)


class StrategyBody(BaseModel):
    trades: Optional[List[Dict[str, Any]]] = None
    profile: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def _one_of(self) -> StrategyBody:
        if self.trades is None and self.profile is None:
            raise ValueError("Provide either trades or profile")
        return self


async def get_current_session(creds: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")
    try:
        payload = session_jwt.decode_token(creds.credentials)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}") from e
    sid = str(payload.get("sid") or "")
    if not sid:
        raise HTTPException(status_code=401, detail="Invalid session")
    sess = agent_state.get_server_session(sid)
    if not sess:
        raise HTTPException(status_code=401, detail="Session not found or expired")
    return {"sub": str(payload.get("sub") or ""), "sid": sid, "jwt": creds.credentials, "civic": sess}


@router.post("/auth")
def post_auth(body: AuthCodeBody):
    redirect = (body.redirect_uri or os.getenv("CIVIC_REDIRECT_URI") or "").strip()
    if not redirect:
        raise HTTPException(status_code=400, detail="redirect_uri required (body or CIVIC_REDIRECT_URI env)")
    try:
        tokens = civic_oauth.exchange_authorization_code(code=body.code.strip(), redirect_uri=redirect)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    sub = civic_oauth.pick_subject(tokens)
    sid = str(uuid.uuid4())
    agent_state.store_server_session(sid, {"sub": sub, "civic_tokens": tokens, "created_at": time.time()})
    try:
        token = session_jwt.mint_token(sub=sub, session_id=sid)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"access_token": token, "token_type": "bearer", "expires_in": 86400}


def _status_payload(session: Dict[str, Any]) -> Dict[str, Any]:
    paper = paper_portfolio.get_status()
    snap = news_service.get_snapshot()
    flags = agent_state.get_flags()
    return {
        "autonomous": flags["autonomous"],
        "kill_switch": flags["kill_switch"],
        "paper_started": bool(paper.get("started")),
        "session_sub": session["sub"],
        "news": {
            "fetched_at": snap["fetched_at"],
            "article_count": len(snap["articles"]),
            "error": snap["error"],
        },
        "rules": agent_rules.summarize_rules(),
        "executed_trade_count": len(agent_state.list_session_trades()),
        "blocked_trade_count": len(agent_state.list_blocked()),
        "autopilot_running": paper_autopilot.is_running(),
        "has_strategy_profile": agent_state.get_strategy_profile() is not None,
    }


@router.get("/status")
def get_status(session: Dict[str, Any] = Depends(get_current_session)):
    return _status_payload(session)


@router.post("/start")
def post_start(body: StartBody = StartBody(), session: Dict[str, Any] = Depends(get_current_session)):
    agent_state.set_kill_switch(False)
    agent_state.set_autonomous(True)
    if body.reset_paper:
        paper_portfolio.reset(starting_usd=body.starting_usd)
    st = paper_portfolio.get_status()
    if not st.get("started"):
        paper_portfolio.reset(starting_usd=body.starting_usd)
    try:
        paper_autopilot.start()
    except RuntimeError as e:
        agent_state.set_autonomous(False)
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        news_service.refresh_news()
        ws_bus.broadcast(
            {
                "event": "status",
                "data": {"autonomous": True, "kill_switch": False, "message": "agent started"},
            }
        )
    except Exception:
        pass
    return _status_payload(session)


@router.post("/unlock")
def post_unlock(session: Dict[str, Any] = Depends(get_current_session)):
    """Clear kill switch only (does not start Vigil). Use after POST /stop to allow manual paper trades again."""
    agent_state.set_kill_switch(False)
    try:
        ws_bus.broadcast({"event": "status", "data": {"kill_switch": False, "message": "unlock"}})
    except Exception:
        pass
    return _status_payload(session)


@router.post("/stop")
def post_stop(session: Dict[str, Any] = Depends(get_current_session)):
    agent_state.set_kill_switch(True)
    agent_state.set_autonomous(False)
    paper_autopilot.stop()
    try:
        ws_bus.broadcast(
            {
                "event": "status",
                "data": {"autonomous": False, "kill_switch": True, "message": "kill switch / stopped"},
            }
        )
    except Exception:
        pass
    return _status_payload(session)


@router.get("/trades")
def get_trades(session: Dict[str, Any] = Depends(get_current_session)):
    ex = [dict(t) for t in agent_state.list_session_trades()]
    bl = [dict(b) for b in agent_state.list_blocked()]
    merged: List[Dict[str, Any]] = []
    for t in ex:
        merged.append(t)
    for b in bl:
        merged.append(b)
    merged.sort(key=lambda x: float(x.get("ts") or 0), reverse=True)
    return {"trades": merged[:200]}


@router.get("/report")
def get_report(session: Dict[str, Any] = Depends(get_current_session)):
    stats = agent_ledger.closed_round_trips_stats()
    auto = agent_ledger.autonomous_trades()
    blocked = agent_state.list_blocked()[-30:]
    profile = agent_state.get_strategy_profile() or {}
    llm: Optional[Dict[str, Any]] = None
    if not agent_state.get_autonomous() and (auto or blocked):
        if profile:
            llm = llm_report.suggest_improvements(
                strategy_profile=profile,
                autonomous_trades=auto,
                blocked_sample=blocked,
            )
        else:
            llm = {
                "summary": "Upload a strategy profile via POST /strategy to enable LLM comparison.",
                "improvements": ["", "", ""],
                "error": "no_strategy_profile",
            }
    return {
        "performance": stats,
        "autonomous_trades": auto,
        "blocked_recent": blocked,
        "strategy_profile": profile if profile else None,
        "llm": llm,
        "autonomous_mode": agent_state.get_autonomous(),
    }


@router.post("/strategy")
def post_strategy(body: StrategyBody, session: Dict[str, Any] = Depends(get_current_session)):
    if body.profile is not None:
        agent_state.set_strategy_profile(body.profile)
        return {"ok": True, "profile": agent_state.get_strategy_profile()}
    assert body.trades is not None
    if len(body.trades) == 0:
        raise HTTPException(status_code=400, detail="trades list is empty")
    try:
        prof = build_profile_from_trades(list(body.trades))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    agent_state.set_strategy_profile(prof)
    return {"ok": True, "profile": prof}


@router.get("/news")
def get_news(
    refresh: bool = Query(False),
    session: Dict[str, Any] = Depends(get_current_session),
):
    if refresh:
        return news_service.refresh_news()
    return news_service.get_snapshot()


@router.websocket("/ws/feed")
async def websocket_feed(websocket: WebSocket, token: Optional[str] = Query(None)):
    await websocket.accept()
    if not token:
        await websocket.close(code=4401)
        return
    try:
        pl = session_jwt.decode_token(token)
        sid = str(pl.get("sid") or "")
        if not agent_state.get_server_session(sid):
            raise ValueError("session")
    except Exception:
        await websocket.close(code=4401)
        return
    ws_bus.capture_loop()
    ws_bus.register(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_bus.unregister(websocket)
