from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

from .llm_http import guarded_llm_chat_completion, llm_key_error_message, require_llm_config
from .llm_safety import SafetyProfile
from .secrets_redact import redact_secrets_for_client
from .universal_strategy import DetectionResult, detection_to_dict, normalize_strategy_json

_SYSTEM_EXTRACT = """You extract trading strategy rules from scripts, exports, or natural-language descriptions.

You are not a compiler — do not execute code. Read the logic and describe how a human would trade.

Respond with a single JSON object only (no markdown fences). Use exactly these keys:
- source_platform: string — one of: tradingview, metatrader, python, trade_export, api_json, document, natural_language, unknown (match the file when obvious)
- indicators: array of strings (e.g. RSI, MACD)
- timeframe: string (e.g. 4h, 1d, or "not specified")
- entry_conditions: string — concise plain language
- exit_conditions: string — concise plain language
- stop_loss: string — how risk is cut (percent, ATR, structure, etc.) or "not specified"
- take_profit: string — targets or "not specified"
- assets: array of strings (tickers/symbols if known, else [])
- raw_summary: string — fuller description of the approach
- user_summary: string — one friendly sentence starting with "We detected" or "We read" summarizing platform, main signals, timeframe, and risk (e.g. stop), for end-user confirmation
- vigil_template_hints: optional object. If the source states specific numbers, include only keys you are sure about (omit the key if unknown). Allowed keys: rsi_len, rsi_lower, rsi_upper, ema_len (trend filter length), ema_fast, ema_slow (crossover pair). Values must be JSON numbers (e.g. 21, not "21").

If the input is a trade log (CSV/JSON), infer typical holding style, direction bias, and risk from patterns; say what is uncertain.

If content is empty or unusable, still return valid JSON with best-effort unknowns and explain in user_summary."""


def _parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def extract_strategy_via_llm(
    *,
    filename: str,
    text: str,
    detection: DetectionResult,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], Optional[str], Dict[str, Any]]:
    """
    Returns (normalized_strategy_dict, error_message, raw_model_text_for_debug, safety).
    """
    none_safety: Dict[str, Any] = {"level": "ok", "source": "none"}
    cfg = require_llm_config()
    if not cfg:
        return None, llm_key_error_message(), None, none_safety
    api_key, model = cfg

    meta = json.dumps(detection_to_dict(detection), indent=2)
    user = (
        f"Filename: {filename}\n"
        f"Detector metadata:\n{meta}\n\n"
        f"--- file content ---\n{text}\n--- end ---\n"
    )

    messages = [
        {"role": "system", "content": _SYSTEM_EXTRACT},
        {"role": "user", "content": user[:118_000]},
    ]

    try:
        raw_text, err, safety = guarded_llm_chat_completion(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.25,
            max_output_tokens=1800,
            timeout=120,
            safety_profile=SafetyProfile.STRUCTURED_EXTRACT,
        )
        if err:
            return None, err, None, safety
        assert raw_text is not None
        parsed = _parse_json_object(raw_text)
        if not parsed:
            return None, "unparseable model output", raw_text[:2000], safety
        norm = normalize_strategy_json(parsed, fallback_platform=detection.source_platform)
        return norm, None, None, safety
    except Exception as e:
        return None, redact_secrets_for_client(str(e)), None, none_safety


_SYSTEM_REFINE = """You refine a trading strategy JSON summary using the user's corrections.

Return a single JSON object only with the same keys as before:
source_platform, indicators, timeframe, entry_conditions, exit_conditions, stop_loss, take_profit, assets, raw_summary, user_summary, vigil_template_hints (optional object; preserve or update numeric hints when corrections mention periods or RSI levels).

Preserve correct fields from CURRENT_JSON; apply CORRECTIONS. Update user_summary to one clear confirmation sentence."""


def refine_strategy_via_llm(
    *,
    current: Dict[str, Any],
    user_corrections: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], Dict[str, Any]]:
    none_safety: Dict[str, Any] = {"level": "ok", "source": "none"}
    cfg = require_llm_config()
    if not cfg:
        return None, llm_key_error_message(), none_safety
    api_key, model = cfg

    messages = [
        {"role": "system", "content": _SYSTEM_REFINE},
        {
            "role": "user",
            "content": (
                "CURRENT_JSON:\n"
                f"{json.dumps(current, indent=2)[:8000]}\n\n"
                f"CORRECTIONS:\n{user_corrections.strip()[:4000]}\n"
            ),
        },
    ]
    try:
        raw_text, err, safety = guarded_llm_chat_completion(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.2,
            max_output_tokens=1800,
            timeout=90,
            safety_profile=SafetyProfile.REFINE,
        )
        if err:
            return None, err, safety
        assert raw_text is not None
        parsed = _parse_json_object(raw_text)
        if not parsed:
            return None, "unparseable model output", safety
        plat = str(current.get("source_platform") or "unknown")
        norm = normalize_strategy_json(parsed, fallback_platform=plat)
        if not norm.get("vigil_template_hints") and isinstance(current.get("vigil_template_hints"), dict):
            prev = current.get("vigil_template_hints")
            if isinstance(prev, dict) and prev:
                norm["vigil_template_hints"] = dict(prev)
        return norm, None, safety
    except Exception as e:
        return None, redact_secrets_for_client(str(e)), none_safety
