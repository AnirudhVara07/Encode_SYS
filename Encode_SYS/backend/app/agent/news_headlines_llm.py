from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from .llm_http import _agent_debug_log, llm_chat_completion, llm_key_error_message, require_llm_config
from .secrets_redact import redact_secrets_for_client


def strategy_insights_from_headlines(*, articles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Turn normalized MarketAux articles (title, description, entities) into short
    strategy considerations for the Vigil paper / Pine demo — not investment advice.
    """
    cfg = require_llm_config()
    if not cfg:
        return {
            "summary": "",
            "considerations": [],
            "macro_todos": [],
            "asset_todos": [],
            "error": llm_key_error_message(),
        }
    api_key, model = cfg

    digest: List[Dict[str, Any]] = []
    for a in articles[:14]:
        digest.append(
            {
                "title": (a.get("title") or "")[:200],
                "description": (a.get("description") or "")[:240],
                "entities": (a.get("entities") or [])[:6],
            }
        )

    prompt = (
        "You help users of Vigil, a demo app for PineScript-style templates, paper crypto portfolios (e.g. BTC), "
        "and rule-based automation. Given recent market headlines below, produce strategy-oriented considerations: "
        "how macro or sector themes might affect risk appetite, volatility, correlation to crypto, position sizing, "
        "stops, or when to be cautious running overnight optimisations — framed as educational demo guidance, "
        "not personalized investment advice and not buy/sell instructions.\n\n"
        f"HEADLINES_JSON:\n{json.dumps(digest, indent=2)[:12000]}\n\n"
        "Return valid JSON only with keys: "
        "summary (string, 2–4 sentences, plain text), "
        "considerations (array of 4 to 6 short strings, each one line, no numbering prefix), "
        "macro_todos (array of exactly 4 short strings: demo checklist items for macro themes to watch — "
        "rates, inflation, central banks, FX, liquidity, geopolitical risk — not numbered), "
        "asset_todos (array of exactly 4 short strings: checklist items tied to specific assets, sectors, "
        "indices, or crypto symbols implied by the headlines — not numbered)."
    )

    messages = [
        {"role": "system", "content": "You output only compact JSON. No markdown."},
        {"role": "user", "content": prompt},
    ]

    try:
        text, err = llm_chat_completion(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.35,
            max_output_tokens=1000,
            timeout=60,
        )
        # #region agent log
        _agent_debug_log(
            hypothesis_id="H3",
            location="news_headlines_llm.py:strategy_insights_from_headlines",
            message="llm_chat_completion_response",
            data={
                "provider": "openrouter",
                "ok": err is None,
                "body_preview": redact_secrets_for_client((text or err or "")[:800]),
            },
        )
        # #endregion
        if err:
            return {
                "summary": "",
                "considerations": [],
                "macro_todos": [],
                "asset_todos": [],
                "error": err,
            }
        assert text is not None
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return {
                "summary": text[:400],
                "considerations": [],
                "macro_todos": [],
                "asset_todos": [],
                "error": "unparseable model output",
            }
        parsed = json.loads(m.group(0))
        raw_cons = parsed.get("considerations") or []
        if not isinstance(raw_cons, list):
            raw_cons = []
        considerations = [str(x).strip() for x in raw_cons if str(x).strip()][:6]

        def _sl(key: str, n: int) -> List[str]:
            raw = parsed.get(key) or []
            if not isinstance(raw, list):
                return []
            return [str(x).strip() for x in raw if str(x).strip()][:n]

        return {
            "summary": str(parsed.get("summary") or "").strip(),
            "considerations": considerations,
            "macro_todos": _sl("macro_todos", 6),
            "asset_todos": _sl("asset_todos", 6),
            "error": None,
        }
    except Exception as e:
        # #region agent log
        _agent_debug_log(
            hypothesis_id="H5",
            location="news_headlines_llm.py:strategy_insights_from_headlines",
            message="llm_request_exception",
            data={"exc_type": type(e).__name__, "exc": redact_secrets_for_client(str(e))[:500]},
        )
        # #endregion
        return {
            "summary": "",
            "considerations": [],
            "macro_todos": [],
            "asset_todos": [],
            "error": redact_secrets_for_client(str(e)),
        }
