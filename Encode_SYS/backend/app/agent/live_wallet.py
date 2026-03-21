"""
Live (on-chain) execution layer — AgentKit wallet provider hook.

Production: wire AgentKit / CDP here. Demo: stub records intent only; never moves real funds.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from . import state as agent_state
from . import ws_bus


UPGRADE_MESSAGE = "Upgrade to Pro to let Vigil trade for you"


class AgentKitLiveWallet:
    """
    Swap this implementation for real AgentKit signing when Pro users enable live mode.
    """

    def try_execute(
        self,
        *,
        side: str,
        usd: Optional[float],
        btc: Optional[float],
        price_usd: float,
        reasoning: str,
        session_id: Optional[str],
    ) -> Dict[str, Any]:
        if not session_id or not agent_state.get_session_is_pro(session_id):
            return {
                "ok": False,
                "upgrade_required": True,
                "message": UPGRADE_MESSAGE,
            }
        # Stub: no chain transaction — mirror shape for UI / logs
        oid = str(uuid.uuid4())
        entry: Dict[str, Any] = {
            "id": oid,
            "ts": time.time(),
            "side": side,
            "usd": usd,
            "btc": btc,
            "price": price_usd,
            "reasoning": reasoning or None,
            "execution_mode": "live",
            "agentkit_stub": True,
            "tx_hash": None,
            "note": "AgentKit wallet not wired — simulated live intent only",
        }
        agent_state.record_live_stub_fill(entry)
        try:
            ws_bus.broadcast({"event": "live_stub", "data": entry})
        except Exception:
            pass
        return {"ok": True, "fill": entry}


live_wallet = AgentKitLiveWallet()
