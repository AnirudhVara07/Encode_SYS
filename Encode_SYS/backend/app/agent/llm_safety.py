"""
LLM input/output screening: optional Civic Bodyguard HTTP API plus light local checks.

Bodyguard request/response shapes are configurable via env; when unset, only local rules apply.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

SafetyLevel = Literal["ok", "blocked", "redacted"]
SafetySource = Literal["civic_bodyguard", "local", "none"]


class SafetyProfile(str, Enum):
    CHAT = "chat"
    STRUCTURED_EXTRACT = "structured_extract"
    REFINE = "refine"
    NEWS_INSIGHTS = "news_insights"
    REPORT = "report"


@dataclass
class SafetyResult:
    level: SafetyLevel
    source: SafetySource
    modified_text: Optional[str] = None
    block_message: Optional[str] = None
    detail: str = ""  # internal / logs only


@dataclass
class SafetyMeta:
    """Serializable for API responses."""

    level: SafetyLevel
    source: SafetySource

    def as_dict(self) -> Dict[str, Any]:
        return {"level": self.level, "source": self.source}


# --- Local patterns (narrow; avoid strategy-script false positives where possible) ---

_CC_GROUP = r"(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})"
# Visa/Mastercard/Amex-style contiguous digits (with optional separators)
_RE_CREDIT_CARD = re.compile(
    rf"\b(?:\d{{4}}[-\s]?){{3}}\d{{3,4}}\b|\b{_CC_GROUP}\b",
    re.IGNORECASE,
)
_RE_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_RE_EMAIL = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
)
_RE_PHONE = re.compile(r"\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b")


def _bodyguard_config() -> Tuple[Optional[str], Optional[str], float]:
    base = os.getenv("CIVIC_BODYGUARD_BASE_URL", "").strip()
    key = os.getenv("CIVIC_BODYGUARD_API_KEY", "").strip()
    raw_th = os.getenv("CIVIC_BODYGUARD_BLOCK_THRESHOLD", "0.85").strip()
    try:
        threshold = float(raw_th)
    except ValueError:
        threshold = 0.85
    threshold = max(0.0, min(1.0, threshold))
    if not base:
        return None, None, threshold
    return base.rstrip("/"), key or None, threshold


def _bodyguard_screen_text(text: str) -> Tuple[Optional[SafetyResult], bool]:
    """
    Call Bodyguard if configured. Returns (SafetyResult if decisive, did_call).
    On network/parse errors, returns (None, True) if URL was hit else (None, False) — caller fails open.
    """
    base, api_key, threshold = _bodyguard_config()
    if not base or not text.strip():
        return None, False

    url = base
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pluggable JSON body; default matches common "text + score" patterns.
    payload: Dict[str, Any] = {"text": text[:48_000]}
    extra = os.getenv("CIVIC_BODYGUARD_EXTRA_JSON", "").strip()
    if extra:
        try:
            payload.update(json.loads(extra))
        except json.JSONDecodeError:
            logger.warning("CIVIC_BODYGUARD_EXTRA_JSON is not valid JSON; ignoring")

    try:
        r = requests.post(url, json=payload, headers=headers, timeout=12)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("Civic Bodyguard request failed (failing open): %s", e)
        return None, True

    blocked = bool(data.get("blocked") or data.get("block"))
    score = data.get("threat_score")
    if score is None:
        score = data.get("score")
    if isinstance(score, (int, float)) and not blocked:
        blocked = float(score) >= threshold

    risk = str(data.get("risk") or "").lower()
    if risk in ("high", "critical", "severe"):
        blocked = True

    if blocked:
        return (
            SafetyResult(
                level="blocked",
                source="civic_bodyguard",
                block_message="We could not send that through our safety checks. Try rephrasing your message.",
                detail="bodyguard_blocked",
            ),
            True,
        )
    return None, True


def _local_screen_input(text: str, *, profile: SafetyProfile) -> Optional[SafetyResult]:
    # Full strategy files often contain long digit sequences (Pine/indicators); SSN-shaped patterns only.
    if profile == SafetyProfile.STRUCTURED_EXTRACT:
        if _RE_SSN.search(text):
            return SafetyResult(
                level="blocked",
                source="local",
                block_message="That file may contain SSN-like patterns. Remove or redact them and try again.",
                detail="local_sensitive_pattern",
            )
        return None

    if profile == SafetyProfile.REFINE:
        if _RE_CREDIT_CARD.search(text) or _RE_SSN.search(text):
            return SafetyResult(
                level="blocked",
                source="local",
                block_message="That content looks like it may contain sensitive numbers. Remove payment or tax-ID-like data and try again.",
                detail="local_sensitive_pattern",
            )
        return None

    if profile == SafetyProfile.CHAT:
        if _RE_CREDIT_CARD.search(text) or _RE_SSN.search(text):
            return SafetyResult(
                level="blocked",
                source="local",
                block_message="Messages cannot include payment card numbers or SSN-like patterns.",
                detail="local_sensitive_pattern",
            )
    return None


def _redact_output_text(text: str) -> Tuple[str, bool]:
    if not text:
        return text, False
    changed = False
    out, c = _RE_EMAIL.subn("[redacted email]", text)
    if c:
        changed = True
    out, c = _RE_PHONE.subn("[redacted phone]", out)
    if c:
        changed = True
    out, c = _RE_SSN.subn("[redacted]", out)
    if c:
        changed = True
    return out, changed


def _latest_user_text(messages: List[Dict[str, Any]], *, window: int = 3) -> str:
    parts: List[str] = []
    for m in messages[-window:]:
        if (m.get("role") or "") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            parts.append(c.strip())
    if not parts:
        return ""
    return "\n\n".join(parts)


def screen_llm_request(*, profile: SafetyProfile, messages: List[Dict[str, Any]]) -> SafetyResult:
    """Pre-flight screening. Returns level ok or blocked."""
    text_for_bodyguard = ""
    text_for_local = ""

    if profile == SafetyProfile.CHAT:
        text_for_bodyguard = _latest_user_text(messages, window=6)
        text_for_local = _latest_user_text(messages, window=2)
    elif profile in (SafetyProfile.STRUCTURED_EXTRACT, SafetyProfile.REFINE):
        for m in reversed(messages):
            if (m.get("role") or "") == "user" and isinstance(m.get("content"), str):
                text_for_local = m["content"]
                break
        # Skip Bodyguard on full Pine uploads (high false positive risk)
        text_for_bodyguard = ""
    elif profile in (SafetyProfile.NEWS_INSIGHTS, SafetyProfile.REPORT):
        text_for_bodyguard = ""
        text_for_local = ""

    if text_for_local:
        hit = _local_screen_input(text_for_local, profile=profile)
        if hit:
            return hit

    if text_for_bodyguard:
        bg, called = _bodyguard_screen_text(text_for_bodyguard)
        if bg:
            return bg
        if called:
            return SafetyResult(level="ok", source="civic_bodyguard", detail="bodyguard_ok")

    return SafetyResult(level="ok", source="none", detail="no_screen")


def screen_llm_response(*, profile: SafetyProfile, text: str) -> Tuple[str, SafetyResult]:
    """
    Post-process model output. May redact PII-like patterns for user-visible strings.
    Returns (possibly_modified_text, result_metadata).
    """
    if profile == SafetyProfile.CHAT:
        bg, called = _bodyguard_screen_text(text[:48_000])
        if bg and bg.level == "blocked":
            return (
                "",
                SafetyResult(
                    level="blocked",
                    source="civic_bodyguard",
                    block_message="The assistant reply did not pass safety checks. Please try again.",
                    detail="bodyguard_output_blocked",
                ),
            )
        new_t, redacted = _redact_output_text(text)
        if redacted:
            src: SafetySource = "civic_bodyguard" if called else "local"
            return (
                new_t,
                SafetyResult(level="redacted", source=src, modified_text=new_t, detail="output_redacted"),
            )
        if called:
            return text, SafetyResult(level="ok", source="civic_bodyguard", detail="bodyguard_output_ok")
        return text, SafetyResult(level="ok", source="none", detail="output_pass")

    if profile in (SafetyProfile.NEWS_INSIGHTS, SafetyProfile.REPORT):
        new_t, redacted = _redact_output_text(text)
        if redacted:
            return new_t, SafetyResult(level="redacted", source="local", modified_text=new_t, detail="output_redacted")
        return text, SafetyResult(level="ok", source="none", detail="output_pass")

    # structured extract / refine: JSON-like; light redact only if obvious email/phone in strings
    new_t, redacted = _redact_output_text(text)
    if redacted:
        return new_t, SafetyResult(level="redacted", source="local", modified_text=new_t, detail="output_redacted")
    return text, SafetyResult(level="ok", source="none", detail="output_pass")


def merge_safety_meta(req: SafetyResult, resp: SafetyResult) -> SafetyMeta:
    """Combine request-phase and response-phase outcomes for a single API payload."""
    if req.level == "blocked":
        return SafetyMeta(level="blocked", source=req.source)
    if resp.level == "blocked":
        return SafetyMeta(level="blocked", source=resp.source)
    if resp.level == "redacted":
        return SafetyMeta(level="redacted", source=resp.source)
    if req.source == "civic_bodyguard" or resp.source == "civic_bodyguard":
        return SafetyMeta(level="ok", source="civic_bodyguard")
    if req.source == "local" or resp.source == "local":
        return SafetyMeta(level="ok", source="local")
    return SafetyMeta(level="ok", source="none")
