"""
Strip API keys, tokens, and sensitive URL query params from strings before
they are returned to HTTP clients, logged in user-visible errors, or broadcast.
"""

from __future__ import annotations

import re

# OpenAI / OpenRouter–style API keys often echoed in upstream JSON errors
_LLM_KEY_RE = re.compile(
    r"sk-or-v1-[A-Za-z0-9]+|sk-proj-[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]{24,}\b|\bAIza[0-9A-Za-z\-_]{35}\b"
)
# api_token=…, apiKey=…, etc. in URLs or plain-text error bodies
_SECRET_PARAM_RE = re.compile(
    r"(?i)\b(api_token|apikey|api_key|access_token|refresh_token|client_secret)=[^\s&\"']+"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9\-_.]{20,}\b")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")


def redact_secrets_for_client(text: str) -> str:
    if not text:
        return text
    t = _LLM_KEY_RE.sub("[REDACTED]", str(text))
    t = _SECRET_PARAM_RE.sub(r"\1=[REDACTED]", t)
    t = _BEARER_RE.sub("Bearer [REDACTED]", t)
    t = _JWT_RE.sub("[REDACTED_JWT]", t)
    return t
