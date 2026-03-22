"""After a universal strategy save, push mapped Vigil templates into paper and Coinbase live autopilot configs."""

from __future__ import annotations

from typing import Any, Dict, List

from ..coinbase_live import store as coinbase_store
from ..paper import autopilot as paper_autopilot


def apply_suggested_strategies_to_autopilots(
    *,
    civic_sub: str,
    suggested: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Preserves interval, sizing, and routing; replaces only the strategies list.
    Skips a book if that autopilot is currently running (same rule as manual config edits).
    """
    out: Dict[str, Any] = {
        "paper": {"applied": False, "reason": None},
        "live": {"applied": False, "reason": None},
    }
    if not suggested:
        out["paper"]["reason"] = "no_suggestion"
        out["live"]["reason"] = "no_suggestion"
        return out

    sub = (civic_sub or "").strip()
    if not sub:
        out["live"]["reason"] = "no_session_sub"

    if paper_autopilot.is_running():
        out["paper"]["reason"] = "paper_vigil_running"
    else:
        try:
            snap = paper_autopilot.get_config_snapshot()
            paper_autopilot.set_config(
                interval_sec=float(snap["interval_sec"]),
                lookback_hours=int(snap["lookback_hours"]),
                buy_usd=float(snap["buy_usd"]),
                sell_fraction=float(snap["sell_fraction"]),
                order_routing=str(snap.get("order_routing") or "internal"),
                strategies=list(suggested),
            )
            out["paper"]["applied"] = True
        except Exception as e:
            out["paper"]["reason"] = str(e)[:500]

    if not sub:
        return out

    row = coinbase_store.get_autopilot_row(sub)
    if row.get("running"):
        out["live"]["reason"] = "live_vigil_running"
    else:
        try:
            coinbase_store.save_autopilot_config(
                civic_sub=sub,
                interval_sec=float(row["interval_sec"]),
                lookback_hours=int(row["lookback_hours"]),
                buy_usd=float(row["buy_usd"]),
                sell_fraction=float(row["sell_fraction"]),
                strategies=list(suggested),
            )
            out["live"]["applied"] = True
        except Exception as e:
            out["live"]["reason"] = str(e)[:500]

    return out
