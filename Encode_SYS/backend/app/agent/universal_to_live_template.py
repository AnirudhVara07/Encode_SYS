"""
Map a normalized universal-strategy extract (LLM JSON) to Vigil autopilot rows.

Live Coinbase execution only supports built-in template_type values; arbitrary scripts are not run.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Set, Tuple

_DEFAULT_PARAMS: Dict[str, Dict[str, float]] = {
    "RSIThresholdReversion": {"rsi_len": 14.0, "rsi_lower": 30.0, "rsi_upper": 70.0},
    "RSICrossTrendFilter": {"rsi_len": 14.0, "rsi_lower": 30.0, "rsi_upper": 70.0, "ema_len": 50.0},
    "EMACrossover": {"ema_fast": 10.0, "ema_slow": 30.0},
}


def _text_blob(universal: Dict[str, Any]) -> str:
    chunks: List[str] = []
    for key in (
        "entry_conditions",
        "exit_conditions",
        "raw_summary",
        "user_summary",
        "stop_loss",
        "take_profit",
        "timeframe",
    ):
        v = universal.get(key)
        if v:
            chunks.append(str(v).lower())
    ind = universal.get("indicators")
    if isinstance(ind, list):
        chunks.extend(str(x).lower() for x in ind if x is not None)
    return " ".join(chunks)


def _full_text_blob(universal: Dict[str, Any]) -> str:
    """All textual fields for template classification + regex parameter mining."""
    chunks: List[str] = []
    for key, v in universal.items():
        if key == "vigil_template_hints":
            continue
        if isinstance(v, str) and v.strip():
            chunks.append(v.lower())
        elif isinstance(v, list):
            chunks.extend(str(x).lower() for x in v if x is not None)
        elif isinstance(v, dict):
            chunks.append(json.dumps(v).lower())
    return " ".join(chunks)


def _clamp_rsi_band(params: Dict[str, float]) -> None:
    lo = float(params.get("rsi_lower", 30))
    hi = float(params.get("rsi_upper", 70))
    lo = max(1.0, min(49.0, lo))
    hi = max(51.0, min(99.0, hi))
    if lo >= hi:
        lo, hi = min(lo, hi - 1), max(hi, lo + 1)
        lo = max(1.0, min(49.0, lo))
        hi = max(51.0, min(99.0, hi))
    params["rsi_lower"] = lo
    params["rsi_upper"] = hi


def _regex_supplement_params(
    template_type: str,
    params: Dict[str, float],
    blob: str,
    skip_keys: Set[str],
) -> None:
    if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
        if "rsi_len" not in skip_keys:
            for pat in (
                r"(?i)\brsi\s*\(\s*(\d{1,3})\s*\)",
                r"(?i)ta\.rsi\s*\([^,]+,\s*(\d{1,3})\s*\)",
                r"(?i)\brsi\s*length\s*[=:]\s*(\d{1,3})\b",
                r"(?i)\brsi\s*period\s*[=:]\s*(\d{1,3})\b",
                r"(?i)\blength\s*=\s*(\d{1,3})\b(?=[\s\S]{0,120}rsi)",
            ):
                m = re.search(pat, blob)
                if m:
                    n = float(m.group(1))
                    if 2 <= n <= 200:
                        params["rsi_len"] = n
                    break
        if "rsi_lower" not in skip_keys:
            for pat in (
                r"(?i)\brsi(?:\([^)]*\))?\s+below\s*(\d{1,2})\b",
                r"(?i)oversold[^\d\n]{0,50}(\d{1,2})\b",
                r"(?i)\brsi\s*<\s*(\d{1,2})\b",
                r"(?i)\brsi\s+below\s*(\d{1,2})\b",
            ):
                m = re.search(pat, blob)
                if m:
                    n = float(m.group(1))
                    if 1 <= n <= 50:
                        params["rsi_lower"] = n
                    break
        if "rsi_upper" not in skip_keys:
            for pat in (
                r"(?i)\brsi(?:\([^)]*\))?\s+above\s*(\d{1,2})\b",
                r"(?i)overbought[^\d\n]{0,50}(\d{1,2})\b",
                r"(?i)\brsi\s*>\s*(\d{1,2})\b",
                r"(?i)\brsi\s+above\s*(\d{1,2})\b",
            ):
                m = re.search(pat, blob)
                if m:
                    n = float(m.group(1))
                    if 50 <= n <= 99:
                        params["rsi_upper"] = n
                    break

    if template_type == "RSICrossTrendFilter" and "ema_len" not in skip_keys:
        for pat in (
            r"(?i)\bema\s*\(\s*[^,]+,\s*(\d{1,4})\s*\)",
            r"(?i)trend\s*ema\s*[=:]?\s*(\d{1,4})\b",
            r"(?i)\b(\d{1,4})\s*ema\b(?=[\s\S]{0,40}trend)",
        ):
            m = re.search(pat, blob)
            if m:
                n = float(m.group(1))
                if 2 <= n <= 500:
                    params["ema_len"] = n
                break

    if template_type == "EMACrossover":
        need_fast = "ema_fast" not in skip_keys
        need_slow = "ema_slow" not in skip_keys
        if need_fast or need_slow:
            pairs = re.findall(r"(?i)\bema\s*\(\s*[^,]+,\s*(\d{1,4})\s*\)", blob)
            nums = sorted({float(x) for x in pairs if 2 <= float(x) <= 500})
            if len(nums) >= 2 and need_fast and need_slow:
                params["ema_fast"] = nums[0]
                params["ema_slow"] = nums[1] if nums[1] > nums[0] else nums[0] + 1
            elif len(nums) == 1 and need_fast and need_slow:
                n = nums[0]
                params["ema_fast"] = max(2.0, min(n - 1, n * 0.4))
                params["ema_slow"] = n
            elif len(re.findall(r"(?i)\bema\s*\(", blob)) < 1 and need_fast and need_slow:
                m = re.search(
                    r"(?i)\b(\d{1,3})\s*(?:and|/|,)\s*(\d{1,4})\b(?=[\s\S]{0,80}ema)",
                    blob,
                )
                if m:
                    a, b = float(m.group(1)), float(m.group(2))
                    if 2 <= a < b <= 500:
                        params["ema_fast"] = a
                        params["ema_slow"] = b


def _params_for_template(template_type: str, universal: Dict[str, Any], blob: str) -> Dict[str, float]:
    params = {k: float(v) for k, v in _DEFAULT_PARAMS[template_type].items()}
    skip: Set[str] = set()
    hints = universal.get("vigil_template_hints")
    if isinstance(hints, dict):
        for k, v in hints.items():
            if k not in params:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if fv == fv and abs(fv) < 1e9:
                params[k] = fv
                skip.add(k)

    _regex_supplement_params(template_type, params, blob, skip)

    if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
        ln = params.get("rsi_len", 14)
        params["rsi_len"] = max(2.0, min(200.0, ln))
        _clamp_rsi_band(params)
    if template_type == "RSICrossTrendFilter":
        el = params.get("ema_len", 50)
        params["ema_len"] = max(2.0, min(500.0, el))
    if template_type == "EMACrossover":
        ef, es = params.get("ema_fast", 10), params.get("ema_slow", 30)
        ef = max(2.0, min(499.0, ef))
        es = max(3.0, min(500.0, es))
        if ef >= es:
            es = ef + 1
        params["ema_fast"] = ef
        params["ema_slow"] = es

    return params


def suggest_live_autopilot_strategies(*, universal: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    """
    Returns strategy dicts suitable for coinbase_live autopilot config (id, name, template_type, params, enabled).
    """
    blob = _text_blob(universal)
    full_blob = _full_text_blob(universal)
    has_rsi = "rsi" in blob or "relative strength" in blob
    has_ema = "ema" in blob or "exponential moving average" in blob
    has_sma = "sma" in blob or "simple moving average" in blob
    cross_w = "cross" in blob or "crossover" in blob or "crosses" in blob
    has_ma_cross = cross_w and (has_ema or has_sma or "moving average" in blob)
    macd_cross = "macd" in blob and (cross_w or "signal line" in blob)

    if has_ma_cross or macd_cross:
        tt = "EMACrossover"
        note = (
            "Mapped to Vigil EMACrossover. Tune ema_fast and ema_slow to match the periods you use on your charts; "
            "MACD/cross-style rules are approximated with EMA crosses in this engine."
        )
    elif has_rsi and (has_ema or "trend" in blob or "filter" in blob or "above" in blob or "below" in blob):
        tt = "RSICrossTrendFilter"
        note = (
            "Mapped to Vigil RSICrossTrendFilter (RSI plus EMA trend filter). Adjust rsi_lower, rsi_upper, rsi_len, "
            "and ema_len to align with your uploaded rules."
        )
    elif has_rsi:
        tt = "RSIThresholdReversion"
        note = (
            "Mapped to Vigil RSIThresholdReversion. Live Vigil only executes these RSI/EMA templates — "
            "refine parameters below so they match your document."
        )
    elif has_ema or has_sma or "moving average" in blob:
        tt = "EMACrossover"
        note = "Mapped to Vigil EMACrossover from moving-average wording in your strategy extract."
    else:
        tt = "RSIThresholdReversion"
        note = (
            "Could not infer RSI vs EMA from the extract; defaulted to RSIThresholdReversion. "
            "Pick another Vigil template manually or add corrections on upload, then save again."
        )

    params = _params_for_template(tt, universal, full_blob)
    sid = str(uuid.uuid4())
    strat: Dict[str, Any] = {
        "id": sid,
        "name": "From uploaded strategy",
        "template_type": tt,
        "params": params,
        "enabled": True,
    }
    return [strat], note
