"""Aggregate blocked-trade audit rows for guardrails API (time series + recent list)."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple


def hourly_series_for_blocked(blocks: List[Dict[str, Any]], *, hours: int = 24) -> Tuple[List[str], List[Dict[str, Any]]]:
    """
    Bucket counts of blocked trades by rule_code into hourly slots over the last `hours` hours.
    Returns (rule_codes_sorted, points) where each point is {"t": bucket_start_unix, "<rule>": count, ...}.
    """
    now = time.time()
    start = now - hours * 3600.0
    codes = sorted(
        {str(b.get("rule_code") or "unknown") for b in blocks if float(b.get("ts") or 0) >= start - 1e-9}
    )
    points: List[Dict[str, Any]] = []
    for i in range(hours):
        t0 = start + i * 3600.0
        row: Dict[str, Any] = {"t": t0}
        for c in codes:
            row[c] = 0
        points.append(row)
    for b in blocks:
        ts = float(b.get("ts") or 0)
        if ts < start or ts > now + 60:
            continue
        idx = int((ts - start) // 3600.0)
        if idx < 0 or idx >= hours:
            continue
        rc = str(b.get("rule_code") or "unknown")
        if rc not in codes:
            continue
        points[idx][rc] = int(points[idx][rc]) + 1
    return codes, points


def recent_blocked(blocks: List[Dict[str, Any]], *, limit: int = 30) -> List[Dict[str, Any]]:
    tail = blocks[-limit:] if len(blocks) > limit else blocks
    return [dict(x) for x in reversed(tail)]
