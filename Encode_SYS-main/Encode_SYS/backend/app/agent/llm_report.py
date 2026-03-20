from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List

import requests


def suggest_improvements(
    *,
    strategy_profile: Dict[str, Any],
    autonomous_trades: List[Dict[str, Any]],
    blocked_sample: List[Dict[str, Any]],
) -> Dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
    if not api_key:
        return {
            "summary": "",
            "improvements": [],
            "error": "OPENAI_API_KEY is not set",
        }

    prompt = (
        "You compare a user's historical strategy profile (from their past trades) with autonomous paper trades "
        "from a rule-based crypto demo bot. Respond with concise, actionable trading discipline suggestions — "
        "not financial advice.\n\n"
        f"USER_PROFILE_JSON:\n{json.dumps(strategy_profile, indent=2)[:8000]}\n\n"
        f"AUTONOMOUS_TRADES_JSON:\n{json.dumps(autonomous_trades, indent=2)[:8000]}\n\n"
        f"BLOCKED_ATTEMPTS_SAMPLE:\n{json.dumps(blocked_sample, indent=2)[:4000]}\n\n"
        "Return valid JSON only with keys: summary (string), improvements (array of exactly 3 strings)."
    )

    try:
        res = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You output only compact JSON."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
                "max_tokens": 600,
            },
            timeout=60,
        )
        data = res.json()
        if not res.ok:
            return {"summary": "", "improvements": [], "error": str(data)}
        text = (data["choices"][0]["message"]["content"] or "").strip()
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return {"summary": text[:500], "improvements": [], "error": "unparseable model output"}
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
        }
    except Exception as e:
        return {"summary": "", "improvements": [], "error": str(e)}
