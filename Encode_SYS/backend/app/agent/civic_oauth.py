from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


def exchange_authorization_code(
    *,
    code: str,
    redirect_uri: str,
    code_verifier: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Standard OAuth2 authorization_code grant against Civic token endpoint.
    When the authorize step used PKCE, pass code_verifier so Civic can validate S256.
    """
    client_id = os.getenv("CIVIC_CLIENT_ID", "").strip()
    client_secret = os.getenv("CIVIC_CLIENT_SECRET", "").strip()
    token_url = os.getenv("CIVIC_TOKEN_URL", "https://auth.civic.com/oauth/token").strip()

    if not client_id or not client_secret:
        raise RuntimeError("CIVIC_CLIENT_ID and CIVIC_CLIENT_SECRET must be set")

    data: Dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    if code_verifier and code_verifier.strip():
        data["code_verifier"] = code_verifier.strip()
    res = requests.post(token_url, data=data, timeout=30)
    try:
        payload = res.json()
    except Exception as e:
        raise RuntimeError(f"Invalid token response: {e}") from e
    if not res.ok:
        msg = "Civic token exchange failed"
        if isinstance(payload, dict):
            parts = []
            for key in ("error", "error_description"):
                v = payload.get(key)
                if isinstance(v, str) and v.strip():
                    parts.append(v.strip()[:400])
            if parts:
                msg = "Civic token exchange failed: " + " — ".join(parts)
        raise RuntimeError(msg)
    return payload


def pick_subject(tokens: Dict[str, Any]) -> str:
    """Derive a stable subject string from Civic token payload."""
    id_tok = tokens.get("id_token")
    if isinstance(id_tok, str) and id_tok:
        return f"id_token:{id_tok[:32]}..."
    sub = tokens.get("sub")
    if sub:
        return str(sub)
    at = tokens.get("access_token")
    if isinstance(at, str) and at:
        return f"access_token:{at[:24]}..."
    return "unknown"
