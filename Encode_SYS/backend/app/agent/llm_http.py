"""
Shared LLM config for Vigil: OpenRouter only (OpenAI-compatible chat completions).

Set OPENROUTER_API_KEY and optionally OPENROUTER_MODEL (see openrouter_http.py default).
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .llm_safety import SafetyMeta, SafetyProfile, merge_safety_meta, screen_llm_request, screen_llm_response
from .openrouter_http import (
    openrouter_api_key,
    openrouter_chat_completion,
    openrouter_model,
)


def llm_key_error_message() -> str:
    return "No LLM API key: set OPENROUTER_API_KEY"


def require_llm_config() -> Tuple[str, str] | None:
    """Returns (api_key, model) if OPENROUTER_API_KEY is set, else None."""
    key = openrouter_api_key()
    if not key:
        return None
    model = openrouter_model()
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


def guarded_llm_chat_completion(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_output_tokens: int,
    timeout: int = 90,
    safety_profile: SafetyProfile,
) -> Tuple[str | None, str | None, Dict[str, Any]]:
    """
    Run request/response safety screening then OpenRouter chat completion.
    Returns (text, error, safety_dict) for JSON APIs.
    """
    req_res = screen_llm_request(profile=safety_profile, messages=messages)
    if req_res.level == "blocked":
        meta = SafetyMeta(level="blocked", source=req_res.source)
        return None, req_res.block_message or "Request blocked by safety checks.", meta.as_dict()

    text, err = openrouter_chat_completion(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        timeout=timeout,
    )
    if err or text is None:
        return text, err, SafetyMeta(level="ok", source=req_res.source).as_dict()

    out_text, resp_res = screen_llm_response(profile=safety_profile, text=text)
    if resp_res.level == "blocked":
        meta = SafetyMeta(level="blocked", source=resp_res.source)
        return None, resp_res.block_message or "Reply blocked by safety checks.", meta.as_dict()

    meta = merge_safety_meta(req_res, resp_res)
    return out_text, None, meta.as_dict()
