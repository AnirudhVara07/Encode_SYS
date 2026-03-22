"""
OpenRouter: OpenAI-compatible chat completions.

https://openrouter.ai/docs/api/reference/overview
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Tuple

import requests

from .secrets_redact import redact_secrets_for_client

_OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


def _format_openrouter_error_body(data: Any) -> str:
    """Readable client-safe message; OpenRouter often returns {\"error\": {\"message\", \"code\"}}."""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict) and err.get("message"):
            msg = str(err["message"]).strip().rstrip(".")
            code = err.get("code")
            suffix = f" (HTTP {code})" if code is not None else ""
            return (
                f"OpenRouter rejected the request{suffix}: {msg}. "
                "Set a valid OPENROUTER_API_KEY (see https://openrouter.ai/keys)."
            )
    return redact_secrets_for_client(str(data))


def openrouter_api_key() -> str:
    return os.getenv("OPENROUTER_API_KEY", "").strip()


def openrouter_model() -> str:
    return os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-001").strip()


def openrouter_chat_completion(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_output_tokens: int,
    timeout: int = 90,
) -> Tuple[str | None, str | None]:
    """
    Call OpenRouter chat/completions. messages use OpenAI shape (role, content).
    Returns (assistant_text, error_message). On success error is None.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    referer = os.getenv("OPENROUTER_HTTP_REFERER", "").strip()
    if referer:
        headers["HTTP-Referer"] = referer
    title = os.getenv("OPENROUTER_APP_TITLE", "Vigil").strip()
    if title:
        headers["X-Title"] = title

    body: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
    }

    try:
        res = requests.post(
            _OPENROUTER_CHAT_URL,
            headers=headers,
            json=body,
            timeout=timeout,
        )
        data = res.json() if res.content else {}
    except Exception as e:
        return None, redact_secrets_for_client(str(e))

    if not res.ok:
        # #region agent log
        try:
            err_nested = data.get("error") if isinstance(data, dict) else None
            _payload = {
                "sessionId": "6d8367",
                "runId": "pre",
                "hypothesisId": "H1_H4",
                "location": "openrouter_http.py:openrouter_chat_completion",
                "message": "openrouter_non_ok_response",
                "data": {
                    "http_status": res.status_code,
                    "has_error_key": isinstance(data, dict) and "error" in data,
                    "nested_message": err_nested.get("message")
                    if isinstance(err_nested, dict)
                    else None,
                    "nested_code": err_nested.get("code") if isinstance(err_nested, dict) else None,
                },
                "timestamp": int(time.time() * 1000),
            }
            with open(
                "/Users/admin/Downloads/Encode_SYS-main/.cursor/debug-6d8367.log",
                "a",
                encoding="utf-8",
            ) as _dbg:
                _dbg.write(json.dumps(_payload, default=str) + "\n")
        except Exception:
            pass
        # #endregion
        return None, _format_openrouter_error_body(data)

    choices = data.get("choices") or []
    if not choices:
        return None, redact_secrets_for_client(str(data)[:1200])

    msg = (choices[0] or {}).get("message") or {}
    raw_content = msg.get("content")
    if isinstance(raw_content, list):
        chunks: list[str] = []
        for part in raw_content:
            if isinstance(part, dict) and part.get("type") == "text":
                chunks.append(str(part.get("text") or ""))
        text = "".join(chunks).strip()
    else:
        text = (raw_content or "").strip() if isinstance(raw_content, str) else ""
    if not text:
        return None, redact_secrets_for_client(str(data)[:1200])
    return text, None
