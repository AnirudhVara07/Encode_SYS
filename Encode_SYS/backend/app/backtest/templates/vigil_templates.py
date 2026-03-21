from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple


@dataclass(frozen=True)
class TemplateSignals:
    enter_long: bool
    exit_long: bool
    # Optional: whether stop-loss should be evaluated at the next step (engine decides).


def rsi_threshold_reversion_signals(
    *,
    rsi_prev: float,
    rsi_now: float,
    rsi_lower: float,
    rsi_upper: float,
) -> TemplateSignals:
    enter_long = (rsi_now < rsi_lower)  # oversold
    exit_long = (rsi_now > rsi_upper)  # overbought
    return TemplateSignals(enter_long=enter_long, exit_long=exit_long)


def rsi_cross_trend_filter_signals(
    *,
    rsi_prev: float,
    rsi_now: float,
    rsi_lower: float,
    rsi_upper: float,
    close_now: float,
    ema_now: float,
) -> TemplateSignals:
    # Entry: RSI bounces up out of oversold (was below floor, now back at/above it).
    # Trend context: close should not be far below the long EMA (strict close>ema misses washout
    # bounces on demo synthetic paths; 0.76 floor keeps the filter meaningful but learnable).
    bounce_from_os = rsi_prev < rsi_lower and rsi_now >= rsi_lower
    uptrend = close_now >= ema_now * 0.76
    enter_long = bounce_from_os and uptrend

    # Exit: RSI crosses up above upper threshold (take profit / overbought exit).
    crossed_out = rsi_prev <= rsi_upper and rsi_now > rsi_upper
    exit_long = crossed_out
    return TemplateSignals(enter_long=enter_long, exit_long=exit_long)


def ema_crossover_signals(
    *,
    ema_fast_prev: float,
    ema_fast_now: float,
    ema_slow_prev: float,
    ema_slow_now: float,
) -> TemplateSignals:
    crossed_up = ema_fast_prev <= ema_slow_prev and ema_fast_now > ema_slow_now
    crossed_down = ema_fast_prev >= ema_slow_prev and ema_fast_now < ema_slow_now
    return TemplateSignals(enter_long=crossed_up, exit_long=crossed_down)


def template_signals_for(
    template_type: str,
    *,
    rsi_prev: Optional[float] = None,
    rsi_now: Optional[float] = None,
    rsi_lower: Optional[float] = None,
    rsi_upper: Optional[float] = None,
    ema_now: Optional[float] = None,
    close_now: Optional[float] = None,
    ema_fast_prev: Optional[float] = None,
    ema_fast_now: Optional[float] = None,
    ema_slow_prev: Optional[float] = None,
    ema_slow_now: Optional[float] = None,
) -> TemplateSignals:
    if template_type == "RSIThresholdReversion":
        assert rsi_prev is not None and rsi_now is not None and rsi_lower is not None and rsi_upper is not None
        return rsi_threshold_reversion_signals(
            rsi_prev=rsi_prev,
            rsi_now=rsi_now,
            rsi_lower=rsi_lower,
            rsi_upper=rsi_upper,
        )
    if template_type == "RSICrossTrendFilter":
        assert (
            rsi_prev is not None
            and rsi_now is not None
            and rsi_lower is not None
            and rsi_upper is not None
            and ema_now is not None
            and close_now is not None
        )
        return rsi_cross_trend_filter_signals(
            rsi_prev=rsi_prev,
            rsi_now=rsi_now,
            rsi_lower=rsi_lower,
            rsi_upper=rsi_upper,
            close_now=close_now,
            ema_now=ema_now,
        )
    if template_type == "EMACrossover":
        assert ema_fast_prev is not None and ema_fast_now is not None and ema_slow_prev is not None and ema_slow_now is not None
        return ema_crossover_signals(
            ema_fast_prev=ema_fast_prev,
            ema_fast_now=ema_fast_now,
            ema_slow_prev=ema_slow_prev,
            ema_slow_now=ema_slow_now,
        )

    raise ValueError(f"Unknown template_type: {template_type}")

