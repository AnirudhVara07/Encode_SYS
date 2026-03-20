import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from ..backtest.engine import backtest_btc_usd
from ..coinbase.candles import fetch_coinbase_candles_btc_usd, generate_synthetic_candles_btc_usd
from ..coinbase.sandbox_client import create_market_ioc_order_sandbox
from ..paper.signals import compute_latest_execution_signal
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
        except (ValueError, requests.exceptions.RequestException) as e:
            # If Coinbase is blocked/unreachable in this environment, fall back so the demo still completes.
            candles_raw = generate_synthetic_candles_btc_usd(seed=hash(run_id) & 0xFFFFFFFF)
            data_source = "synthetic_fallback"
            data_warning = str(e)

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
        equity_best = backtest_btc_usd(
            candles_raw,
            template_type=template_spec.template_type,
            params=dict(best_params),
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
            leverage=leverage,
            return_equity_curve=True,
        ).equity_curve

        _set_run(
            run_id,
            {
                "status": "completed",
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

