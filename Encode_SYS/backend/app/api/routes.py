import os
import threading
import time
import uuid
from typing import Any, Dict, List, Literal, Optional

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..agent import rules as agent_rules
from ..agent.news_headlines_llm import strategy_insights_from_headlines
from ..agent.secrets_redact import redact_secrets_for_client
from ..agent import session_jwt, state as agent_state
from ..agent.strategy_chat_llm import run_strategy_chat
from ..backtest.engine import backtest_btc_usd
from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from ..coinbase.sandbox_client import create_market_ioc_order_sandbox
from ..paper.signals import compute_latest_execution_signal
from ..learn.optimizer import optimize_net_profit
from ..pine.parser import parse_vigil_template
from ..pine.rewriter import PineRewriter
from ..paper import autopilot as paper_autopilot
from ..paper import portfolio as paper_portfolio
from ..report.report_generator import generate_overnight_report

router = APIRouter(prefix="/api", tags=["api"])
_strategy_chat_bearer = HTTPBearer(auto_error=False)


class StrategyChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class StrategyChatBody(BaseModel):
    messages: List[StrategyChatMessage] = Field(..., min_length=1, max_length=24)


def _candle_unix(candles_raw: List[Dict[str, Any]], idx: int) -> Optional[int]:
    if idx < 0 or idx >= len(candles_raw):
        return None
    c = candles_raw[idx]
    v = c.get("start") if c.get("start") is not None else c.get("timestamp")
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _recent_trades_for_api(candles_raw: List[Dict[str, Any]], trades: List[Any], *, limit: int = 16) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for tr in trades[-limit:]:
        ts = _candle_unix(candles_raw, tr.exit_index)
        out.append(
            {
                "asset": "BTC",
                "action": "Exit",
                "time_unix": ts,
                "exit_price": float(tr.exit_price),
                "entry_price": float(tr.entry_price),
                "pnl_usd": float(tr.pnl_usd),
                "win": bool(tr.pnl_usd > 0),
            }
        )
    return out

