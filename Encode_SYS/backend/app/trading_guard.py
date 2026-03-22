"""Optional human verification before live trading (Cloudflare Turnstile).

Civic Auth proves identity; Turnstile adds a per-action bot check. Configure both in production:
TURNSTILE_SITE_KEY (public) + TURNSTILE_SECRET_KEY (server only).
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests


def live_trading_captcha_config() -> Dict[str, Any]:
    secret = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
    site = os.getenv("TURNSTILE_SITE_KEY", "").strip()
    return {
        "captcha_required": bool(secret),
        "turnstile_site_key": site if secret else "",
    }


def verify_live_trading_captcha(token: Optional[str], remote_ip: Optional[str]) -> None:
    """Raise ValueError with a client-safe message if verification fails or is missing when required."""
    secret = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
    if not secret:
        return
    t = (token or "").strip()
    if not t:
        raise ValueError("Complete the captcha before starting live trading.")
    data: Dict[str, str] = {"secret": secret, "response": t}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        r = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=data,
            timeout=15,
        )
        r.raise_for_status()
        out = r.json()
    except requests.RequestException as e:
        raise ValueError("Captcha verification service unavailable. Try again.") from e
    if not isinstance(out, dict) or not out.get("success"):
        raise ValueError("Captcha verification failed. Refresh and try again.")
