from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Dict, List, Optional, Set

_lock = threading.Lock()
_connections: Set[Any] = set()
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def capture_loop() -> None:
    global _main_loop
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        pass


def register(ws: Any) -> None:
    capture_loop()
    with _lock:
        _connections.add(ws)


def unregister(ws: Any) -> None:
    with _lock:
        _connections.discard(ws)


async def _broadcast_all(text: str) -> None:
    dead: List[Any] = []
    with _lock:
        conns = list(_connections)
    for ws in conns:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        unregister(ws)


def broadcast(payload: Dict[str, Any]) -> None:
    text = json.dumps(payload, default=str)
    loop = _main_loop
    if loop is None:
        return

    def schedule() -> None:
        asyncio.create_task(_broadcast_all(text))

    try:
        loop.call_soon_threadsafe(schedule)
    except Exception:
        pass
