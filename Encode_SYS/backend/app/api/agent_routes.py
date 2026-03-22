from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from .deps import get_current_session
from ..agent import civic_oauth, ledger as agent_ledger
from ..agent.secrets_redact import redact_secrets_for_client
from ..agent import llm_report
from ..agent import news_service
from ..agent import session_jwt
from ..agent import state as agent_state
from ..agent import ws_bus
from ..agent import rules as agent_rules
from ..agent.live_wallet import UPGRADE_MESSAGE
from ..agent.strategy_profile import build_profile_from_trades
from ..agent.universal_strategy import (
    build_strategy_profile_from_universal,
    bytes_to_llm_text,
    detection_to_dict,
    normalize_strategy_json,
)
from ..agent.apply_uploaded_strategy_autopilots import apply_suggested_strategies_to_autopilots
from ..agent.universal_to_live_template import suggest_live_autopilot_strategies
from ..agent import universal_strategy_llm
from ..paper import autopilot as paper_autopilot
from ..paper import portfolio as paper_portfolio
from ..trading_guard import verify_live_trading_captcha

router = APIRouter(tags=["agent"])


class AuthCodeBody(BaseModel):
    code: str = Field(..., min_length=1)
    redirect_uri: Optional[str] = None
    code_verifier: Optional[str] = Field(
        default=None,
        description="PKCE code_verifier when authorization used code_challenge_method=S256",
    )


class StartBody(BaseModel):
    reset_paper: bool = False
    starting_usd: float = Field(default=10_000.0, gt=0)
    execution_mode: Optional[str] = Field(
        default=None,
        description="paper (simulated GBP) or live (on-chain via AgentKit — Pro only)",
    )
    captcha_token: Optional[str] = Field(
        default=None,
        description="Turnstile token when starting in live mode and TURNSTILE_SECRET_KEY is set",
    )


class ProfilePatchBody(BaseModel):
    is_pro: Optional[bool] = None
    execution_mode: Optional[str] = Field(
        default=None,
        description="paper or live — live autonomous requires Pro",
    )


class StrategyBody(BaseModel):
    trades: Optional[List[Dict[str, Any]]] = None
    profile: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def _one_of(self) -> StrategyBody:
        if self.trades is None and self.profile is None:
            raise ValueError("Provide either trades or profile")
        return self


class UniversalStrategyConfirmBody(BaseModel):
    parse_id: str = Field(..., min_length=8, max_length=128)
    user_corrections: Optional[str] = Field(default=None, max_length=4000)
    strategy_json_override: Optional[Dict[str, Any]] = None
    preview_only: bool = False


_MAX_STRATEGY_UPLOAD_BYTES = 15 * 1024 * 1024


@router.get("/civic-oauth-config")
def get_civic_oauth_config():
    """Public values for the SPA to build the Civic authorize URL (client_id is not a secret)."""
    client_id = os.getenv("CIVIC_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="CIVIC_CLIENT_ID not configured")
    authorize = os.getenv("CIVIC_AUTHORIZE_URL", "https://auth.civic.com/oauth/auth").strip()
    scope = os.getenv("CIVIC_SCOPE", "openid email profile").strip() or "openid email profile"
    return {"client_id": client_id, "authorize_url": authorize, "scope": scope}


@router.post("/auth")
def post_auth(body: AuthCodeBody):
    redirect = (body.redirect_uri or os.getenv("CIVIC_REDIRECT_URI") or "").strip()
    if not redirect:
        raise HTTPException(status_code=400, detail="redirect_uri required (body or CIVIC_REDIRECT_URI env)")
    verifier = (body.code_verifier or "").strip() or None
    try:
        tokens = civic_oauth.exchange_authorization_code(
            code=body.code.strip(),
            redirect_uri=redirect,
            code_verifier=verifier,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=redact_secrets_for_client(str(e))) from e
    sub = civic_oauth.pick_subject(tokens)
    sid = str(uuid.uuid4())
    agent_state.store_server_session(sid, {"sub": sub, "civic_tokens": tokens, "created_at": time.time()})
    try:
        token = session_jwt.mint_token(sub=sub, session_id=sid)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=redact_secrets_for_client(str(e))) from e
    return {"access_token": token, "token_type": "bearer", "expires_in": 86400}


