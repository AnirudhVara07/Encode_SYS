from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

from .templates.vigil_templates import template_signals_for


@dataclass(frozen=True)
class Candle:
    timestamp: Optional[int]
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class Trade:
    entry_price: float
    exit_price: float
    pnl_usd: float
    entry_index: int
    exit_index: int


@dataclass(frozen=True)
class BacktestResult:
    template_type: str
    params: Dict[str, float]
    net_profit_usd: float
    trade_count: int
    win_rate: float
    max_drawdown_usd: float
    trades: List[Trade]
    # Optional time series: candle unix time -> mark-to-market equity (GBP) at bar close.
    equity_curve: Optional[List[Dict[str, Any]]] = None


def _ema(values: List[float], period: int) -> List[Optional[float]]:
    """
    Standard EMA with smoothing factor 2/(period+1).

    Returns list of same length with None until enough samples exist.
    """
    if period <= 0:
        raise ValueError("EMA period must be > 0")
    k = 2.0 / (period + 1.0)
    ema: List[Optional[float]] = [None] * len(values)
    if len(values) < period:
        return ema

    # Seed with SMA at first full window.
    seed = sum(values[:period]) / period
    ema[period - 1] = seed
    for i in range(period, len(values)):
        prev = ema[i - 1]
        assert prev is not None
        ema[i] = values[i] * k + prev * (1.0 - k)
    return ema


def _rsi(closes: List[float], period: int) -> List[Optional[float]]:
    """
    Wilder's RSI.

    Returns list of same length with None until enough samples exist.
    """
    if period <= 0:
        raise ValueError("RSI period must be > 0")
    n = len(closes)
    rsi: List[Optional[float]] = [None] * n
    if n <= period:
        return rsi

    gains = 0.0
    losses = 0.0
    # initial average gain/loss
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change >= 0:
            gains += change
        else:
            losses += -change

    avg_gain = gains / period
    avg_loss = losses / period

    def compute_current(avg_gain_: float, avg_loss_: float) -> float:
        if avg_loss_ == 0.0:
            return 100.0
        rs = avg_gain_ / avg_loss_
        return 100.0 - (100.0 / (1.0 + rs))

    rsi[period] = compute_current(avg_gain, avg_loss)

    for i in range(period + 1, n):
        change = closes[i] - closes[i - 1]
        gain = change if change > 0 else 0.0
        loss = -change if change < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rsi[i] = compute_current(avg_gain, avg_loss)

    return rsi


def _to_candles(candles_raw: List[Dict]) -> List[Candle]:
    candles: List[Candle] = []
    for c in candles_raw:
        candles.append(
            Candle(
                timestamp=int(c.get("start") or c.get("timestamp") or 0) if c.get("start") or c.get("timestamp") else None,
                open=float(c["open"]),
                high=float(c["high"]),
                low=float(c["low"]),
                close=float(c["close"]),
            )
        )
    return candles


