"""
Detect trading-platform / file kind and turn uploaded bytes into text for LLM strategy extraction.

We do not execute Pine, MQL, or Python — the model interprets source or structured exports.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

_MAX_LLM_CHARS = 120_000
_COMPILED_MT_EXTENSIONS = frozenset({".ex4", ".ex5"})
_IMAGE_UPLOAD_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})


@dataclass
class DetectionResult:
    file_kind: str  # pine | mql | python | plaintext | csv | json | pdf | unknown
    source_platform: str  # tradingview | metatrader | python | trade_export | api_json | document | unknown
    confidence: str  # high | medium | low
    notes: str


def _ext(name: str) -> str:
    n = (name or "").lower().strip()
    if "." not in n:
        return ""
    return "." + n.rsplit(".", 1)[-1]


def _decoded_text_looks_binary(text: str, *, decoded_with_replace: bool) -> bool:
    """
    Classify decoded UTF-8 text. The old byte-ratio check falsely flagged valid UTF-8 files
    with non-ASCII characters (accented Latin, CJK, emoji) as binary.
    """
    if not text:
        return False
    sample = text[:8000]
    if "\x00" in sample:
        return True
    if decoded_with_replace:
        fffd = sample.count("\ufffd")
        if fffd > 0 and fffd / max(len(sample), 1) > 0.02:
            return True
    good = 0
    for ch in sample:
        if ch == "\ufffd":
            continue
        if ch.isprintable() or ch in "\n\r\t":
            good += 1
    return good / max(len(sample), 1) < 0.65


def _pine_signals(s: str) -> bool:
    return bool(
        re.search(r"//@version\s*=", s)
        or re.search(r"//\s*@version\s*=", s)
        or re.search(r"\bstrategy\s*\(", s)
        or re.search(r"\bindicator\s*\(", s)
        or "pine" in s[:2000].lower()
    )


def _mql_signals(s: str) -> bool:
    return bool(
        re.search(r"\bint\s+OnInit\s*\(", s)
        or re.search(r"\bvoid\s+OnTick\s*\(", s)
        or re.search(r"#property\s+", s, re.I)
        or re.search(r"\bMqlTick\b", s)
        or re.search(r"\bOrderSend\s*\(", s)
    )


def _python_signals(s: str) -> bool:
    head = s[:4000]
    return bool(
        re.search(r"^#!.*python", head, re.M)
        or ("import ccxt" in head or "import pandas" in head or "backtrader" in head)
        or (head.count("def ") >= 2 and "import " in head)
    )


def detect_from_filename_and_text(filename: str, text: str) -> DetectionResult:
    ext = _ext(filename)
    s = text or ""
    low = s[:12000].lower()

    if ext == ".pine" or _pine_signals(s):
        return DetectionResult("pine", "tradingview", "high", "Pine Script-style markers or .pine extension")

    if ext in (".mq4", ".mq5", ".mqh") or _mql_signals(s):
        return DetectionResult("mql", "metatrader", "high", "MQL markers or MetaTrader extension")

    if ext == ".py" or _python_signals(s):
        return DetectionResult("python", "python", "medium", "Python script heuristics")

    if ext == ".json":
        return DetectionResult("json", "api_json", "high", "JSON extension")

    if ext == ".csv" or ("," in s[:500] and ("symbol" in low or "side" in low or "price" in low)):
        return DetectionResult("csv", "trade_export", "medium", "CSV / trade-log style")

    if ext == ".pdf":
        return DetectionResult("pdf", "document", "high", "PDF extension")

    if ext == ".txt" or ext == "":
        if _pine_signals(s):
            return DetectionResult("pine", "tradingview", "medium", "Pine markers in .txt")
        if _mql_signals(s):
            return DetectionResult("mql", "metatrader", "medium", "MQL markers in .txt")
        return DetectionResult("plaintext", "unknown", "low", "Plain text — platform inferred by content")

    return DetectionResult("unknown", "unknown", "low", "Could not classify from extension or snippet")


def _truncate(t: str) -> str:
    if len(t) <= _MAX_LLM_CHARS:
        return t
    return t[: _MAX_LLM_CHARS] + "\n\n…(truncated for model context)"


def _pdf_to_text(data: bytes) -> Tuple[str, Optional[str]]:
    try:
        from io import BytesIO

        from pypdf import PdfReader
    except ImportError:
        return "", "pypdf not installed"
    try:
        reader = PdfReader(BytesIO(data))
        parts: list[str] = []
        for page in reader.pages[:80]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n\n".join(parts).strip(), None
    except Exception as e:
        return "", str(e)


def bytes_to_llm_text(*, filename: str, data: bytes) -> Tuple[str, DetectionResult, Optional[str]]:
    """
    Returns (text_for_llm, detection, error_message).
    error_message is set when the file cannot be converted (e.g. compiled binary).
    """
    ext = _ext(filename)

    if ext in _COMPILED_MT_EXTENSIONS:
        return (
            "",
            DetectionResult("mql", "metatrader", "high", "Compiled MetaTrader binary — source .mq4/.mq5 required"),
            "Compiled .ex4/.ex5 files cannot be read as strategy source. Export or upload the .mq4 or .mq5 file instead.",
        )

    if ext == ".pdf":
        text, err = _pdf_to_text(data)
        if err:
            return "", DetectionResult("pdf", "document", "low", err), f"PDF read failed: {err}"
        det = detect_from_filename_and_text(filename, text)
        if det.file_kind != "pdf":
            det = DetectionResult("pdf", det.source_platform, det.confidence, det.notes + " (from PDF text)")
        return _truncate(text), det, None

    decoded_with_replace = False
    try:
        raw = data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            raw = data.decode("utf-8", errors="replace")
            decoded_with_replace = True
        except Exception:
            return (
                "",
                DetectionResult("unknown", "unknown", "low", "decode error"),
                "File is not valid UTF-8 text; try saving as UTF-8 or upload a text export.",
            )

    if ext == ".json":
        try:
            obj = json.loads(raw)
            pretty = json.dumps(obj, indent=2, default=str)
            det = DetectionResult("json", "api_json", "high", "Structured JSON")
            return _truncate(pretty), det, None
        except json.JSONDecodeError as e:
            return "", DetectionResult("json", "api_json", "low", "invalid json"), f"Invalid JSON: {e}"

    if ext not in _IMAGE_UPLOAD_EXTENSIONS and _decoded_text_looks_binary(
        raw, decoded_with_replace=decoded_with_replace
    ):
        return (
            "",
            DetectionResult("unknown", "unknown", "low", "binary"),
            "File looks like binary data. Upload a text source file, CSV/JSON export, or PDF report.",
        )

    det = detect_from_filename_and_text(filename, raw)
    return _truncate(raw), det, None


def detection_to_dict(d: DetectionResult) -> Dict[str, Any]:
    return {
        "file_kind": d.file_kind,
        "source_platform": d.source_platform,
        "confidence": d.confidence,
        "notes": d.notes,
    }


def normalize_strategy_json(raw: Dict[str, Any], *, fallback_platform: str) -> Dict[str, Any]:
    """Ensure required keys exist with JSON-serializable values."""

    def _str_list(v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v if x is not None and str(x).strip()][:50]
        if isinstance(v, str) and v.strip():
            return [v.strip()]
        return []

    def _float_hint(v: Any) -> Optional[float]:
        if v is None:
            return None
        try:
            f = float(v)
            if f == f and abs(f) < 1e9:
                return f
        except (TypeError, ValueError):
            pass
        return None

    src = str(raw.get("source_platform") or fallback_platform or "unknown").strip() or "unknown"
    out: Dict[str, Any] = {
        "source_platform": src,
        "indicators": _str_list(raw.get("indicators")),
        "timeframe": str(raw.get("timeframe") or "").strip(),
        "entry_conditions": str(raw.get("entry_conditions") or "").strip(),
        "exit_conditions": str(raw.get("exit_conditions") or "").strip(),
        "stop_loss": str(raw.get("stop_loss") or "").strip(),
        "take_profit": str(raw.get("take_profit") or "").strip(),
        "assets": _str_list(raw.get("assets")),
        "raw_summary": str(raw.get("raw_summary") or "").strip(),
        "user_summary": str(raw.get("user_summary") or "").strip(),
    }
    raw_hints = raw.get("vigil_template_hints")
    if isinstance(raw_hints, dict):
        hints: Dict[str, float] = {}
        for key in ("rsi_len", "rsi_lower", "rsi_upper", "ema_len", "ema_fast", "ema_slow"):
            fv = _float_hint(raw_hints.get(key))
            if fv is not None:
                hints[key] = fv
        if hints:
            out["vigil_template_hints"] = hints
    return out


def build_strategy_profile_from_universal(us: Dict[str, Any]) -> Dict[str, Any]:
    """Merge universal strategy into the shape stored as agent strategy_profile."""
    base = normalize_strategy_json(us, fallback_platform=str(us.get("source_platform") or "unknown"))
    prof: Dict[str, Any] = {
        "universal_strategy": base,
        "profile_source": "universal_parser",
    }
    if base["assets"]:
        prof["preferred_assets"] = list(base["assets"])
    if base["entry_conditions"]:
        prof["entry_conditions"] = base["entry_conditions"]
    return prof
