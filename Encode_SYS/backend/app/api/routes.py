import os
import threading
import time
import uuid
import random
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from ..backtest.engine import _ema, _rsi
from ..backtest.templates.vigil_templates import template_signals_for
from ..coinbase.sandbox_client import create_market_ioc_order_sandbox
from ..learn.optimizer import optimize_net_profit
from ..pine.parser import parse_vigil_template
from ..pine.rewriter import PineRewriter
from ..report.report_generator import generate_overnight_report

router = APIRouter(prefix="/api", tags=["api"])

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


def _parse_candles_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and "candles" in payload and isinstance(payload["candles"], list):
        return payload["candles"]
    raise ValueError("Unexpected candles payload format from Coinbase")


def _fetch_coinbase_candles_btc_usd(
    *,
    product_id: str = "BTC-USD",
    lookback_hours: int = 72,
    granularity: str = "ONE_HOUR",
    limit: int = 350,
    sandbox_base_url: str = "https://api-sandbox.coinbase.com",
) -> List[Dict[str, Any]]:
    end = int(time.time())
    start = end - int(lookback_hours * 3600)

    url = f"{sandbox_base_url}/api/v3/brokerage/products/{product_id}/candles"
    params = {
        "start": str(start),
        "end": str(end),
        "granularity": granularity,
        "limit": str(limit),
    }

    res = requests.get(url, params=params, timeout=30)
    try:
        payload = res.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse Coinbase candles JSON: {e}")

    if not res.ok:
        raise HTTPException(status_code=502, detail=f"Coinbase candles request failed: {payload}")

    candles = _parse_candles_payload(payload)
    normalized: List[Dict[str, Any]] = []
    for c in candles:
        normalized.append(
            {
                "start": c.get("start") or c.get("timestamp"),
                "open": float(c["open"]),
                "high": float(c["high"]),
                "low": float(c["low"]),
                "close": float(c["close"]),
                "volume": float(c.get("volume") or 0.0),
            }
        )
    return normalized


