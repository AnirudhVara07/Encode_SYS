from __future__ import annotations

import statistics
from datetime import datetime
from typing import Any, Dict, List, Optional


def _parse_ts(v: Any) -> float:
    if v is None:
        raise ValueError("missing timestamp")
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s.isdigit():
        return float(s)
    # ISO 8601
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception as e:
        raise ValueError(f"bad timestamp: {v!r}") from e


def build_profile_from_trades(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Input rows: asset, entry_price, exit_price, entry_ts, exit_ts.
    """
    if not trades:
        raise ValueError("trades list is empty")

    hold_secs: List[float] = []
    ret_pct: List[float] = []
    assets: List[str] = []
    adverse_pct: List[float] = []  # proxy for stop: min(intra) unknown — use loss magnitude

    for i, t in enumerate(trades):
        asset = str(t.get("asset") or "UNKNOWN")
        ep = float(t["entry_price"])
        xp = float(t["exit_price"])
        et = _parse_ts(t.get("entry_ts"))
        xt = _parse_ts(t.get("exit_ts"))
        if xt < et:
            raise ValueError(f"trade {i}: exit before entry")
        hold = xt - et
        hold_secs.append(hold)
        assets.append(asset)
        if ep <= 0:
            raise ValueError(f"trade {i}: bad entry_price")
        pnl_pct = (xp - ep) / ep * 100.0
        ret_pct.append(pnl_pct)
        if pnl_pct < 0:
            adverse_pct.append(abs(pnl_pct))

    from collections import Counter

    ac = Counter(assets)
    preferred = [a for a, _ in ac.most_common(5)]

    med_hold = float(statistics.median(hold_secs)) if hold_secs else 0.0
    avg_hold = float(sum(hold_secs) / len(hold_secs)) if hold_secs else 0.0

    wins = [r for r in ret_pct if r > 1e-9]
    losses = [r for r in ret_pct if r < -1e-9]

    take_profit_est = float(statistics.median([r for r in wins])) if wins else 0.0
    stop_loss_est = float(statistics.median(adverse_pct)) if adverse_pct else float(statistics.median([abs(r) for r in losses])) if losses else 0.0

    vol = float(statistics.pstdev(ret_pct)) if len(ret_pct) > 1 else 0.0
    if vol > 8:
        risk = "high"
    elif vol > 3:
        risk = "moderate"
    else:
        risk = "low"

    entry_conditions = (
        f"Sample size {len(trades)}; median hold {med_hold/3600:.1f}h; "
        f"median return {float(statistics.median(ret_pct)):.2f}%; "
        f"preferred assets: {', '.join(preferred[:3])}."
    )

    return {
        "preferred_assets": preferred,
        "avg_hold_time_sec": round(avg_hold, 3),
        "median_hold_time_sec": round(med_hold, 3),
        "stop_loss_pct_estimate": round(stop_loss_est, 4),
        "take_profit_pct_estimate": round(abs(take_profit_est), 4),
        "risk_tolerance": risk,
        "return_volatility_sample_pct": round(vol, 4),
        "entry_conditions": entry_conditions,
        "trade_count": len(trades),
    }
