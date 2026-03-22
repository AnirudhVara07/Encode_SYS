from __future__ import annotations

from typing import Any, Dict

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..agent import session_jwt
from ..agent import state as agent_state

security = HTTPBearer(auto_error=False)


async def get_current_session(creds: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")
    try:
        payload = session_jwt.decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session token") from None
    sid = str(payload.get("sid") or "")
    if not sid:
        raise HTTPException(status_code=401, detail="Invalid session")
    sess = agent_state.get_server_session(sid)
    if not sess:
        raise HTTPException(status_code=401, detail="Session not found or expired")
    return {"sub": str(payload.get("sub") or ""), "sid": sid, "jwt": creds.credentials, "civic": sess}
