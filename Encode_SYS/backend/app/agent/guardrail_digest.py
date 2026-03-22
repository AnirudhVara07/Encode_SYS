"""Aggregate blocked-trade audit rows for guardrails API (time series + recent list)."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple


def bucketed_series_for_blocked(
    blocks: List[Dict[str, Any]],
    *,
    window_seconds: float = 86400.0,
    bucket_seconds: float = 60.0,
) -> Tuple[List[str], List[Dict[str, Any]]]:
    """
    Bucket counts of blocked trades by rule_code into fixed-width time slots.
    Returns (rule_codes_sorted, points) where each point is {"t": bucket_start_unix, "<rule>": count, ...}.
    """
    if bucket_seconds <= 0:
        raise ValueError("bucket_seconds must be positive")
    now = time.time()
    start = now - window_seconds
    n = max(1, int(window_seconds / bucket_seconds))
    codes = sorted(
        {str(b.get("rule_code") or "unknown") for b in blocks if float(b.get("ts") or 0) >= start - 1e-9}
    )
    points: List[Dict[str, Any]] = []
    for i in range(n):
        t0 = start + i * bucket_seconds
        row: Dict[str, Any] = {"t": t0}
        for c in codes:
            row[c] = 0
        points.append(row)
    for b in blocks:
        ts = float(b.get("ts") or 0)
        if ts < start or ts > now + 60:
            continue
        idx = int((ts - start) // bucket_seconds)
        if idx < 0 or idx >= n:
            continue
        rc = str(b.get("rule_code") or "unknown")
        if rc not in codes:
            continue
        points[idx][rc] = int(points[idx][rc]) + 1
    return codes, points


def hourly_series_for_blocked(blocks: List[Dict[str, Any]], *, hours: int = 24) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Bucket counts into hourly slots over the last `hours` hours (3600s buckets)."""
    return bucketed_series_for_blocked(blocks, window_seconds=float(hours) * 3600.0, bucket_seconds=3600.0)


def recent_blocked(blocks: List[Dict[str, Any]], *, limit: int = 30) -> List[Dict[str, Any]]:
    tail = blocks[-limit:] if len(blocks) > limit else blocks
    return [dict(x) for x in reversed(tail)]
