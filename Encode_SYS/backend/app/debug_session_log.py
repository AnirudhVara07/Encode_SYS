"""Cursor debug-mode NDJSON logger (session 981ea8). Do not log secrets."""
from __future__ import annotations

import json
import time
from pathlib import Path

_LOG = Path(__file__).resolve().parents[3] / ".cursor" / "debug-981ea8.log"


def write_debug(*, location: str, message: str, data: dict, hypothesis_id: str) -> None:
    try:
        _LOG.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(
            {
                "sessionId": "981ea8",
                "hypothesisId": hypothesis_id,
                "location": location,
                "message": message,
                "data": data,
                "timestamp": int(time.time() * 1000),
            },
            default=str,
        )
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