def _status_payload(session: Dict[str, Any]) -> Dict[str, Any]:
    paper = paper_portfolio.get_status()
    snap = news_service.get_snapshot()
    flags = agent_state.get_flags()
    sid = session.get("sid") or ""
    return {
        "autonomous": flags["autonomous"],
        "kill_switch": flags["kill_switch"],
        "paper_started": bool(paper.get("started")),
        "session_sub": session["sub"],
        "is_pro": agent_state.get_session_is_pro(sid),
        "execution_mode": agent_state.get_execution_mode(),
        "news": {
            "fetched_at": snap["fetched_at"],
            "article_count": len(snap["articles"]),
            "error": redact_secrets_for_client(str(snap["error"])) if snap.get("error") is not None else None,
        },
        "rules": agent_rules.summarize_rules(),
        "executed_trade_count": len(agent_state.list_session_trades()),
        "blocked_trade_count": len(agent_state.list_blocked()),
        "autopilot_running": paper_autopilot.is_running(),
        "has_strategy_profile": agent_state.get_strategy_profile() is not None,
        "live_stub_fill_count": len(agent_state.list_live_stub_fills(500)),
    }


@router.get("/status")
def get_status(session: Dict[str, Any] = Depends(get_current_session)):
    return _status_payload(session)


@router.get("/profile")
def get_profile(session: Dict[str, Any] = Depends(get_current_session)):
    sid = str(session.get("sid") or "")
    return {
        "is_pro": agent_state.get_session_is_pro(sid),
        "execution_mode": agent_state.get_execution_mode(),
    }


@router.patch("/profile")
def patch_profile(body: ProfilePatchBody, session: Dict[str, Any] = Depends(get_current_session)):
    sid = str(session.get("sid") or "")
    if body.is_pro is not None:
        agent_state.set_session_is_pro(sid, body.is_pro)
    if body.execution_mode is not None:
        try:
            agent_state.set_execution_mode(body.execution_mode)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    return {
        "is_pro": agent_state.get_session_is_pro(sid),
        "execution_mode": agent_state.get_execution_mode(),
    }


@router.post("/start")
def post_start(
    request: Request,
    body: StartBody = StartBody(),
    session: Dict[str, Any] = Depends(get_current_session),
):
    sid = str(session.get("sid") or "")
    mode = (body.execution_mode or agent_state.get_execution_mode() or "paper").strip().lower()
    if mode not in ("paper", "live"):
        raise HTTPException(status_code=400, detail="execution_mode must be paper or live")
    if mode == "live" and not agent_state.get_session_is_pro(sid):
        raise HTTPException(
            status_code=403,
            detail={"code": "upgrade_required", "message": UPGRADE_MESSAGE},
        )
    if mode == "live":
        try:
            verify_live_trading_captcha(body.captcha_token, request.client.host if request.client else None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        agent_state.set_execution_mode(mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e

    agent_state.set_kill_switch(False)
    agent_state.set_autonomous(True)
    if body.reset_paper:
        paper_portfolio.reset(starting_usd=body.starting_usd)
    st = paper_portfolio.get_status()
    if not st.get("started"):
        paper_portfolio.reset(starting_usd=body.starting_usd)
    agent_state.set_autopilot_owner_session_id(sid)
    try:
        paper_autopilot.start()
    except RuntimeError as e:
        agent_state.set_autonomous(False)
        agent_state.set_autopilot_owner_session_id(None)
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
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
    agent_state.set_autopilot_owner_session_id(None)
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
    live = [dict(x) for x in agent_state.list_live_stub_fills(200)]
    merged: List[Dict[str, Any]] = []
    for t in ex:
        merged.append(t)
    for b in bl:
        merged.append(b)
    for x in live:
        merged.append({**x, "type": "live_stub"})
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
                "safety": {"level": "ok", "source": "none"},
            }
    return {
        "performance": stats,
        "autonomous_trades": auto,
        "blocked_recent": blocked,
        "strategy_profile": profile if profile else None,
        "llm": llm,
        "autonomous_mode": agent_state.get_autonomous(),
    }


@router.post("/strategy/parse")
async def post_strategy_parse(
    strategy_file: UploadFile = File(...),
    session: Dict[str, Any] = Depends(get_current_session),
):
    """
    Upload any supported strategy file; server detects format and asks the LLM for a normalized strategy JSON.
    Use POST /strategy/parse/confirm to save after the user reviews user_summary.
    """
    fn = (strategy_file.filename or "strategy.txt").strip() or "strategy.txt"
    data = await strategy_file.read()
    if len(data) > _MAX_STRATEGY_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 15MB)")

    text, detection, conv_err = bytes_to_llm_text(filename=fn, data=data)
    if conv_err:
        raise HTTPException(status_code=400, detail=conv_err)

    strat, llm_err, _, safety = universal_strategy_llm.extract_strategy_via_llm(
        filename=fn,
        text=text,
        detection=detection,
    )
    if llm_err or strat is None:
        blocked = isinstance(safety, dict) and safety.get("level") == "blocked"
        status = 400 if blocked else 503
        return JSONResponse(
            status_code=status,
            content={"detail": llm_err or "LLM extraction failed", "safety": safety},
        )

    parse_id = str(uuid.uuid4())
    sid = str(session.get("sid") or "")
    agent_state.store_pending_universal_parse(
        parse_id,
        session_id=sid,
        strategy_json=strat,
        detection=detection_to_dict(detection),
        filename=fn,
    )

    return {
        "parse_id": parse_id,
        "filename": fn,
        "detection": detection_to_dict(detection),
        "user_summary": strat.get("user_summary") or strat.get("raw_summary") or "",
        "strategy_json": strat,
        "safety": safety,
    }


