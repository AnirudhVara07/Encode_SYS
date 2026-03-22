"""Thread-safe pub/sub for paper trading floor SSE (autopilot ticks, halt/resume)."""

from __future__ import annotations

import json
import queue
import threading
from typing import Any, Dict, List

_subscribers: List[queue.Queue] = []
_sub_lock = threading.Lock()


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=256)
    with _sub_lock:
        _subscribers.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _sub_lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


def publish(event: str, data: Dict[str, Any]) -> None:
    line = json.dumps({"event": event, "data": data}, default=str)
    with _sub_lock:
        targets = list(_subscribers)
    for q in targets:
        try:
            q.put_nowait(line)
        except queue.Full:
            try:
                while True:
                    q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(line)
            except Exception:
                unsubscribe(q)
