"""
Shared LLM config for Vigil: OpenRouter only (OpenAI-compatible chat completions).

Set OPENROUTER_API_KEY and optionally OPENROUTER_MODEL (see openrouter_http.py default).
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Tuple

from .openrouter_http import (
    openrouter_api_key,
    openrouter_chat_completion,
    openrouter_model,
)


def _agent_debug_log(
    *,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict,
    run_id: str = "pre-fix",
) -> None:
    # #region agent log
    try:
        payload = {
            "sessionId": "7c30d5",
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with open(
            "/Users/admin/Downloads/Encode_SYS-main/.cursor/debug-7c30d5.log",
            "a",
            encoding="utf-8",
        ) as _f:
            _f.write(json.dumps(payload, default=str) + "\n")
    except Exception:
        pass
    # #endregion


def llm_key_error_message() -> str:
    return "No LLM API key: set OPENROUTER_API_KEY"


def require_llm_config() -> Tuple[str, str] | None:
    """Returns (api_key, model) if OPENROUTER_API_KEY is set, else None."""
    key = openrouter_api_key()
    if not key:
        _agent_debug_log(
            hypothesis_id="H2",
            location="llm_http.py:require_llm_config",
            message="no_llm_key",
            data={"model_env": openrouter_model()},
        )
        return None
    model = openrouter_model()
    _agent_debug_log(
        hypothesis_id="H1_H4",
        location="llm_http.py:require_llm_config",
        message="llm_config_resolved",
        data={
            "key_source": "OPENROUTER",
            "provider": "openrouter",
            "model": model,
        },
    )
    return (key, model)


def llm_chat_completion(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_output_tokens: int,
    timeout: int = 90,
) -> Tuple[str | None, str | None]:
    return openrouter_chat_completion(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        timeout=timeout,
    )
