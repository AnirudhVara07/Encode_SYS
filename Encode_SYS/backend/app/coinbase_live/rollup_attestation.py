"""
Periodic Merkle-rollup attestation for Coinbase live fills.

Instead of one on-chain tx per fill, accumulates fill hashes into a per-user
buffer and flushes a single Merkle root when the batch reaches
VIGIL_ROLLUP_BATCH_SIZE (default 5). The root is attested via attestEvent(5, …).

Env:
  VIGIL_ROLLUP_BATCH_SIZE        — fills per rollup (default 5)
  VIGIL_FILL_ATTEST_PER_FILL     — "1" to also keep per-fill attestation (default off when rollup is active)
  (Plus the standard VIGIL_FILL_ATTEST_* vars for Web3 signing.)
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional

from .fill_attestation import attestation_configured

_lock = threading.Lock()
_pending: Dict[str, List[bytes]] = defaultdict(list)
_rollup_history: Dict[str, Deque[Dict[str, Any]]] = defaultdict(lambda: deque(maxlen=50))

_MAX_BATCH = 100


def _batch_size() -> int:
    raw = (os.getenv("VIGIL_ROLLUP_BATCH_SIZE") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return min(int(raw), _MAX_BATCH)
    return 5


def per_fill_attest_enabled() -> bool:
    return (os.getenv("VIGIL_FILL_ATTEST_PER_FILL") or "").strip() == "1"


def rollup_configured() -> bool:
    return attestation_configured()


def _merkle_root(leaves: List[bytes]) -> bytes:
    """Binary Merkle tree (keccak pairs, pad odd layers with last leaf)."""
    from web3 import Web3

    if not leaves:
        return b"\x00" * 32
    layer = list(leaves)
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])
        next_layer: List[bytes] = []
        for i in range(0, len(layer), 2):
            pair = layer[i] + layer[i + 1]
            next_layer.append(Web3.keccak(pair))
        layer = next_layer
    return layer[0]


def add_leaf(civic_sub: str, fill_hash: bytes) -> Optional[Dict[str, Any]]:
    """
    Append a fill hash leaf. If the batch reaches threshold, auto-flush and
    return the rollup blob. Otherwise returns None.
    """
    if not rollup_configured():
        return None
    with _lock:
        _pending[civic_sub].append(fill_hash)
        if len(_pending[civic_sub]) >= _batch_size():
            return _flush_locked(civic_sub)
    return None


def pending_count(civic_sub: str) -> int:
    with _lock:
        return len(_pending.get(civic_sub, []))


def pending_info(civic_sub: str) -> Dict[str, Any]:
    with _lock:
        leaves = list(_pending.get(civic_sub, []))
    from web3 import Web3
    return {
        "pending_count": len(leaves),
        "batch_size": _batch_size(),
        "leaf_hashes": [Web3.to_hex(h) for h in leaves],
    }


def force_flush(civic_sub: str) -> Optional[Dict[str, Any]]:
    """Flush regardless of batch count (end-of-session / manual)."""
    if not rollup_configured():
        return None
    with _lock:
        return _flush_locked(civic_sub)


def _flush_locked(civic_sub: str) -> Optional[Dict[str, Any]]:
    """Must be called with _lock held."""
    leaves = _pending.pop(civic_sub, [])
    if not leaves:
        return None

    from web3 import Web3
    from .event_attestation import try_attest_merkle_root

    root = _merkle_root(leaves)
    ts = int(time.time())
    att = try_attest_merkle_root(root, leaf_count=len(leaves), ts=ts)

    rollup: Dict[str, Any] = {
        "merkle_root": Web3.to_hex(root),
        "leaf_count": len(leaves),
        "leaf_hashes": [Web3.to_hex(h) for h in leaves],
        "ts": ts,
        "attestation": att,
    }
    _rollup_history[civic_sub].appendleft(rollup)
    return rollup


def list_rollups(civic_sub: str, limit: int = 20) -> List[Dict[str, Any]]:
    with _lock:
        return list(_rollup_history.get(civic_sub, deque()))[:limit]
