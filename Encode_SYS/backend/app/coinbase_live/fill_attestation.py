"""
Optional on-chain attestation after a successful Coinbase Advanced Trade fill.

Set VIGIL_FILL_ATTEST_RPC_URL, VIGIL_FILL_ATTEST_PRIVATE_KEY, and VIGIL_FILL_ATTEST_CONTRACT
(see backend/.env.example). Use a dedicated testnet wallet; never commit real keys.

Settlement remains on Coinbase; this tx is an audit / explorer-visible receipt only.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

log = logging.getLogger("vigil.fill_attestation")

# VigilFillAttestor.sol — single external function
_ATTEST_ABI = [
    {
        "inputs": [
            {"name": "fillHash", "type": "bytes32"},
            {"name": "clientOrderId", "type": "string"},
            {"name": "side", "type": "uint8"},
            {"name": "ts", "type": "uint256"},
        ],
        "name": "attest",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

_MAX_CLIENT_ORDER_ID_LEN = 128


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def attestation_configured() -> bool:
    return bool(_env("VIGIL_FILL_ATTEST_RPC_URL") and _env("VIGIL_FILL_ATTEST_PRIVATE_KEY") and _env("VIGIL_FILL_ATTEST_CONTRACT"))


def _client_order_id_from_coinbase(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""
    sr = raw.get("success_response")
    if isinstance(sr, dict):
        for key in ("order_id", "client_order_id", "client_orderId"):
            v = sr.get(key)
            if v:
                return str(v)[:_MAX_CLIENT_ORDER_ID_LEN]
    for key in ("order_id", "client_order_id"):
        v = raw.get(key)
        if v:
            return str(v)[:_MAX_CLIENT_ORDER_ID_LEN]
    return ""


def _side_u8(side: Any) -> int:
    s = (str(side or "")).strip().lower()
    if s == "buy":
        return 1
    if s == "sell":
        return 2
    return 0


def _fill_hash(*, fill_id: str, client_order_id: str, ts: float) -> bytes:
    from web3 import Web3

    preimage = f"{fill_id}|{client_order_id}|{int(ts)}"
    return Web3.keccak(text=preimage)


def _default_explorer_tx_url(chain_id: int) -> str:
    if chain_id == 84532:
        return "https://sepolia.basescan.org/tx/{tx_hash}"
    if chain_id == 8453:
        return "https://basescan.org/tx/{tx_hash}"
    if chain_id == 11155111:
        return "https://sepolia.etherscan.io/tx/{tx_hash}"
    return "https://basescan.org/tx/{tx_hash}"


def _explorer_url_for_tx(chain_id: int, tx_hash_hex: str) -> str:
    tpl = _env("VIGIL_FILL_ATTEST_EXPLORER_TX_URL")
    if not tpl:
        tpl = _default_explorer_tx_url(chain_id)
    h = tx_hash_hex if tx_hash_hex.startswith("0x") else f"0x{tx_hash_hex}"
    return tpl.replace("{tx_hash}", h).replace("{hash}", h)


def try_attest_coinbase_fill(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    If env is configured, submit attest() and return a dict to merge under entry['attestation'].
    On failure or misconfiguration returns None (fill should still be recorded).
    """
    if not attestation_configured():
        return None

    fill_id = str(entry.get("id") or "").strip()
    if not fill_id:
        log.warning("fill attestation skipped: missing fill id")
        return None

    raw = entry.get("coinbase_response")
    coid = _client_order_id_from_coinbase(raw) or fill_id[:_MAX_CLIENT_ORDER_ID_LEN]
    ts = float(entry.get("ts") or 0)
    side_u8 = _side_u8(entry.get("side"))

    try:
        from web3 import Web3
        from web3.exceptions import Web3Exception
    except ImportError:
        log.warning("fill attestation skipped: web3 not installed")
        return None

    rpc = _env("VIGIL_FILL_ATTEST_RPC_URL")
    pk = _env("VIGIL_FILL_ATTEST_PRIVATE_KEY")
    contract_addr = _env("VIGIL_FILL_ATTEST_CONTRACT")
    if pk.startswith("0x"):
        pk = pk[2:]

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        log.warning("fill attestation skipped: RPC not connected")
        return None

    chain_id = int(w3.eth.chain_id)
    acct = w3.eth.account.from_key(pk)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(contract_addr),
        abi=_ATTEST_ABI,
    )

    fill_hash = _fill_hash(fill_id=fill_id, client_order_id=coid, ts=ts)
    ts_int = int(ts)

    try:
        nonce = w3.eth.get_transaction_count(acct.address, "pending")
        tx = contract.functions.attest(fill_hash, coid, side_u8, ts_int).build_transaction(
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
            log.error("fill attestation tx reverted: %s", tx_hex)
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
            "fill_hash": Web3.to_hex(fill_hash),
            "client_order_id": coid,
        }
    except Web3Exception as e:
        log.exception("fill attestation web3 error: %s", e)
        return {"ok": False, "error": str(e)[:500]}
    except Exception as e:
        log.exception("fill attestation failed: %s", e)
        return {"ok": False, "error": str(e)[:500]}


def merge_attestation(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of entry with optional attestation merged (does not mutate input)."""
    out = dict(entry)
    att = try_attest_coinbase_fill(out)
    if att is not None:
        out["attestation"] = att
    return out
