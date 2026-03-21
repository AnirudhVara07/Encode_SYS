"""
OpenRouter: OpenAI-compatible chat completions.

https://openrouter.ai/docs/api/reference/overview
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

import requests

from .secrets_redact import redact_secrets_for_client

_OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


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
        return None, redact_secrets_for_client(str(data))

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
