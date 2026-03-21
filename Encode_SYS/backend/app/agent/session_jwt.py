from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict, Optional

import jwt

ALG = "HS256"
TTL_SEC = 24 * 3600


def _secret() -> str:
    s = os.getenv("SESSION_SIGNING_SECRET", "").strip()
    if not s:
        raise RuntimeError("SESSION_SIGNING_SECRET is not set")
    return s


def mint_token(*, sub: str, session_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "sid": session_id,
        "iat": now,
        "exp": now + TTL_SEC,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, _secret(), algorithm=ALG)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _secret(), algorithms=[ALG])


def peek_sub(token: str) -> Optional[str]:
    try:
        return str(decode_token(token).get("sub") or "")
    except Exception:
        return None
