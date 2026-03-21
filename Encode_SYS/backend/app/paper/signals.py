"""Latest-bar execution signals for Vigil templates (shared by learning and Vigil paper automation)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..backtest.engine import _ema, _rsi
from ..backtest.templates.vigil_templates import template_signals_for


def compute_latest_execution_signal(
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