def backtest_btc_usd(
    candles_raw: List[Dict],
    *,
    template_type: str,
    params: Dict[str, float],
    stop_loss_pct: float,
    btc_size: float,
    leverage: float = 1.0,
    return_equity_curve: bool = False,
) -> BacktestResult:
    """
    Demo backtest:
      - Long-only.
      - When in position, stop-loss exits if candle low breaches entry*(1-stop_loss_pct/100).
      - Entries/exits are evaluated at candle close using the template-specific conditions.
      - P&L scales with ``btc_size * leverage`` (notional exposure); prices and % stop are unchanged.
    """
    if btc_size <= 0:
        raise ValueError("btc_size must be > 0")
    if stop_loss_pct <= 0:
        raise ValueError("stop_loss_pct must be > 0")
    if leverage <= 0:
        raise ValueError("leverage must be > 0")

    effective_btc = btc_size * leverage

    candles = _to_candles(candles_raw)
    closes = [c.close for c in candles]

    # Compute indicator series based on template needs.
    rsi_series: List[Optional[float]] = [None] * len(candles)
    ema_series: List[Optional[float]] = [None] * len(candles)
    ema_fast: List[Optional[float]] = [None] * len(candles)
    ema_slow: List[Optional[float]] = [None] * len(candles)

    if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
        rsi_series = _rsi(closes, int(params["rsi_len"]))
    if template_type == "RSICrossTrendFilter":
        ema_series = _ema(closes, int(params["ema_len"]))
    if template_type == "EMACrossover":
        ema_fast = _ema(closes, int(params["ema_fast"]))
        ema_slow = _ema(closes, int(params["ema_slow"]))

    position_open = False
    entry_price = 0.0
    stop_price = 0.0

    realized_pnl = 0.0
    equity_peak = 0.0
    max_drawdown = 0.0  # negative number

    trades: List[Trade] = []

    equity_snapshots: Optional[List[Dict[str, Any]]] = [] if return_equity_curve else None
    if equity_snapshots is not None and candles:
        t0 = candles[0].timestamp
        if not t0:
            t0 = 0
        equity_snapshots.append({"t": int(t0), "equity_usd": 0.0})

    def snapshot_bar_close() -> None:
        if equity_snapshots is None:
            return
        unreal = (close_now - entry_price) * effective_btc if position_open else 0.0
        eq = realized_pnl + unreal
        ts = c.timestamp
        if not ts:
            ts = i * 3600
        equity_snapshots.append({"t": int(ts), "equity_usd": float(eq)})

    for i in range(1, len(candles)):
        c = candles[i]
        close_now = c.close
        low_now = c.low

        # Mark-to-market equity for drawdown tracking (P&L only).
        unrealized = (close_now - entry_price) * effective_btc if position_open else 0.0
        equity = realized_pnl + unrealized
        if equity > equity_peak:
            equity_peak = equity
        drawdown = equity - equity_peak
        if drawdown < max_drawdown:
            max_drawdown = drawdown

        # Evaluate stop-loss first within the candle.
        if position_open:
            if low_now <= stop_price:
                exit_price = stop_price
                pnl_usd = (exit_price - entry_price) * effective_btc
                realized_pnl += pnl_usd
                trades.append(
                    Trade(
                        entry_price=entry_price,
                        exit_price=exit_price,
                        pnl_usd=pnl_usd,
                        entry_index=-1,  # filled below if we want; omitted for demo
                        exit_index=i,
                    )
                )
                position_open = False
                entry_price = 0.0
                stop_price = 0.0
                snapshot_bar_close()
                continue

        # Need previous indicator values for cross logic.
        rsi_prev = rsi_series[i - 1] if i - 1 >= 0 else None
        rsi_now = rsi_series[i]
        ema_now = ema_series[i] if i < len(ema_series) else None

        ema_fast_prev = ema_fast[i - 1] if i - 1 >= 0 else None
        ema_fast_now = ema_fast[i]
        ema_slow_prev = ema_slow[i - 1] if i - 1 >= 0 else None
        ema_slow_now = ema_slow[i]

        # Skip until indicators are ready.
        if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
            if rsi_prev is None or rsi_now is None:
                snapshot_bar_close()
                continue
        if template_type == "RSICrossTrendFilter":
            if ema_now is None:
                snapshot_bar_close()
                continue
        if template_type == "EMACrossover":
            if ema_fast_prev is None or ema_fast_now is None or ema_slow_prev is None or ema_slow_now is None:
                snapshot_bar_close()
                continue

        signals = template_signals_for(
            template_type,
            rsi_prev=rsi_prev,
            rsi_now=rsi_now,
            rsi_lower=float(params["rsi_lower"]) if "rsi_lower" in params else None,
            rsi_upper=float(params["rsi_upper"]) if "rsi_upper" in params else None,
            ema_now=ema_now,
            close_now=close_now,
            ema_fast_prev=ema_fast_prev,
            ema_fast_now=ema_fast_now,
            ema_slow_prev=ema_slow_prev,
            ema_slow_now=ema_slow_now,
        )

        if not position_open and signals.enter_long:
            entry_price = close_now
            stop_price = entry_price * (1.0 - stop_loss_pct / 100.0)
            position_open = True
            snapshot_bar_close()
            continue

        if position_open and signals.exit_long:
            exit_price = close_now
            pnl_usd = (exit_price - entry_price) * effective_btc
            realized_pnl += pnl_usd
            trades.append(
                Trade(
                    entry_price=entry_price,
                    exit_price=exit_price,
                    pnl_usd=pnl_usd,
                    entry_index=-1,  # demo
                    exit_index=i,
                )
            )
            position_open = False
            entry_price = 0.0
            stop_price = 0.0

        snapshot_bar_close()

    # Close any open position at the end for consistent reporting.
    if position_open and candles:
        final_price = candles[-1].close
        pnl_usd = (final_price - entry_price) * effective_btc
        realized_pnl += pnl_usd
        trades.append(
            Trade(
                entry_price=entry_price,
                exit_price=final_price,
                pnl_usd=pnl_usd,
                entry_index=-1,
                exit_index=len(candles) - 1,
            )
        )
        position_open = False
        entry_price = 0.0
        stop_price = 0.0

    if equity_snapshots is not None and candles:
        last_ts = candles[-1].timestamp
        if not last_ts:
            last_ts = (len(candles) - 1) * 3600
        final_eq = float(realized_pnl)
        if equity_snapshots and equity_snapshots[-1]["t"] == int(last_ts):
            equity_snapshots[-1] = {"t": int(last_ts), "equity_usd": final_eq}
        else:
            equity_snapshots.append({"t": int(last_ts), "equity_usd": final_eq})

    trade_count = len(trades)
    wins = sum(1 for t in trades if t.pnl_usd > 0)
    win_rate = (wins / trade_count) if trade_count > 0 else 0.0

    net_profit = realized_pnl
    max_drawdown_usd = abs(max_drawdown)  # report as positive magnitude

    return BacktestResult(
        template_type=template_type,
        params=dict(params),
        net_profit_usd=net_profit,
        trade_count=trade_count,
        win_rate=win_rate,
        max_drawdown_usd=max_drawdown_usd,
        trades=trades,
        equity_curve=equity_snapshots,
    )

