from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..paper import autopilot as paper_autopilot
from ..paper import portfolio as paper_portfolio

router = APIRouter(prefix="/paper", tags=["paper"])


class PaperResetBody(BaseModel):
    starting_usd: float = Field(default=100_000.0, gt=0)


class PaperTradeBody(BaseModel):
    side: str = Field(..., description="buy or sell")
    usd: Optional[float] = Field(default=None, gt=0)
    btc: Optional[float] = Field(default=None, gt=0)


@router.post("/reset")
def paper_reset(body: PaperResetBody = PaperResetBody()):
    try:
        return paper_portfolio.reset(starting_usd=body.starting_usd)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
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
        raise HTTPException(status_code=400, detail=str(e)) from e
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
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
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
        raise HTTPException(status_code=400, detail=str(e)) from e
    return paper_autopilot.status()


@router.post("/autopilot/start")
def paper_autopilot_start():
    try:
        return paper_autopilot.start()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/autopilot/stop")
def paper_autopilot_stop():
    return paper_autopilot.stop()
