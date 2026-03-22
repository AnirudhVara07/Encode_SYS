from __future__ import annotations

from cdp.auth.utils.jwt import JwtOptions, generate_jwt

_PROD_HOST = "api.coinbase.com"
_SANDBOX_HOST = "api-sandbox.coinbase.com"


def build_rest_jwt(
    *,
    api_key_id: str,
    api_key_secret: str,
    request_method: str,
    request_path: str,
    host: str = _PROD_HOST,
    expires_in: int = 120,
) -> str:
    """
    Short-lived JWT for Coinbase Advanced Trade REST (CDP).
    request_path must include leading slash, e.g. /api/v3/brokerage/orders
    """
    path = request_path if request_path.startswith("/") else f"/{request_path}"
    return generate_jwt(
        JwtOptions(
            api_key_id=api_key_id,
            api_key_secret=api_key_secret,
            request_method=request_method.upper(),
            request_host=host,
            request_path=path,
            expires_in=expires_in,
        )
    )


def jwt_for_orders_post(api_key_id: str, api_key_secret: str, *, host: str = _PROD_HOST) -> str:
    return build_rest_jwt(
        api_key_id=api_key_id,
        api_key_secret=api_key_secret,
        request_method="POST",
        request_path="/api/v3/brokerage/orders",
        host=host,
    )


def jwt_for_accounts_get(api_key_id: str, api_key_secret: str, *, host: str = _PROD_HOST) -> str:
    return build_rest_jwt(
        api_key_id=api_key_id,
        api_key_secret=api_key_secret,
        request_method="GET",
        request_path="/api/v3/brokerage/accounts",
        host=host,
    )