@router.post("/strategy/parse/confirm")
def post_strategy_parse_confirm(
    body: UniversalStrategyConfirmBody,
    session: Dict[str, Any] = Depends(get_current_session),
):
    pending = agent_state.get_pending_universal_parse(body.parse_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Parse session expired or unknown parse_id")
    if str(pending.get("sid") or "") != str(session.get("sid") or ""):
        raise HTTPException(status_code=403, detail="parse_id belongs to another session")

    working: Dict[str, Any] = dict(body.strategy_json_override or pending["strategy_json"])
    last_safety: Dict[str, Any] = {"level": "ok", "source": "none"}

    if body.user_corrections and body.user_corrections.strip():
        refined, err, refine_safety = universal_strategy_llm.refine_strategy_via_llm(
            current=working,
            user_corrections=body.user_corrections.strip(),
        )
        if err or refined is None:
            blocked = isinstance(refine_safety, dict) and refine_safety.get("level") == "blocked"
            status = 400 if blocked else 503
            return JSONResponse(
                status_code=status,
                content={"detail": err or "Refinement failed", "safety": refine_safety},
            )
        working = refined
        last_safety = refine_safety
        agent_state.update_pending_universal_parse(body.parse_id, working)

    if body.preview_only:
        return {
            "ok": True,
            "preview_only": True,
            "user_summary": working.get("user_summary") or working.get("raw_summary") or "",
            "strategy_json": working,
            "safety": last_safety,
        }

    prof = build_strategy_profile_from_universal(working)
    agent_state.set_strategy_profile(prof)
    agent_state.pop_pending_universal_parse(body.parse_id)
    norm = normalize_strategy_json(working, fallback_platform=str(working.get("source_platform") or "unknown"))
    live_strats, live_note = suggest_live_autopilot_strategies(universal=norm)
    apply_out = apply_suggested_strategies_to_autopilots(
        civic_sub=str(session.get("sub") or ""),
        suggested=live_strats,
    )
    return {
        "ok": True,
        "saved": True,
        "profile": agent_state.get_strategy_profile(),
        "user_summary": working.get("user_summary") or working.get("raw_summary") or "",
        "strategy_json": working,
        "safety": last_safety,
        "live_autopilot_suggestion": {"strategies": live_strats, "note": live_note},
        "autopilot_apply": apply_out,
    }


@router.get("/strategy/live-autopilot-suggestion")
def get_live_autopilot_suggestion(_sess: Dict[str, Any] = Depends(get_current_session)):
    """Map saved universal strategy profile to executable Vigil template rows (paper + live use the same profile)."""
    prof = agent_state.get_strategy_profile() or {}
    us = prof.get("universal_strategy")
    if not isinstance(us, dict):
        return {
            "strategies": [],
            "note": "No strategy import yet. Upload a file and save to Vigil.",
            "user_summary": "",
            "raw_summary": "",
            "universal_strategy": None,
        }
    norm = normalize_strategy_json(us, fallback_platform=str(us.get("source_platform") or "unknown"))
    strats, note = suggest_live_autopilot_strategies(universal=norm)
    return {
        "strategies": strats,
        "note": note,
        "user_summary": str(norm.get("user_summary") or "").strip(),
        "raw_summary": str(norm.get("raw_summary") or "").strip(),
        "universal_strategy": norm,
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
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    agent_state.set_strategy_profile(prof)
    return {"ok": True, "profile": prof}


@router.get("/strategy/export")
def get_strategy_export(session: Dict[str, Any] = Depends(get_current_session)):
    """Downloadable snapshot: imported profile + current paper autopilot template config."""
    prof = agent_state.get_strategy_profile()
    return {
        "export_kind": "vigil_use_vigil",
        "exported_at_unix": time.time(),
        "session_sub": session.get("sub"),
        "execution_mode": agent_state.get_execution_mode(),
        "strategy_profile": prof,
        "paper_autopilot": paper_autopilot.get_config_snapshot(),
        "agent_flags": agent_state.get_flags(),
    }


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
