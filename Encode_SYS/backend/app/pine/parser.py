import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class RangeSpec:
    min_value: float
    max_value: float
    step: float


@dataclass(frozen=True)
class TemplateSpec:
    template_type: str
    # Parameter name -> default value extracted from Pine input() calls
    params: Dict[str, float]
    # Optional parameter search ranges. If missing for any param, the optimizer falls back
    # to built-in ranges.
    ranges: Dict[str, RangeSpec]


# Contract: allowed demo templates + the set of tunable Pine input parameter names each template expects.
TEMPLATE_CONTRACT: Dict[str, List[str]] = {
    "RSIThresholdReversion": ["rsi_len", "rsi_lower", "rsi_upper"],
    "RSICrossTrendFilter": ["rsi_len", "rsi_lower", "rsi_upper", "ema_len"],
    "EMACrossover": ["ema_fast", "ema_slow"],
}


_TEMPLATE_MARKER_RE = re.compile(r"^\s*//\s*@vigil:template\s+(?P<type>[A-Za-z0-9_]+)\s*$", re.MULTILINE)
_RANGE_MARKER_RE = re.compile(
    r"^\s*//\s*@vigil:range\s+(?P<name>[A-Za-z0-9_]+)\s+"
    r"(?P<min>-?\d+(?:\.\d+)?)\s+(?P<max>-?\d+(?:\.\d+)?)\s+(?P<step>-?\d+(?:\.\d+)?)\s*$",
    re.MULTILINE,
)


def _extract_template_type(pine: str) -> str:
    matches = _TEMPLATE_MARKER_RE.findall(pine)
    if not matches:
        raise ValueError(
            "Missing Vigil template marker line. Expected one line like: // @vigil:template RSIThresholdReversion"
        )
    if len(matches) > 1:
        raise ValueError("Multiple Vigil template marker lines found; demo expects exactly one.")
    return matches[0]


def _extract_ranges(pine: str) -> Dict[str, RangeSpec]:
    ranges: Dict[str, RangeSpec] = {}
    for m in _RANGE_MARKER_RE.finditer(pine):
        name = m.group("name")
        ranges[name] = RangeSpec(
            min_value=float(m.group("min")),
            max_value=float(m.group("max")),
            step=float(m.group("step")),
        )
    return ranges


def _extract_input_default(pine: str, param_name: str) -> float:
    """
    Extracts the first numeric literal inside the parameter's input() call.

    Examples matched:
      rsi_len = input.int(14, "RSI Length")
      rsi_lower = input(30, "RSI Lower")
    """
    # We allow optional whitespace/newlines after '=' and before the call.
    pattern = rf"{re.escape(param_name)}\s*=\s*input(?:\.\w+)?\(\s*([-+]?\d+(?:\.\d+)?)\s*[,)]"
    m = re.search(pattern, pine, flags=re.MULTILINE)
    if not m:
        raise ValueError(
            f"Missing Pine input() definition for required parameter `{param_name}`. "
            "Each required param must be declared as `<param>=input(..., ...)`."
        )
    return float(m.group(1))


def parse_vigil_template(pine_text: str, *, allowed_templates: Optional[Dict[str, List[str]]] = None) -> TemplateSpec:
    """
    Validates the uploaded PineScript and extracts tunable parameter defaults from input() calls.

    Note: this demo does not attempt to parse full Pine strategy logic. It relies on the template contract.
    """
    template_contract = allowed_templates or TEMPLATE_CONTRACT
    template_type = _extract_template_type(pine_text)
    if template_type not in template_contract:
        allowed = ", ".join(sorted(template_contract.keys()))
        raise ValueError(f"Unsupported Vigil template `{template_type}`. Allowed: {allowed}")

    required_params = template_contract[template_type]
    ranges = _extract_ranges(pine_text)

    params: Dict[str, float] = {}
    for param_name in required_params:
        params[param_name] = _extract_input_default(pine_text, param_name)

    return TemplateSpec(template_type=template_type, params=params, ranges=ranges)


def build_optimizer_param_grid(template_type: str, default_params: Dict[str, float], ranges: Dict[str, RangeSpec]) -> List[Dict[str, float]]:
    """
    Builds a discrete search grid (Cartesian product) based on either parsed @vigil:range markers
    or built-in fallback ranges.
    """
    # Fallback ranges tuned for a demo run. You can override per-param using // @vigil:range markers.
    fallback: Dict[str, Dict[str, RangeSpec]] = {
        "RSIThresholdReversion": {
            "rsi_len": RangeSpec(5, 30, 1),
            "rsi_lower": RangeSpec(20, 45, 1),
            "rsi_upper": RangeSpec(55, 80, 1),
        },
        "RSICrossTrendFilter": {
            "rsi_len": RangeSpec(5, 30, 1),
            "rsi_lower": RangeSpec(20, 45, 1),
            "rsi_upper": RangeSpec(55, 80, 1),
            "ema_len": RangeSpec(10, 80, 5),
        },
        "EMACrossover": {
            "ema_fast": RangeSpec(5, 50, 1),
            "ema_slow": RangeSpec(10, 120, 5),
        },
    }

    if template_type not in fallback:
        raise ValueError(f"No optimizer fallback ranges for template `{template_type}`")

    param_ranges: Dict[str, RangeSpec] = {}
    for p, v in fallback[template_type].items():
        param_ranges[p] = ranges.get(p, v)

    def values_for(r: RangeSpec) -> List[float]:
        if r.step <= 0:
            raise ValueError("Range step must be > 0")
        # Inclusive end: use floor to avoid floating drift.
        n = int((r.max_value - r.min_value) / r.step)
        return [round(r.min_value + i * r.step, 10) for i in range(n + 1)]

    # Apply basic sanity constraints for templates that must have ordering.
    if template_type == "EMACrossover":
        # ema_fast < ema_slow
        fast_vals = values_for(param_ranges["ema_fast"])
        slow_vals = values_for(param_ranges["ema_slow"])
        grid: List[Dict[str, float]] = []
        for f in fast_vals:
            for s in slow_vals:
                if f < s:
                    grid.append({"ema_fast": f, "ema_slow": s})
        return grid

    if template_type in {"RSIThresholdReversion", "RSICrossTrendFilter"}:
        grid = []
        rsi_len_vals = values_for(param_ranges["rsi_len"])
        rsi_lower_vals = values_for(param_ranges["rsi_lower"])
        rsi_upper_vals = values_for(param_ranges["rsi_upper"])

        for rsi_len in rsi_len_vals:
            for lo in rsi_lower_vals:
                for hi in rsi_upper_vals:
                    if lo < hi:
                        if template_type == "RSIThresholdReversion":
                            grid.append({"rsi_len": rsi_len, "rsi_lower": lo, "rsi_upper": hi})
                        else:
                            ema_len_vals = values_for(param_ranges["ema_len"])
                            for ema_len in ema_len_vals:
                                grid.append(
                                    {
                                        "rsi_len": rsi_len,
                                        "rsi_lower": lo,
                                        "rsi_upper": hi,
                                        "ema_len": ema_len,
                                    }
                                )
        return grid

    # Should be unreachable given earlier contract validation.
    raise ValueError(f"Unsupported template `{template_type}`")

