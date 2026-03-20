from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional
import math

from ..backtest.engine import BacktestResult, backtest_btc_usd
from ..pine.parser import RangeSpec, TemplateSpec, build_optimizer_param_grid


@dataclass(frozen=True)
class OptimizationTrial:
    params: Dict[str, float]
    result: BacktestResult


@dataclass(frozen=True)
class OptimizationResult:
    template_type: str
    baseline_params: Dict[str, float]
    baseline_result: BacktestResult
    best_params: Dict[str, float]
    best_result: BacktestResult
    tried: List[OptimizationTrial]


def _is_better(candidate: BacktestResult, best: BacktestResult) -> bool:
    # Primary objective: net_profit_usd
    if candidate.net_profit_usd != best.net_profit_usd:
        return candidate.net_profit_usd > best.net_profit_usd
    # Tie-breakers for stability:
    if candidate.win_rate != best.win_rate:
        return candidate.win_rate > best.win_rate
    return candidate.trade_count > best.trade_count


def optimize_net_profit(
    candles_raw: List[Dict],
    *,
    template_spec: TemplateSpec,
    stop_loss_pct: float,
    btc_size: float,
    max_evals: int = 500,
) -> OptimizationResult:
    """
    Demo learning loop: grid search over discrete parameter combos for the supported templates.
    """
    baseline_params = template_spec.params
    baseline_result = backtest_btc_usd(
        candles_raw,
        template_type=template_spec.template_type,
        params=baseline_params,
        stop_loss_pct=stop_loss_pct,
        btc_size=btc_size,
    )

    grid = build_optimizer_param_grid(
        template_spec.template_type,
        default_params=baseline_params,
        ranges=template_spec.ranges,
    )

    # Cap evals for demo performance.
    if len(grid) > max_evals:
        # Pick a deterministic subset: evenly space across the grid
        step = max(1, math.floor(len(grid) / max_evals))
        grid = grid[::step][:max_evals]

    best_params: Dict[str, float] = dict(baseline_params)
    best_result: BacktestResult = baseline_result
    tried: List[OptimizationTrial] = []

    for cfg in grid:
        # Skip identical baseline to avoid noise in the "tried" list.
        if cfg == baseline_params:
            continue

        res = backtest_btc_usd(
            candles_raw,
            template_type=template_spec.template_type,
            params=cfg,
            stop_loss_pct=stop_loss_pct,
            btc_size=btc_size,
        )
        tried.append(OptimizationTrial(params=dict(cfg), result=res))
        if _is_better(res, best_result):
            best_result = res
            best_params = dict(cfg)

    return OptimizationResult(
        template_type=template_spec.template_type,
        baseline_params=dict(baseline_params),
        baseline_result=baseline_result,
        best_params=dict(best_params),
        best_result=best_result,
        tried=tried,
    )

