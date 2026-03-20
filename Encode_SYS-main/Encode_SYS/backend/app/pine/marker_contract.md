## Vigil Pine Template Markers (Demo Contract)

The demo does **not** parse full Pine strategy logic. Instead, it relies on a small contract so it can:

1. Identify which template evaluator to run.
2. Extract tunable parameter defaults from `input()` calls.
3. Rewrite the strategy by updating those `input()` defaults for the learned best configuration.

### 1) Required Template Marker

Include exactly one line like:

```pinescript
// @vigil:template RSIThresholdReversion
```

Supported demo templates:

```text
RSIThresholdReversion
RSICrossTrendFilter
EMACrossover
```

### 2) Required Parameter Inputs

For each template, the Pine must declare the following `input()` parameters (names must match exactly):

```text
RSIThresholdReversion: rsi_len, rsi_lower, rsi_upper
RSICrossTrendFilter:   rsi_len, rsi_lower, rsi_upper, ema_len
EMACrossover:          ema_fast, ema_slow
```

Example (Pine):

```pinescript
rsi_len   = input.int(14, "RSI Length")
rsi_lower = input.int(30, "RSI Lower")
rsi_upper = input.int(70, "RSI Upper")
```

The demo extracts the *first numeric literal* inside the `input(...)` call as the default.

### 3) Optional Search Ranges

To override optimizer ranges, add `@vigil:range` lines:

```pinescript
// @vigil:range rsi_len 5 30 1
// @vigil:range rsi_lower 20 45 1
// @vigil:range rsi_upper 55 80 1
```

Format:
`// @vigil:range <param_name> <min> <max> <step>`

