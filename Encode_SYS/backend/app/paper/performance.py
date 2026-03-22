"""Aggregate performance metrics from paper / backtest fills."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def _fifo_realized_sells(fills_chrono: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    """
    Walk fills in chronological order; attach realized_pnl_usd on each sell from FIFO cost basis.
    """
    lots: List[Dict[str, float]] = []  # {btc, cost_per_btc}
    out_rows: List[Dict[str, Any]] = []
    total_realized = 0.0
    for f in fills_chrono:
        side = str(f.get("side") or "").lower()
        price = float(f.get("price") or 0.0)
        row = dict(f)
        if side == "buy":
            btc = float(f.get("btc") or 0.0)
            if btc > 0 and price > 0:
                lots.append({"btc": btc, "cost": price})
            row["realized_pnl_usd"] = None
        elif side == "sell":
            btc = float(f.get("btc") or 0.0)
            proceeds = btc * price
            cost = 0.0
            rem = btc
            new_lots: List[Dict[str, float]] = []
            for lot in lots:
                if rem <= 1e-18:
                    new_lots.append(lot)
                    continue
                take = min(lot["btc"], rem)
                cost += take * lot["cost"]
                rem -= take
                left = lot["btc"] - take
                if left > 1e-18:
                    new_lots.append({"btc": left, "cost": lot["cost"]})
            lots = new_lots
            pnl = proceeds - cost
            total_realized += pnl
            row["realized_pnl_usd"] = round(pnl, 8)
        out_rows.append(row)
    return out_rows, total_realized


def enrich_fills_newest_first(fills_newest_first: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return fills newest-first with `realized_pnl_usd` on sells (FIFO cost basis)."""
    chrono = list(reversed(fills_newest_first))
    rows, _ = _fifo_realized_sells(chrono)
    return list(reversed(rows))


def _hold_stats(fills_chrono: List[Dict[str, Any]]) -> Optional[float]:
    """Average hours between buy and matching sell (FIFO), across closed sells."""
    buys_ts: List[float] = []
    holds: List[float] = []
    for f in fills_chrono:
        side = str(f.get("side") or "").lower()
        ts = float(f.get("ts") or 0.0)
        if side == "buy":
            buys_ts.append(ts)
        elif side == "sell" and buys_ts:
            holds.append(max(0.0, (ts - buys_ts.pop(0)) / 3600.0))
    if not holds:
        return None
    return sum(holds) / len(holds)


def summarize_fills(
    *,
    fills_newest_first: List[Dict[str, Any]],
    starting_quote_usdc: float,
    equity_curve: Optional[List[Dict[str, Any]]] = None,
    label: str = "Paper",
) -> Dict[str, Any]:
    chrono = list(reversed(fills_newest_first))
    rows, _ = _fifo_realized_sells(chrono)
    sells = [r for r in rows if str(r.get("side")) == "sell" and r.get("realized_pnl_usd") is not None]
    pnls = [float(r["realized_pnl_usd"]) for r in sells]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = (len(wins) / len(pnls)) if pnls else None
    best = max(pnls) if pnls else None
    worst = min(pnls) if pnls else None
    avg_hold_h = _hold_stats(chrono)

    end_eq = None
    if equity_curve:
        last = equity_curve[-1]
        end_eq = float(last.get("usd_equity") or last.get("equity_usdc") or 0)
    if end_eq is None and chrono:
        # rough: cannot infer without last price
        end_eq = starting_quote_usdc + sum(pnls)

    total_return_pct = None
    if starting_quote_usdc > 0 and end_eq is not None:
        total_return_pct = round((end_eq - starting_quote_usdc) / starting_quote_usdc * 100.0, 4)

    return {
        "label": label,
        "starting_quote_usdc": starting_quote_usdc,
        "fill_count": len(chrono),
        "closed_trade_count": len(pnls),
        "total_return_pct": total_return_pct,
        "win_rate": round(win_rate, 4) if win_rate is not None else None,
        "best_trade_usd": round(best, 4) if best is not None else None,
        "worst_trade_usd": round(worst, 4) if worst is not None else None,
        "avg_hold_time_hours": round(avg_hold_h, 4) if avg_hold_h is not None else None,
        "total_realized_pnl_usd": round(sum(pnls), 6) if pnls else 0.0,
        "equity_curve": equity_curve or [],
    }
