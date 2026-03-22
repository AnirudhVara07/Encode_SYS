from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from .llm_http import guarded_llm_chat_completion, llm_key_error_message, require_llm_config
from .llm_safety import SafetyProfile
from .secrets_redact import redact_secrets_for_client


def suggest_improvements(
    *,
    strategy_profile: Dict[str, Any],
    autonomous_trades: List[Dict[str, Any]],
    blocked_sample: List[Dict[str, Any]],
) -> Dict[str, Any]:
    none_safety = {"level": "ok", "source": "none"}
    cfg = require_llm_config()
    if not cfg:
        return {
            "summary": "",
            "improvements": [],
            "error": llm_key_error_message(),
            "safety": none_safety,
        }
    api_key, model = cfg

    prompt = (
        "You compare a user's historical strategy profile (from their past trades) with autonomous paper trades "
        "from a rule-based crypto demo bot. Respond with concise, actionable trading discipline suggestions — "
        "not financial advice.\n\n"
        f"USER_PROFILE_JSON:\n{json.dumps(strategy_profile, indent=2)[:8000]}\n\n"
        f"AUTONOMOUS_TRADES_JSON:\n{json.dumps(autonomous_trades, indent=2)[:8000]}\n\n"
        f"BLOCKED_ATTEMPTS_SAMPLE:\n{json.dumps(blocked_sample, indent=2)[:4000]}\n\n"
        "Return valid JSON only with keys: summary (string), improvements (array of exactly 3 strings)."
    )

    messages = [
        {"role": "system", "content": "You output only compact JSON."},
        {"role": "user", "content": prompt},
    ]

    try:
        text, err, safety = guarded_llm_chat_completion(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.4,
            max_output_tokens=600,
            timeout=60,
            safety_profile=SafetyProfile.REPORT,
        )
        if err:
            return {
                "summary": "",
                "improvements": [],
                "error": err,
                "safety": safety,
            }
        assert text is not None
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return {
                "summary": text[:500],
                "improvements": [],
                "error": "unparseable model output",
                "safety": safety,
            }
        parsed = json.loads(m.group(0))
        imp = parsed.get("improvements") or []
        if not isinstance(imp, list):
            imp = []
        imp = [str(x) for x in imp[:3]]
        while len(imp) < 3:
            imp.append("")
        return {
            "summary": str(parsed.get("summary") or ""),
            "improvements": imp[:3],
            "error": None,
            "safety": safety,
        }
    except Exception as e:
        return {
            "summary": "",
            "improvements": [],
            "error": redact_secrets_for_client(str(e)),
            "safety": none_safety,
        }
