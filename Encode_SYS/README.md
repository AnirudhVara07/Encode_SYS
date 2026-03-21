# Vigil Demo (Trading Strategy Never Sleeps)

This repo contains a demo “learning loop” for PineScript strategies:

1. You upload a Vigil-compatible PineScript file (it must include template markers + required `input()` parameters).
2. The backend fetches BTC-USD candles, runs an internal backtest for a limited set of template evaluators, and grid-searches parameters to maximize `net_profit` under your risk boundaries.
3. It rewrites your PineScript by updating the default values inside those `input()` calls for the learned best configuration.
4. It returns an overnight performance report and a downloadable updated PineScript file.
5. If you provide a Coinbase sandbox JWT, it will also place a single next-step market IOC order based on the latest signal (otherwise it safely skips real order submission).
6. **Paper live simulation** (second card in the UI): reset a fake USD balance, then buy/sell BTC at **live** prices from Coinbase’s public `v2/prices/BTC-USD/spot` API. State is **in-memory** on the server (lost on restart); it does **not** place real or sandbox orders.

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

### Optional: MarketAux headlines on the home page

The marketing site (`/`) loads a **Current headlines** section from `GET /api/marketaux-news`, which proxies [MarketAux](https://www.marketaux.com/) with the token kept on the server. Requests default to **financial-asset and macro-relevant** articles: `entity_types` include equity, index, ETF, mutual fund, cryptocurrency, and currency, with `must_have_entities=true` so items have tagged market entities. Override types with env `MARKETAUX_ENTITY_TYPES` (comma-separated) if needed. Set `MARKETAUX_API_TOKEN` in `backend/.env` (see `backend/.env.example`). If it is unset, that section shows a short configuration message instead of articles.

### 3) Build the marketing + demo UI (Vite → FastAPI `static/`)

From the repo root:

```bash
cd frontend
npm install
npm run build
```

This writes `backend/app/static/` (`index.html` + `assets/`). The Python app serves that bundle at `/`.

### 4) Start the server

**One-liner (idempotent):** from the repo root (`Encode_SYS-main`). Starts the backend if port 8000 is down; if `GET /` works but `GET /api/marketaux-news` returns **404**, it **restarts** uvicorn so new API routes load after a `git pull`.

```bash
bash Encode_SYS/scripts/ensure-backend.sh
```

**Manual:**

```bash
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open `http://127.0.0.1:8000/` (marketing site). **Live overnight-learning demo:** `http://127.0.0.1:8000/demo` — below live spot prices, an **AI news summary** pulls the same filtered MarketAux feed (`insights=1`) with macro and asset **checklists** (LLM via **OpenRouter**; requires API keys for MarketAux + `OPENROUTER_API_KEY` in `backend/.env`, optional `OPENROUTER_MODEL`). **Paper / live / backtest dashboard:** `http://127.0.0.1:8000/dashboard` — simulated **10,000 USDC** paper portfolio, **7-day backtest** replay, **Free vs Pro** (`PATCH /profile` with `is_pro`), live autonomous gated behind Pro (`POST /start` with `execution_mode: live` returns `403` + `upgrade_required` for free). Live fills use an **AgentKit stub** (`agent/live_wallet.py`) until a real wallet is wired. Logs when using the script: `Encode_SYS/.logs/uvicorn.log`.

In Cursor/VS Code: run task **“Vigil: ensure backend”** (`.vscode/tasks.json`).

**Dev with hot reload (optional):** terminal A: `uvicorn app.main:app --reload --port 8000`. Terminal B: `cd frontend && npm run dev` (port 8080). The Vite dev server proxies `/api` and agent routes to `8000`.

**Legacy all-in-one HTML** (paper portfolio, agent panel, Chart.js): `http://localhost:8000/legacy-demo`

## Use the UI

1. Upload your PineScript file.
2. Set:
   - `stop-loss percent` (e.g., `2.00` means 2%)
   - `position size` in BTC (e.g., `0.01`)
   - `leverage` (default `1`): multiplies simulated P&L as `btc_size × leverage` exposure; sandbox orders still use `btc_size` only
3. Click **Run Overnight Learning**.
4. Wait for the report to appear.
5. Download the updated PineScript once completed.

Sample strategies in `demo/`: `sample_vigil_strategy.txt`, `neon_undertow_vigil.txt`, and **`high_gear_pulse_vigil.txt`** (EMA crossover + notes on using the **Leverage** field in the UI).

### Paper live simulation (UI + API)

- Click **Start / reset portfolio**, then **Buy BTC** (spend USD) or **Sell BTC** (size in BTC). **Refresh quote** pulls a new spot price and appends a mark-to-market equity point.
- Auto-refresh every 10s while the session is active (same as **Refresh quote**).
- **Limitations:** one global portfolio per server process; no persistence; not connected to Coinbase login or sandbox trading.

#### Vigil (rule-based paper automation, multi-strategy)

The **Vigil** block in the paper card drives the **same** template signal logic as overnight learning (`compute_latest_execution_signal` on hourly candles from Coinbase sandbox, with synthetic fallback if the network fails). It is **not** an LLM or discretionary “AI”—just the built-in Vigil evaluators.

- **Manual Buy/Sell still work**; Vigil adds extra `market_order` calls on a timer.
- **Multiple strategies:** configure a list of rows (template type + JSON params, e.g. paste values from the optimizer). Each tick, for each **enabled** strategy, the server compares the latest bar signal to the previous tick:
  - A **buy edge** counts when a strategy’s reading becomes **BUY** (it was not BUY before).
  - A **sell edge** counts when it becomes **SELL** (it was not SELL before).
- **Vote:** if buy edges > sell edges, Vigil executes **one** buy for **Vigil buy (USD)**. If sell edges > buy edges, it sells **Vigil sell fraction** of the current BTC balance (one consolidated sell). Ties → no trade.
- **Shared pool:** all strategies share the same paper cash/BTC; there are no per-strategy sub-accounts.
- **Stop Vigil before** changing config (`PUT` returns 409 while running).
- Start the paper portfolio (**Start / reset**) before **Start Vigil**, or start will error.

Signals align with **closed hourly** candles; use an interval ≥ 60s (meaningful changes usually appear when a new hour bar is available).

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
- `POST /api/run_learning` (form: `run_id`, `stop_loss_pct`, `btc_size`, optional `leverage` default `1.0`)
- `GET /api/report?run_id=...`
- `GET /api/download_pine?run_id=...`

**Paper simulation**

- `POST /api/paper/reset` — JSON body optional `{ "starting_usd": 100000 }` (default `100000`)
- `GET /api/paper/status` — balances, last spot, fills (recent), `equity_curve` snapshots
- `GET /api/paper/quote` — fetch new spot, extend equity curve (requires started session)
- `POST /api/paper/trade` — JSON `{ "side": "buy", "usd": 1000 }` or `{ "side": "sell", "btc": 0.01 }`

**Vigil paper automation** (API paths remain `/api/paper/autopilot/...`)

- `GET /api/paper/autopilot` — running flag, interval, lookback, buy/sell settings, strategies (with `last_signal`), recent log, last tick / data source / error
- `PUT /api/paper/autopilot/config` — JSON `{ "interval_sec": 300, "lookback_hours": 168, "buy_usd": 1000, "sell_fraction": 0.25, "strategies": [ { "id": "optional", "name": "...", "template_type": "RSIThresholdReversion", "enabled": true, "params": { "rsi_len": 14, "rsi_lower": 30, "rsi_upper": 70 } } ] }` (409 while Vigil is running)
- `POST /api/paper/autopilot/start` — begin background loop (requires started paper session and ≥1 enabled strategy)
- `POST /api/paper/autopilot/stop` — stop the loop

Spot prices: `https://api.coinbase.com/v2/prices/BTC-USD/spot` (no API key).

### Trading agent (root paths, Bearer auth)

All routes below except `POST /auth` require `Authorization: Bearer <access_token>` where `<access_token>` is returned from `POST /auth` after exchanging a Civic authorization code.

- `POST /auth` — JSON `{ "code": "<civic_code>", "redirect_uri": "<same as Civic app>" }` (or omit `redirect_uri` and set `CIVIC_REDIRECT_URI`). Returns `{ "access_token", "token_type", "expires_in" }`.
- `GET /status` — `autonomous`, `kill_switch`, paper/Vigil automation flags, news cache summary, rule list, trade counts.
- `POST /start` — JSON `{ "reset_paper": false, "starting_usd": 100000 }`; clears kill switch, sets autonomous, ensures paper is started, starts Vigil (`/api/paper/autopilot`). Refreshes news cache (if `NEWSAPI_API_KEY` is set).
- `POST /stop` — **Global kill switch** ON, autonomous OFF, Vigil automation stopped. **All** paper trades (manual and automated) are blocked until the kill switch is cleared.
- `POST /unlock` — Bearer auth only; clears kill switch **without** starting Vigil (resume manual paper trading after an emergency stop).
- `GET /trades` — Merged executed ledger + blocked attempts (sorted by time).
- `GET /report` — Realized P&amp;L stats (FIFO on BTC sells), autonomous trade list, recent blocked; when **autonomous is off** and a **strategy profile** exists, calls **OpenRouter** for 2–3 improvement suggestions (configure `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL` — see `backend/.env.example`).
- `POST /strategy` — JSON `{ "trades": [ { "asset", "entry_price", "exit_price", "entry_ts", "exit_ts" } ] }` **or** `{ "profile": { ... } }` to store a user strategy profile.
- `GET /news` — Cached headlines; `GET /news?refresh=true` refetches NewsAPI.
- `GET /api/marketaux-news` — Public MarketAux proxy for the marketing home page (`MARKETAUX_API_TOKEN`). Query: `limit` (1–20), optional `symbols`, optional `insights=1` to add `strategy_insights` (summary + bullet considerations from current headlines via OpenRouter; requires `OPENROUTER_API_KEY` per `backend/.env.example`).
- `WebSocket` `GET /ws/feed?token=<same Bearer access_token>` — JSON events: `fill`, `blocked`, `status`, `news_refresh`.

**Execution gate:** Every `market_order` (manual or Vigil-driven) runs through the agent rules. Failed checks append a **blocked** record and skip execution (HTTP 400 on `/api/paper/trade` with message `Trade blocked (...)`).

Copy [`backend/.env.example`](backend/.env.example) and export variables (no secrets in the repo). Strategy chat (`POST /api/strategy-chat`) uses the same OpenRouter configuration (`OPENROUTER_API_KEY`) as `/report` suggestions.

**UI:** The first card after “Overnight Learning” includes Civic code exchange, bearer token storage, Start/Stop, status/report/news, and optional WebSocket.

## Implementation notes (demo scope)

- Only long-only behavior is simulated.
- Stop-loss exits are evaluated within each candle using the candle low vs the entry stop price.
- Position size in the simulator uses effective exposure `btc_size * leverage` for USD P&L; stop-loss % is still from entry price.
- Order placement (sandbox) uses a single market IOC based on the latest signal.

