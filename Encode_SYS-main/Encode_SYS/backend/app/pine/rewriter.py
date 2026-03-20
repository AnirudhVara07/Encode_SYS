import re
from dataclasses import dataclass
from typing import Dict, Tuple

from .parser import TEMPLATE_CONTRACT


def _format_number(value: float) -> str:
    # Keep output stable and Pine-friendly.
    if abs(value - int(value)) < 1e-9:
        return str(int(value))
    s = f"{value:.10f}".rstrip("0").rstrip(".")
    return s


@dataclass(frozen=True)
class RewriteResult:
    updated_pine: str
    updated_params: Dict[str, float]


class PineRewriter:
    """
    Limited Pine rewriter for the demo:
      - Updates only the default numeric literal inside each required `input()` call.
      - Does not attempt to rewrite strategy logic.
    """

    def rewrite_inputs(
        self,
        *,
        pine_text: str,
        template_type: str,
        new_params: Dict[str, float],
    ) -> RewriteResult:
        if template_type not in TEMPLATE_CONTRACT:
            raise ValueError(f"Unsupported template_type: {template_type}")

        required_params = TEMPLATE_CONTRACT[template_type]
        missing = [p for p in required_params if p not in new_params]
        if missing:
            raise ValueError(f"Missing required params for template `{template_type}`: {missing}")

        updated_text = pine_text
        updated_params: Dict[str, float] = {}

        for param_name in required_params:
            default_value = float(new_params[param_name])
            formatted = _format_number(default_value)

            # Example match to replace only the default literal:
            #   rsi_len = input.int(14, "RSI Length")
            # or:
            #   rsi_lower = input(30, "RSI Lower")
            pattern = re.compile(
                rf"({re.escape(param_name)}\s*=\s*input(?:\.\w+)?\(\s*)"
                rf"([-+]?\d+(?:\.\d+)?)"
                rf"(\s*[,)] )",
                re.DOTALL,
            )

            # The trailing capture `(\s*[,)] )` is too strict due to whitespace.
            # Use a more forgiving approach: match up to comma or closing paren, then rebuild.
            pattern = re.compile(
                rf"({re.escape(param_name)}\s*=\s*input(?:\.\w+)?\(\s*)"
                rf"([-+]?\d+(?:\.\d+)?)"
                rf"(\s*[,)])",
                re.DOTALL,
            )

            def repl(m: re.Match) -> str:
                prefix = m.group(1)
                suffix = m.group(3)
                return prefix + formatted + suffix

            updated_text, n = pattern.subn(repl, updated_text, count=1)
            if n != 1:
                raise ValueError(
                    f"Could not update input default for param `{param_name}` in uploaded Pine. "
                    "Ensure it declares the parameter as `<param>=input(...)`."
                )

            updated_params[param_name] = default_value

        return RewriteResult(updated_pine=updated_text, updated_params=updated_params)