def _generate_synthetic_candles_btc_usd(
    *,
    lookback_hours: int = 72,
    granularity: str = "ONE_HOUR",
    limit: int = 350,
    seed: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Deterministic fallback candles so the demo can run even when Coinbase is unreachable.

    This is NOT meant for real trading—only to keep the learning+report pipeline functional.
    """
    candle_seconds = 3600
    if granularity == "ONE_HOUR":
        candle_seconds = 3600
    elif granularity == "FIVE_MINUTE":
        candle_seconds = 300
    elif granularity == "ONE_DAY":
        candle_seconds = 86400

    bars = min(limit, max(10, int((lookback_hours * 3600) / candle_seconds)))
    end = int(time.time())
    start = end - bars * candle_seconds

    rng = random.Random(seed if seed is not None else start)

    price = 50000.0
    candles: List[Dict[str, Any]] = []
    for i in range(bars):
        ts = start + i * candle_seconds
        o = price
        # Small drift + noise (roughly realistic volatility).
        ret = rng.gauss(0.0002, 0.006)
        c = max(0.01, o * (1.0 + ret))

        # Build a candle range around open/close.
        base_spread = abs(c - o)
        spread = base_spread * rng.uniform(0.2, 1.2) + o * rng.uniform(0.0001, 0.001)
        hi = max(o, c) + spread * rng.uniform(0.1, 1.0)
        lo = min(o, c) - spread * rng.uniform(0.1, 1.0)
        lo = max(0.0001, lo)

        candles.append(
            {
                "start": ts,
                "open": float(o),
                "high": float(hi),
                "low": float(lo),
                "close": float(c),
                "volume": float(rng.uniform(10.0, 500.0)),
            }
        )
        price = c

    return candles


def _compute_latest_execution_signal(
    *,
    template_type: str,
    candles_raw: List[Dict[str, Any]],
    best_params: Dict[str, float],
) -> Optional[str]:
    closes = [float(c["close"]) for c in candles_raw]
    if len(closes) < 5:
        return None

    i = len(closes) - 1
    close_now = closes[i]

    if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
        rsi_len = int(best_params["rsi_len"])
        rsi_series = _rsi(closes, rsi_len)
        rsi_prev = rsi_series[i - 1]
        rsi_now = rsi_series[i]
        if rsi_prev is None or rsi_now is None:
            return None

        rsi_lower = float(best_params["rsi_lower"])
        rsi_upper = float(best_params["rsi_upper"])

        if template_type == "RSICrossTrendFilter":
            ema_len = int(best_params["ema_len"])
            ema_series = _ema(closes, ema_len)
            ema_now = ema_series[i]
            if ema_now is None:
                return None

            signals = template_signals_for(
                template_type,
                rsi_prev=rsi_prev,
                rsi_now=rsi_now,
                rsi_lower=rsi_lower,
                rsi_upper=rsi_upper,
                close_now=close_now,
                ema_now=ema_now,
            )
        else:
            signals = template_signals_for(
                template_type,
                rsi_prev=rsi_prev,
                rsi_now=rsi_now,
                rsi_lower=rsi_lower,
                rsi_upper=rsi_upper,
            )

        if signals.enter_long:
            return "BUY"
        if signals.exit_long:
            return "SELL"
        return None

    if template_type == "EMACrossover":
        ema_fast = _ema(closes, int(best_params["ema_fast"]))
        ema_slow = _ema(closes, int(best_params["ema_slow"]))
        ema_fast_prev = ema_fast[i - 1]
        ema_fast_now = ema_fast[i]
        ema_slow_prev = ema_slow[i - 1]
        ema_slow_now = ema_slow[i]
        if ema_fast_prev is None or ema_fast_now is None or ema_slow_prev is None or ema_slow_now is None:
            return None

        signals = template_signals_for(
            template_type,
            ema_fast_prev=ema_fast_prev,
            ema_fast_now=ema_fast_now,
            ema_slow_prev=ema_slow_prev,
            ema_slow_now=ema_slow_now,
        )
        if signals.enter_long:
            return "BUY"
        if signals.exit_long:
            return "SELL"
        return None

    raise ValueError(f"Unsupported template_type for execution: {template_type}")


def _run_learning_background(
    *,
    run_id: str,
    pine_text: str,
    stop_loss_pct: float,
    btc_size: float,
    coinbase_sandbox: bool,
    coinbase_bearer_jwt: Optional[str],
) -> None:
    try:
        _set_run(run_id, {"status": "running"})

        template_spec = parse_vigil_template(pine_text)
        candles_raw: List[Dict[str, Any]]
        data_source = "coinbase_sandbox"
        data_warning: Optional[str] = None
        try:
            candles_raw = _fetch_coinbase_candles_btc_usd()
        except (HTTPException, requests.exceptions.RequestException) as e:
            # If Coinbase is blocked/unreachable in this environment, fall back so the demo still completes.
            candles_raw = _generate_synthetic_candles_btc_usd(seed=hash(run_id) & 0xFFFFFFFF)
            data_source = "synthetic_fallback"
            data_warning = str(e)

        opt = optimize_net_profit(
            candles_raw,
            template_spec=template_spec,
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
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
        )

        exec_result: Optional[Dict[str, Any]] = None
        if coinbase_sandbox:
            side = _compute_latest_execution_signal(
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

        _set_run(
            run_id,
            {
                "status": "completed",
                "report": {
                    "template_type": report_obj.template_type,
                    "stop_loss_pct": report_obj.stop_loss_pct,
                    "btc_size": report_obj.btc_size,
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
                },
                "updated_pine": rewritten.updated_pine,
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
):
    if stop_loss_pct <= 0:
        raise HTTPException(status_code=400, detail="stop_loss_pct must be > 0")
    if btc_size <= 0:
        raise HTTPException(status_code=400, detail="btc_size must be > 0")

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

