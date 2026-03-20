# Vigil Demo (Trading Strategy Never Sleeps)

This repo contains a demo “learning loop” for PineScript strategies:

1. You upload a Vigil-compatible PineScript file (it must include template markers + required `input()` parameters).
2. The backend fetches BTC-USD candles, runs an internal backtest for a limited set of template evaluators, and grid-searches parameters to maximize `net_profit` under your risk boundaries.
3. It rewrites your PineScript by updating the default values inside those `input()` calls for the learned best configuration.
4. It returns an overnight performance report and a downloadable updated PineScript file.
5. If you provide a Coinbase sandbox JWT, it will also place a single next-step market IOC order based on the latest signal (otherwise it safely skips real order submission).

## Run the demo

### 1) Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2) (Optional) Enable Coinbase sandbox order submission

The sandbox order client uses a CDP API JWT. Set:

```bash
export COINBASE_BEARER_JWT="YOUR_JWT_HERE"
```

If you do not set this env var, the demo still runs the learning loop; execution will be returned as a mocked response.

### 3) Start the server

```bash
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/`.

## Use the UI

1. Upload your PineScript file.
2. Set:
   - `stop-loss percent` (e.g., `2.00` means 2%)
   - `fixed position size cap` in BTC (e.g., `0.01`)
3. Click **Run Overnight Learning**.
4. Wait for the report to appear.
5. Download the updated PineScript once completed.

## Pine template contract (required)

The demo does **not** parse arbitrary Pine strategy logic. It only:
1. Reads the template type from a marker comment.
2. Reads the numeric defaults from required `input()` parameters.
3. Runs an equivalent limited evaluator in Python for backtesting.
4. Rewrites the Pine by updating the `input()` defaults for the learned best parameters.

### 1) Required template marker

Include exactly one line:

```pinescript
// @vigil:template RSIThresholdReversion
```

Supported template types:

- `RSIThresholdReversion`
- `RSICrossTrendFilter`
- `EMACrossover`

### 2) Required `input()` parameters

The demo expects these parameter names to exist as `input()` calls (the demo extracts the *first numeric literal* in each `input()` call as the default):

#### RSIThresholdReversion
```pinescript
// @vigil:template RSIThresholdReversion
rsi_len   = input.int(14, "RSI Length")
rsi_lower = input.int(30, "RSI Lower")
rsi_upper = input.int(70, "RSI Upper")
```

#### RSICrossTrendFilter
```pinescript
// @vigil:template RSICrossTrendFilter
rsi_len   = input.int(14, "RSI Length")
rsi_lower = input.int(30, "RSI Lower")
rsi_upper = input.int(70, "RSI Upper")
ema_len   = input.int(50, "EMA Length")
```

#### EMACrossover
```pinescript
// @vigil:template EMACrossover
ema_fast = input.int(10, "Fast EMA")
ema_slow = input.int(30, "Slow EMA")
```

### 3) Optional optimizer search ranges

To override the demo optimizer ranges, add `@vigil:range` lines:

```pinescript
// @vigil:range rsi_len 5 30 1
// @vigil:range rsi_lower 20 45 1
// @vigil:range rsi_upper 55 80 1
```

Format:
`// @vigil:range <param_name> <min> <max> <step>`

## API endpoints

- `POST /api/upload` (multipart form: `pine`)
- `POST /api/run_learning` (form: `run_id`, `stop_loss_pct`, `btc_size`)
- `GET /api/report?run_id=...`
- `GET /api/download_pine?run_id=...`

## Implementation notes (demo scope)

- Only long-only behavior is simulated.
- Stop-loss exits are evaluated within each candle using the candle low vs the entry stop price.
- Fixed position size is enforced as `btc_size` per trade in the simulator.
- Order placement (sandbox) uses a single market IOC based on the latest signal.

