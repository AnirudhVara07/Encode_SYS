from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..agent import session_jwt, state as agent_state
from ..agent.secrets_redact import redact_secrets_for_client
from ..paper import autopilot as paper_autopilot
from ..paper import backtest_replay as paper_backtest
from ..paper import performance as paper_performance
from ..paper import portfolio as paper_portfolio

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
    if not agent_state.get_session_is_pro(sid):
        raise HTTPException(
            status_code=403,
            detail={"code": "upgrade_required", "message": "Upgrade to Pro for 14-day backtest"},
        )


class PaperResetBody(BaseModel):
    starting_usd: float = Field(default=10_000.0, gt=0, description="Simulated USDC balance")


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


@router.get("/quote")
def paper_quote():
    try:
        return paper_portfolio.refresh_quote()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=redact_secrets_for_client(str(e))) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch spot: {e}") from e


@router.post("/trade")
def paper_trade(body: PaperTradeBody):
    side = body.side.strip().lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    try:
        if side == "buy":
            return paper_portfolio.market_order(side="buy", usd=body.usd, btc=None)
        return paper_portfolio.market_order(side="sell", usd=None, btc=body.btc)
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
    interval_sec: float = Field(default=300.0, ge=60)
    lookback_hours: int = Field(default=168, ge=24, le=720)
    buy_usd: float = Field(default=1000.0, gt=0)
    sell_fraction: float = Field(default=0.25, gt=0, le=1)
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
