from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


def exchange_authorization_code(*, code: str, redirect_uri: str) -> Dict[str, Any]:
    """
    Standard OAuth2 authorization_code grant against Civic token endpoint.
    """
    client_id = os.getenv("CIVIC_CLIENT_ID", "").strip()
    client_secret = os.getenv("CIVIC_CLIENT_SECRET", "").strip()
    token_url = os.getenv("CIVIC_TOKEN_URL", "https://auth.civic.com/oauth/token").strip()

    if not client_id or not client_secret:
        raise RuntimeError("CIVIC_CLIENT_ID and CIVIC_CLIENT_SECRET must be set")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    res = requests.post(token_url, data=data, timeout=30)
    try:
        payload = res.json()
    except Exception as e:
        raise RuntimeError(f"Invalid token response: {e}") from e
    if not res.ok:
        raise RuntimeError(f"Civic token exchange failed: {payload}")
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
