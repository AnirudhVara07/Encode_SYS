from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ..learn.optimizer import OptimizationResult, OptimizationTrial


@dataclass(frozen=True)
class OvernightReport:
    template_type: str
    stop_loss_pct: float
    btc_size: float
    leverage: float
    baseline_params: Dict[str, float]
    best_params: Dict[str, float]
    baseline_metrics: Dict[str, Any]
    best_metrics: Dict[str, Any]
    delta_metrics: Dict[str, Any]
    improvements_text: str
    tried_sample: List[Dict[str, Any]]


def _metric_summary(res) -> Dict[str, Any]:
    return {
        "net_profit_usd": res.net_profit_usd,
        "trade_count": res.trade_count,
        "win_rate": res.win_rate,
        "max_drawdown_usd": res.max_drawdown_usd,
    }


def _format_param_changes(baseline: Dict[str, float], best: Dict[str, float]) -> str:
    parts: List[str] = []
    for k in sorted(best.keys()):
        b = baseline.get(k)
        v = best.get(k)
        if b is None or v is None:
            continue
        if b == v:
            continue
        parts.append(f"{k}: {b} -> {v}")
    return ", ".join(parts) if parts else "No parameter changes."


def _derive_improvements_text(
    template_type: str,
    baseline_result,
    best_result,
    baseline_params: Dict[str, float],
    best_params: Dict[str, float],
    stop_loss_pct: float,
    btc_size: float,
    leverage: float,
) -> str:
    delta_profit = best_result.net_profit_usd - baseline_result.net_profit_usd
    delta_dd = best_result.max_drawdown_usd - baseline_result.max_drawdown_usd

    param_changes = _format_param_changes(baseline_params, best_params)

    # Template-specific narrative.
    narrative = []
    if template_type == "RSIThresholdReversion":
        narrative.append(
            "The RSI entry/exit thresholds act as an aggressiveness dial: tighter oversold levels tend to enter earlier but can increase churn."
        )
    elif template_type == "RSICrossTrendFilter":
        narrative.append(
            "The trend filter reduces counter-trend longs; this typically trades off frequency for improved expectancy."
        )
    elif template_type == "EMACrossover":
        narrative.append(
            "EMA crossover windows affect signal latency: faster pairs react sooner while slower pairs reduce whipsaws."
        )

    # Safety framing.
    lev_note = f" Leverage {leverage}x applied to simulated P&L (effective {btc_size * leverage:.6g} BTC exposure per open position)." if leverage != 1.0 else ""
    safety = (
        f"Stop-loss guardrail was enforced at {stop_loss_pct}% from entry, and base size was {btc_size} BTC per trade in the simulator.{lev_note}"
    )

    # Improvements summary.
    sign = "improved" if delta_profit > 0 else "did not improve"
    extra = ""
    if delta_profit > 0 and delta_dd <= 0:
        extra = " It also reduced drawdown in the simulation."
    elif delta_profit > 0 and delta_dd > 0:
        extra = " Profit improved, but drawdown increased—consider tightening thresholds."
    elif delta_profit <= 0:
        extra = " Consider keeping the baseline thresholds or narrowing the search space."

    param_sentence = param_changes.rstrip(".")
    return (
        f"Overnight learning {sign} net profit by {delta_profit:.2f} USD. "
        f"Parameter updates: {param_sentence}. "
        f"Baseline vs best: profit {baseline_result.net_profit_usd:.2f} -> {best_result.net_profit_usd:.2f} USD, "
        f"max drawdown {baseline_result.max_drawdown_usd:.2f} -> {best_result.max_drawdown_usd:.2f} USD. "
        f"{' '.join(narrative)} {safety}{extra}"
    )


def generate_overnight_report(
    *,
    template_type: str,
    stop_loss_pct: float,
    btc_size: float,
    optimization_result: OptimizationResult,
    leverage: float = 1.0,
    tried_sample_limit: int = 20,
) -> OvernightReport:
    baseline_result = optimization_result.baseline_result
    best_result = optimization_result.best_result

    baseline_metrics = _metric_summary(baseline_result)
    best_metrics = _metric_summary(best_result)
    delta_metrics = {
        "net_profit_usd": best_result.net_profit_usd - baseline_result.net_profit_usd,
        "trade_count": best_result.trade_count - baseline_result.trade_count,
        "win_rate": best_result.win_rate - baseline_result.win_rate,
        "max_drawdown_usd": best_result.max_drawdown_usd - baseline_result.max_drawdown_usd,
    }

    improvements_text = _derive_improvements_text(
        template_type=template_type,
        baseline_result=baseline_result,
        best_result=best_result,
        baseline_params=optimization_result.baseline_params,
        best_params=optimization_result.best_params,
        stop_loss_pct=stop_loss_pct,
        btc_size=btc_size,
        leverage=leverage,
    )

    # Include a small sample of tried configs (sorted by net_profit) for transparency.
    tried_sorted = sorted(
        optimization_result.tried,
        key=lambda t: t.result.net_profit_usd,
        reverse=True,
    )
    tried_sample: List[Dict[str, Any]] = []
    for t in tried_sorted[:tried_sample_limit]:
        tried_sample.append(
            {
                "params": t.params,
                "metrics": _metric_summary(t.result),
            }
        )

    return OvernightReport(
        template_type=template_type,
        stop_loss_pct=stop_loss_pct,
        btc_size=btc_size,
        leverage=leverage,
        baseline_params=optimization_result.baseline_params,
        best_params=optimization_result.best_params,
        baseline_metrics=baseline_metrics,
        best_metrics=best_metrics,
        delta_metrics=delta_metrics,
        improvements_text=improvements_text,
        tried_sample=tried_sample,
    )

