from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from .llm_http import llm_chat_completion, llm_key_error_message, require_llm_config
from .secrets_redact import redact_secrets_for_client

_MAX_CONTEXT_JSON = 8000
_MAX_HISTORY_MESSAGES = 20  # last 10 back-and-forth turns
_MAX_REPLY_TOKENS = 900
_MD_BOLD_STARS = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_MD_BOLD_UNDER = re.compile(r"__(.+?)__", re.DOTALL)


def _plain_strategy_reply(text: str) -> str:
    """Strip common markdown bold markers so the UI stays plain (no ** segments)."""
    if not text:
        return text
    t = _MD_BOLD_STARS.sub(r"\1", text)
    t = _MD_BOLD_UNDER.sub(r"\1", t)
    return t


def run_strategy_chat(*, messages: List[Dict[str, str]], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    messages: OpenAI-style dicts with role user|assistant and content.
    context: server-built JSON-safe snapshot (profile, autopilot, etc.).
    """
    cfg = require_llm_config()
    if not cfg:
        return {"reply": "", "error": llm_key_error_message()}
    api_key, model = cfg

    ctx_blob = json.dumps(context, indent=2, default=str)
    if len(ctx_blob) > _MAX_CONTEXT_JSON:
        ctx_blob = ctx_blob[:_MAX_CONTEXT_JSON] + "\n…(truncated)"

    system = (
        "You are Vigil's in-app strategy assistant for a crypto trading demo (paper portfolios, "
        "optional PineScript-style templates, majority-vote Paper Vigil, and overnight optimization on uploaded Pine). "
        "Explain concepts clearly and suggest what to try next in the product — not personalized investment advice "
        "and not a promise of returns.\n\n"
        "Formatting: Write plain text only. Do not use markdown or markup of any kind — no asterisks for emphasis, "
        "no bold, no italics, no headings, no bullet or numbered markdown syntax. Use short paragraphs and line breaks.\n\n"
        "Strategy access: CONTEXT_JSON includes personalized_data_loaded, has_strategy_profile, and strategy_profile. "
        "When personalized_data_loaded is false, you do not have their session or stored strategy — for anything that "
        "depends on their specific strategy, tell them to open the Vigil dashboard, paste a valid bearer token so the "
        "assistant can load their session, then sync or submit their strategy profile in Vigil before asking personalized "
        "questions. When personalized_data_loaded is true but has_strategy_profile is false (or strategy_profile is null), "
        "say the same: they need to add or sync their strategy in Vigil on the dashboard first; you can still explain "
        "general product concepts. Never invent their parameters or pretend you see a profile you do not have.\n\n"
        "Use CONTEXT_JSON fields when available; otherwise rely on general knowledge of how such products typically work.\n\n"
        f"CONTEXT_JSON:\n{ctx_blob}"
    )

    trimmed = messages[-_MAX_HISTORY_MESSAGES:]
    openai_messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    for m in trimmed:
        role = m.get("role") or "user"
        if role not in ("user", "assistant"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        openai_messages.append({"role": role, "content": content[:4000]})

    if len(openai_messages) < 2:
        return {"reply": "", "error": "No valid user/assistant messages to send"}

    try:
        text, err = llm_chat_completion(
            api_key=api_key,
            model=model,
            messages=openai_messages,
            temperature=0.45,
            max_output_tokens=_MAX_REPLY_TOKENS,
            timeout=90,
        )
        if err:
            return {"reply": "", "error": err}
        assert text is not None
        return {"reply": _plain_strategy_reply(text.strip()), "error": None}
    except Exception as e:
        return {"reply": "", "error": redact_secrets_for_client(str(e))}
