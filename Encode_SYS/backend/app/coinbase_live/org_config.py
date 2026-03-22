from __future__ import annotations

import os
from typing import Optional

from .store import LinkedCredentials

_ORG_SENTINEL_SUB = "__org_shared__"
_PRESET_SENTINEL_SUB = "__preset_env__"


def _truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def is_org_mode() -> bool:
    return _truthy_env("COINBASE_ORG_TRADING")


def load_org_credentials() -> Optional[LinkedCredentials]:
    if not is_org_mode():
        return None
    kid = (os.getenv("COINBASE_ORG_API_KEY_ID") or "").strip()
    secret = (os.getenv("COINBASE_ORG_API_KEY_SECRET") or "").strip()
    if not kid or not secret:
        return None
    pid = (os.getenv("COINBASE_ORG_PRODUCT_ID") or "BTC-GBP").strip() or "BTC-GBP"
    return LinkedCredentials(
        civic_sub=_ORG_SENTINEL_SUB,
        api_key_id=kid,
        api_key_secret=secret,
        product_id=pid,
    )


def org_credentials_configured() -> bool:
    return load_org_credentials() is not None


def load_preset_env_credentials() -> Optional[LinkedCredentials]:
    """Server-wide CDP keys from env (no UI paste). Takes precedence over org and per-user SQLite."""
    kid = (os.getenv("COINBASE_PRESET_API_KEY_ID") or "").strip()
    secret = (os.getenv("COINBASE_PRESET_API_KEY_SECRET") or "").strip()
    if not kid or not secret:
        return None
    pid = (os.getenv("COINBASE_PRESET_PRODUCT_ID") or "BTC-GBP").strip() or "BTC-GBP"
    return LinkedCredentials(
        civic_sub=_PRESET_SENTINEL_SUB,
        api_key_id=kid,
        api_key_secret=secret,
        product_id=pid,
    )


def preset_env_configured() -> bool:
    return load_preset_env_credentials() is not None


def preset_env_partial() -> bool:
    """One of preset id/secret set but not both — misconfiguration."""
    kid = (os.getenv("COINBASE_PRESET_API_KEY_ID") or "").strip()
    secret = (os.getenv("COINBASE_PRESET_API_KEY_SECRET") or "").strip()
    return bool(kid) != bool(secret)


def uses_shared_coinbase_account() -> bool:
    """One Coinbase account for all signed-in users (org mode or preset env)."""
    return org_credentials_configured() or preset_env_configured()


def get_effective_credentials(civic_sub: str) -> Optional[LinkedCredentials]:
    preset = load_preset_env_credentials()
    if preset is not None:
        return preset
    org = load_org_credentials()
    if org is not None:
        return org
    from . import store

    return store.load_credentials(civic_sub)


def org_mode_key_id_masked() -> Optional[str]:
    org = load_org_credentials()
    if not org:
        return None
    k = org.api_key_id
    if len(k) <= 8:
        return "****"
    return f"{k[:4]}…{k[-4:]}"


def preset_env_key_id_masked() -> Optional[str]:
    p = load_preset_env_credentials()
    if not p:
        return None
    k = p.api_key_id
    if len(k) <= 8:
        return "****"
    return f"{k[:4]}…{k[-4:]}"


def org_sentinel_sub() -> str:
    return _ORG_SENTINEL_SUB