_RUNS: Dict[str, Dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()


def _set_run(run_id: str, patch: Dict[str, Any]) -> None:
    with _RUNS_LOCK:
        if run_id not in _RUNS:
            _RUNS[run_id] = {}
        _RUNS[run_id].update(patch)


def _get_run(run_id: str) -> Dict[str, Any]:
    with _RUNS_LOCK:
        if run_id not in _RUNS:
            raise HTTPException(status_code=404, detail="Unknown run_id")
        return _RUNS[run_id]


def _run_learning_background(
    *,
    run_id: str,
    pine_text: str,
    stop_loss_pct: float,
    btc_size: float,
    leverage: float,
    coinbase_sandbox: bool,
    coinbase_bearer_jwt: Optional[str],
) -> None:
    t_learning_start = time.time()
    try:
        _set_run(run_id, {"status": "running"})

        template_spec = parse_vigil_template(pine_text)
        candles_raw: List[Dict[str, Any]]
        data_source = "coinbase_sandbox"
        data_warning: Optional[str] = None
        try:
            candles_raw = fetch_coinbase_candles_btc_usd()
        except (ValueError, requests.exceptions.RequestException):
            # If Coinbase is blocked/unreachable in this environment, fall back so the demo still completes.
            candles_raw = generate_synthetic_candles_btc_usd(seed=hash(run_id) & 0xFFFFFFFF)
            data_source = "synthetic_fallback"
            data_warning = None

        opt = optimize_net_profit(
            candles_raw,
            template_spec=template_spec,
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
            leverage=leverage,
            max_evals=500,
        )

        best_params = opt.best_params
        rewriter = PineRewriter()
        rewritten = rewriter.rewrite_inputs(
            pine_text=pine_text,
            template_type=template_spec.template_type,
            new_params=best_params,
        )

        report_obj = generate_overnight_report(
            template_type=template_spec.template_type,
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
            optimization_result=opt,
            leverage=leverage,
        )

        exec_result: Optional[Dict[str, Any]] = None
        if coinbase_sandbox:
            side = compute_latest_execution_signal(
                template_type=template_spec.template_type,
                candles_raw=candles_raw,
                best_params=best_params,
            )
            if side:
                order_resp = create_market_ioc_order_sandbox(
                    product_id="BTC-USD",
                    side=side,
                    base_size_btc=btc_size,
                    client_order_id=f"{run_id}-{int(time.time())}",
                    bearer_jwt=coinbase_bearer_jwt,
                )
                exec_result = order_resp.raw

        learning_duration_seconds = round(time.time() - t_learning_start, 3)

        equity_baseline = backtest_btc_usd(
            candles_raw,
            template_type=template_spec.template_type,
            params=dict(report_obj.baseline_params),
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
            leverage=leverage,
            return_equity_curve=True,
        ).equity_curve
        best_bt = backtest_btc_usd(
            candles_raw,
            template_type=template_spec.template_type,
            params=dict(best_params),
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
            leverage=leverage,
            return_equity_curve=True,
        )
        equity_best = best_bt.equity_curve
        recent_trades_best = _recent_trades_for_api(candles_raw, best_bt.trades)

        _set_run(
            run_id,
            {
                "status": "completed",
                "updated_pine": rewritten.updated_pine,
                "report": {
                    "template_type": report_obj.template_type,
                    "stop_loss_pct": report_obj.stop_loss_pct,
                    "btc_size": report_obj.btc_size,
                    "leverage": report_obj.leverage,
                    "baseline_params": report_obj.baseline_params,
                    "best_params": report_obj.best_params,
                    "baseline_metrics": report_obj.baseline_metrics,
                    "best_metrics": report_obj.best_metrics,
                    "delta_metrics": report_obj.delta_metrics,
                    "improvements_text": report_obj.improvements_text,
                    "tried_sample": report_obj.tried_sample,
                    "execution": exec_result,
                    "data_source": data_source,
                    "data_warning": data_warning,
                    "learning_duration_seconds": learning_duration_seconds,
                    "learning_started_at_unix": t_learning_start,
                    "equity_curve_baseline": equity_baseline,
                    "equity_curve_best": equity_best,
                    "recent_trades_best": recent_trades_best,
                },
            },
        )
    except Exception as e:
        _set_run(run_id, {"status": "failed", "error": {"message": str(e)}})


@router.post("/upload")
async def upload_pine(pine: UploadFile = File(...)):
    if not pine.filename:
        raise HTTPException(status_code=400, detail="Missing pine filename")

    pine_bytes = await pine.read()
    try:
        pine_text = pine_bytes.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Pine must be valid UTF-8 text")

    # Validate template contract early so failures happen before overnight runs.
    parse_vigil_template(pine_text)

    run_id = str(uuid.uuid4())
    _set_run(run_id, {"status": "uploaded", "pine_text": pine_text})
    return JSONResponse({"run_id": run_id})


@router.post("/run_learning")
async def run_learning(
    run_id: str = Form(...),
    stop_loss_pct: float = Form(...),
    btc_size: float = Form(...),
    leverage: float = Form(1.0),
):
    if stop_loss_pct <= 0:
        raise HTTPException(status_code=400, detail="stop_loss_pct must be > 0")
    if btc_size <= 0:
        raise HTTPException(status_code=400, detail="btc_size must be > 0")
    if leverage <= 0 or leverage > 125:
        raise HTTPException(status_code=400, detail="leverage must be between 0 and 125 (exclusive of 0)")

    run = _get_run(run_id)
    pine_text = run.get("pine_text")
    if not pine_text:
        raise HTTPException(status_code=400, detail="Missing uploaded pine for run_id")

    coinbase_sandbox = True
    coinbase_bearer_jwt = os.getenv("COINBASE_BEARER_JWT")

    thread = threading.Thread(
        target=_run_learning_background,
        kwargs={
            "run_id": run_id,
            "pine_text": pine_text,
            "stop_loss_pct": float(stop_loss_pct),
            "btc_size": float(btc_size),
            "leverage": float(leverage),
            "coinbase_sandbox": coinbase_sandbox,
            "coinbase_bearer_jwt": coinbase_bearer_jwt,
        },
        daemon=True,
    )
    thread.start()
    return JSONResponse({"ok": True})


@router.get("/report")
async def get_report(run_id: str):
    run = _get_run(run_id)
    status = run.get("status")
    if status == "completed":
        return JSONResponse({"status": "completed", "report": run.get("report")})
    if status == "failed":
        return JSONResponse({"status": "failed", "error": run.get("error")})
    return JSONResponse({"status": "running"})


@router.get("/download_pine")
async def download_pine(run_id: str):
    run = _get_run(run_id)
    if run.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Run not completed yet")
    updated_pine = run.get("updated_pine")
    if not updated_pine:
        raise HTTPException(status_code=500, detail="Missing updated_pine artifact")

    headers = {"Content-Disposition": f'attachment; filename="updated_{run_id}.pinescript"'}
    return Response(content=updated_pine, media_type="text/plain", headers=headers)


_MARKETAUX_MAX_LIMIT = 20
_MARKETAUX_URL = "https://api.marketaux.com/v1/news/all"
# Bias feed toward tradeable / macro-linked entities (see MarketAux entity type list).
_MARKETAUX_DEFAULT_ENTITY_TYPES = "equity,index,etf,mutualfund,cryptocurrency,currency"


def _marketaux_error_message(payload: Any) -> Optional[str]:
    """Parse MarketAux error JSON (string or nested {"error": {"code", "message"}})."""
    if not isinstance(payload, dict):
        return None
    err = payload.get("error")
    if isinstance(err, dict):
        inner = err.get("message") or err.get("code")
        if isinstance(inner, str) and inner.strip():
            s = inner.strip()
            return s[:400] if len(s) > 400 else s
    if isinstance(err, str) and err.strip():
        s = err.strip()
        return s[:400] if len(s) > 400 else s
    top = payload.get("message")
    if isinstance(top, str) and top.strip():
        s = top.strip()
        return s[:400] if len(s) > 400 else s
    return None


def _normalize_marketaux_article(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_entities = item.get("entities") or []
    symbols: List[str] = []
    if isinstance(raw_entities, list):
        for ent in raw_entities:
            if isinstance(ent, dict) and ent.get("symbol"):
                symbols.append(str(ent["symbol"]))
    desc = (item.get("snippet") or item.get("description") or "") or ""
    if len(desc) > 320:
        desc = desc[:320] + "…"
    return {
        "title": str(item.get("title") or ""),
        "description": desc,
        "url": str(item.get("url") or ""),
        "image_url": str(item.get("image_url") or ""),
        "published_at": str(item.get("published_at") or ""),
        "source": str(item.get("source") or ""),
        "entities": symbols[:8],
    }


def _debug_marketaux_ndjson(
    *,
    insights: bool,
    article_count: int,
    strategy_insights: Optional[Dict[str, Any]],
    early: Optional[str] = None,
) -> None:
    # #region agent log
    _path = os.getenv("VIGIL_DEBUG_MARKETAUX_LOG", "").strip()
    if not _path:
        return
    try:
        import json as _dbg_json
        import time as _dbg_time

        _si = strategy_insights
        row = {
            "sessionId": "16c4fd",
            "runId": "pre",
            "hypothesisId": "H3",
            "location": "routes.py:get_marketaux_news",
            "message": "marketaux handler exit",
            "data": {
                "insights_requested": bool(insights),
                "article_count": article_count,
                "has_strategy_insights": isinstance(_si, dict),
                "si_summary_len": len((_si or {}).get("summary") or "")
                if isinstance(_si, dict)
                else -1,
                "si_error_nonempty": bool(
                    isinstance(_si, dict) and str((_si.get("error") or "")).strip()
                ),
                "early": early,
            },
            "timestamp": int(_dbg_time.time() * 1000),
        }
        with open(_path, "a", encoding="utf-8") as _dbf:
            _dbf.write(_dbg_json.dumps(row) + "\n")
    except Exception:
        pass
    # #endregion


def get_marketaux_news(
    limit: int = Query(12, ge=1, le=_MARKETAUX_MAX_LIMIT),
    symbols: Optional[str] = Query(
        None,
        description="Optional comma-separated MarketAux entity symbols (e.g. TSLA,AAPL).",
    ),
    insights: bool = Query(
        False,
        description="If true, include strategy_insights from LLM (requires OPENROUTER_API_KEY).",
    ),
):
    """Public proxy for the marketing page; keeps MARKETAUX_API_TOKEN server-side."""
    token = os.getenv("MARKETAUX_API_TOKEN", "").strip()
    if not token:
        _debug_marketaux_ndjson(
            insights=insights,
            article_count=0,
            strategy_insights=None,
            early="no_marketaux_token",
        )
        return JSONResponse(
            status_code=503,
            content={"articles": [], "meta": None, "error": "MARKETAUX_API_TOKEN not configured"},
        )
    params: Dict[str, Any] = {
        "api_token": token,
        "language": "en",
        "limit": limit,
        # Financial assets & macro: only articles where MarketAux identified at least one entity.
        "must_have_entities": "true",
        "filter_entities": "true",
    }
    et = os.getenv("MARKETAUX_ENTITY_TYPES", _MARKETAUX_DEFAULT_ENTITY_TYPES).strip()
    if et:
        params["entity_types"] = et
    if symbols and symbols.strip():
        params["symbols"] = symbols.strip()
    try:
        r = requests.get(_MARKETAUX_URL, params=params, timeout=20)
        data = r.json()
    except Exception:
        _debug_marketaux_ndjson(
            insights=insights,
            article_count=0,
            strategy_insights=None,
            early="marketaux_request_exception",
        )
        return JSONResponse(
            status_code=503,
            content={"articles": [], "meta": None, "error": "News request failed"},
        )
    if not r.ok:
        parsed = _marketaux_error_message(data)
        if parsed:
            err_msg = redact_secrets_for_client(parsed)
        else:
            err_msg = f"MarketAux request failed (HTTP {r.status_code})"
        _debug_marketaux_ndjson(
            insights=insights,
            article_count=0,
            strategy_insights=None,
            early="marketaux_http_error",
        )
        return JSONResponse(
            status_code=503,
            content={"articles": [], "meta": None, "error": err_msg},
        )
    raw_list = data.get("data") if isinstance(data, dict) else None
    if not isinstance(raw_list, list):
        raw_list = []
    articles = [_normalize_marketaux_article(a) for a in raw_list if isinstance(a, dict)]
    meta_out: Optional[Dict[str, Any]] = None
    if isinstance(data, dict) and isinstance(data.get("meta"), dict):
        m = data["meta"]
        meta_out = {
            k: m.get(k)
            for k in ("found", "returned", "limit", "page")
            if k in m
        }
    payload: Dict[str, Any] = {"articles": articles, "meta": meta_out, "error": None}
    if insights and articles:
        payload["strategy_insights"] = strategy_insights_from_headlines(articles=articles)
    elif insights:
        payload["strategy_insights"] = {
            "summary": "",
            "considerations": [],
            "macro_todos": [],
            "asset_todos": [],
            "error": None,
        }
    _si_out = payload.get("strategy_insights")
    _debug_marketaux_ndjson(
        insights=insights,
        article_count=len(articles),
        strategy_insights=_si_out if isinstance(_si_out, dict) else None,
        early=None,
    )
    return payload


def _strategy_chat_context(*, personalized: bool) -> Dict[str, Any]:
    if not personalized:
        return {
            "personalized_data_loaded": False,
            "has_strategy_profile": False,
            "note": (
                "No valid signed-in session was provided. Use general Vigil/paper-trading product knowledge only; "
                "do not invent user-specific numbers or settings. For questions about their specific strategy, "
                "tell them to open the Vigil dashboard, paste a bearer token so the session is recognized, then "
                "sync or submit their strategy profile before asking personalized questions."
            ),
        }
    ap = paper_autopilot.status()
    log = ap.get("log") or []
    ap_compact = {k: v for k, v in ap.items() if k != "log"}
    ap_compact["log_tail"] = list(log)[-5:] if isinstance(log, list) else []
    ps = paper_portfolio.get_status()
    fills = ps.get("fills") or []
    paper_snap: Dict[str, Any]
    if ps.get("started"):
        paper_snap = {
            "started": True,
            "usd_cash": ps.get("usd_cash"),
            "btc_balance": ps.get("btc_balance"),
            "usd_equity_mark": ps.get("usd_equity_mark"),
            "starting_quote_usdc": ps.get("starting_quote_usdc"),
            "recent_fill_count": len(fills) if isinstance(fills, list) else 0,
        }
    else:
        paper_snap = {"started": False}
    prof = agent_state.get_strategy_profile()
    has_strategy_profile = bool(prof)
    ctx: Dict[str, Any] = {
        "personalized_data_loaded": True,
        "has_strategy_profile": has_strategy_profile,
        "strategy_profile": prof,
        "paper_vigil_autopilot": ap_compact,
        "agent_rules_summary": agent_rules.summarize_rules(),
        "paper_portfolio_snapshot": paper_snap,
    }
    if not has_strategy_profile:
        ctx["note"] = (
            "Session is recognized but no strategy profile is stored on the server yet. "
            "Tell the user to add their strategy in Vigil first (Vigil dashboard: submit or sync a strategy profile "
            "from trades or the strategy flow) before expecting answers tied to their specific strategy parameters."
        )
    return ctx


@router.post("/strategy-chat")
def post_strategy_chat(
    body: StrategyChatBody,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_strategy_chat_bearer),
):
    personalized = False
    if creds is not None and creds.credentials:
        try:
            pl = session_jwt.decode_token(creds.credentials)
            sid = str(pl.get("sid") or "")
            if sid and agent_state.get_server_session(sid):
                personalized = True
        except Exception:
            personalized = False
    ctx = _strategy_chat_context(personalized=personalized)
    payload = [m.model_dump() for m in body.messages]
    out = run_strategy_chat(messages=payload, context=ctx)
    if out.get("error"):
        return JSONResponse(
            status_code=503,
            content={"reply": out.get("reply") or "", "error": out["error"], "personalized": personalized},
        )
    return {"reply": out.get("reply") or "", "error": None, "personalized": personalized}

