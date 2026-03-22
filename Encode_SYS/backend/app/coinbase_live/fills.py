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
    Persist a Coinbase live fill, feed the Merkle rollup accumulator, and
    optionally emit a per-fill on-chain attestation.

    Rollup mode (default when attestation env is configured):
      - Each fill hash is added as a leaf; when the batch reaches
        VIGIL_ROLLUP_BATCH_SIZE a Merkle root is attested in one tx.
      - Per-fill attestation is skipped unless VIGIL_FILL_ATTEST_PER_FILL=1.

    Returns the stored entry (may include attestation and/or rollup data).
    """
    from .fill_attestation import merge_attestation, attestation_configured
    from .rollup_attestation import rollup_configured, per_fill_attest_enabled, add_leaf

    final = dict(entry)

    if attestation_configured() and per_fill_attest_enabled():
        final = merge_attestation(final)

    if rollup_configured():
        try:
            from .fill_attestation import _fill_hash, _client_order_id_from_coinbase

            fill_id = str(final.get("id") or "")
            raw = final.get("coinbase_response")
            coid = _client_order_id_from_coinbase(raw) or fill_id[:128]
            ts = float(final.get("ts") or 0)
            fh = _fill_hash(fill_id=fill_id, client_order_id=coid, ts=ts)
            final["fill_hash"] = fh.hex() if isinstance(fh, bytes) else str(fh)

            rollup = add_leaf(civic_sub, fh)
            if rollup is not None:
                final["rollup"] = rollup
        except Exception:
            pass

    record_fill(civic_sub, final)
    return final


def list_fills(civic_sub: str, limit: int = 100) -> List[Dict[str, Any]]:
    with _lock:
        return list(_fills.get(civic_sub, deque()))[:limit]


def clear_fills(civic_sub: str) -> None:
    with _lock:
        _fills.pop(civic_sub, None)
