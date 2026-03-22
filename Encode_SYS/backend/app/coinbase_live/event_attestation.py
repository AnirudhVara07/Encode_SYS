"""
On-chain attestation for Vigil system events (guardrail blocks, kill-switch
toggles, strategy commitments, Merkle rollup roots).

Reuses the same env vars / wallet as fill_attestation.py:
  VIGIL_FILL_ATTEST_RPC_URL, VIGIL_FILL_ATTEST_PRIVATE_KEY,
  VIGIL_FILL_ATTEST_CONTRACT, VIGIL_FILL_ATTEST_EXPLORER_TX_URL (optional).

Calls VigilFillAttestor.attestEvent(uint8 eventType, bytes32 dataHash, uint256 ts).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Optional

log = logging.getLogger("vigil.event_attestation")

EVENT_TYPE_BLOCK = 1
EVENT_TYPE_KILL_SWITCH_ON = 2
EVENT_TYPE_KILL_SWITCH_OFF = 3
EVENT_TYPE_STRATEGY_COMMITMENT = 4
EVENT_TYPE_MERKLE_ROLLUP = 5

_ATTEST_EVENT_ABI = [
    {
        "inputs": [
            {"name": "eventType", "type": "uint8"},
            {"name": "dataHash", "type": "bytes32"},
            {"name": "ts", "type": "uint256"},
        ],
        "name": "attestEvent",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


def _send_attest_event_tx(
    event_type: int,
    data_hash: bytes,
    ts_int: int,
) -> Optional[Dict[str, Any]]:
    from .fill_attestation import attestation_configured, _env, _explorer_url_for_tx

    if not attestation_configured():
        return None

    try:
        from web3 import Web3
        from web3.exceptions import Web3Exception
    except ImportError:
        log.warning("event attestation skipped: web3 not installed")
        return None

    rpc = _env("VIGIL_FILL_ATTEST_RPC_URL")
    pk = _env("VIGIL_FILL_ATTEST_PRIVATE_KEY")
    contract_addr = _env("VIGIL_FILL_ATTEST_CONTRACT")
    if pk.startswith("0x"):
        pk = pk[2:]

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        log.warning("event attestation skipped: RPC not connected")
        return None

    chain_id = int(w3.eth.chain_id)
    acct = w3.eth.account.from_key(pk)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(contract_addr),
        abi=_ATTEST_EVENT_ABI,
    )

    try:
        nonce = w3.eth.get_transaction_count(acct.address, "pending")
        tx = contract.functions.attestEvent(event_type, data_hash, ts_int).build_transaction(
            {
                "from": acct.address,
                "nonce": nonce,
                "chainId": chain_id,
            }
        )
        block = w3.eth.get_block("latest")
        base_fee = block.get("baseFeePerGas")
        if base_fee is not None:
            priority = w3.to_wei(0.01, "gwei")
            tx["maxPriorityFeePerGas"] = priority
            tx["maxFeePerGas"] = int(base_fee) * 2 + priority
        else:
            tx["gasPrice"] = int(w3.eth.gas_price)

        tx["gas"] = int(w3.eth.estimate_gas(tx))
        signed = w3.eth.account.sign_transaction(tx, private_key=pk)
        raw_tx = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
        if raw_tx is None:
            raise RuntimeError("signed transaction has no raw bytes")
        h = w3.eth.send_raw_transaction(raw_tx)
        tx_hex = h.hex() if hasattr(h, "hex") else Web3.to_hex(h)
        if not tx_hex.startswith("0x"):
            tx_hex = f"0x{tx_hex}"
        rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=120)
        status = getattr(rcpt, "status", None)
        if status is not None and int(status) != 1:
            log.error("event attestation tx reverted: %s", tx_hex)
            return {
                "ok": False,
                "error": "transaction_reverted",
                "tx_hash": tx_hex,
                "explorer_url": _explorer_url_for_tx(chain_id, tx_hex),
                "chain_id": chain_id,
            }
        return {
            "ok": True,
            "tx_hash": tx_hex,
            "explorer_url": _explorer_url_for_tx(chain_id, tx_hex),
            "chain_id": chain_id,
            "event_type": event_type,
            "data_hash": Web3.to_hex(data_hash),
        }
    except Exception as e:
        log.exception("event attestation failed: %s", e)
        return {"ok": False, "error": str(e)[:500]}


def _keccak_text(preimage: str) -> bytes:
    from web3 import Web3
    return Web3.keccak(text=preimage)


def try_attest_block(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Attest a guardrail block event. entry is the blocked-trade dict."""
    rule_code = str(entry.get("rule_code") or "")
    entry_id = str(entry.get("id") or "")
    ts = float(entry.get("ts") or time.time())
    preimage = f"block|{entry_id}|{rule_code}|{int(ts)}"
    data_hash = _keccak_text(preimage)
    return _send_attest_event_tx(EVENT_TYPE_BLOCK, data_hash, int(ts))


def try_attest_kill_switch(on: bool) -> Optional[Dict[str, Any]]:
    """Attest a kill-switch state change."""
    ts = int(time.time())
    event_type = EVENT_TYPE_KILL_SWITCH_ON if on else EVENT_TYPE_KILL_SWITCH_OFF
    preimage = f"kill_switch|{'on' if on else 'off'}|{ts}"
    data_hash = _keccak_text(preimage)
    return _send_attest_event_tx(event_type, data_hash, ts)


def try_attest_strategy_commitment(
    strategy_id: str,
    params: Dict[str, Any],
    ts: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Attest a strategy/autopilot commitment hash."""
    t = int(ts or time.time())
    params_fingerprint = json.dumps(params, sort_keys=True, separators=(",", ":"))
    preimage = f"{strategy_id}|{params_fingerprint}|{t}"
    data_hash = _keccak_text(preimage)
    result = _send_attest_event_tx(EVENT_TYPE_STRATEGY_COMMITMENT, data_hash, t)
    if result:
        result["strategy_id"] = strategy_id
        result["params_fingerprint"] = params_fingerprint
    return result


def try_attest_merkle_root(
    merkle_root: bytes,
    leaf_count: int,
    ts: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Attest a Merkle rollup root of batched fill hashes."""
    t = ts or int(time.time())
    result = _send_attest_event_tx(EVENT_TYPE_MERKLE_ROLLUP, merkle_root, t)
    if result:
        result["leaf_count"] = leaf_count
    return result
