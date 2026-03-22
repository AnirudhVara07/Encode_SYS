from __future__ import annotations

import threading
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List

_lock = threading.Lock()
_fills: Dict[str, Deque[Dict[str, Any]]] = defaultdict(lambda: deque(maxlen=200))


def record_fill(civic_sub: str, entry: Dict[str, Any]) -> None:
    with _lock:
        d = dict(entry)
        _fills[civic_sub].appendleft(d)


def record_coinbase_live_fill(civic_sub: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persist a Coinbase live fill and optionally emit an on-chain attestation (env-driven; see fill_attestation).
    Returns the stored entry (may include attestation).
    """
    from .fill_attestation import merge_attestation

    final = merge_attestation(dict(entry))
    record_fill(civic_sub, final)
    return final


def list_fills(civic_sub: str, limit: int = 100) -> List[Dict[str, Any]]:
    with _lock:
        return list(_fills.get(civic_sub, deque()))[:limit]


def clear_fills(civic_sub: str) -> None:
    with _lock:
        _fills.pop(civic_sub, None)
