# Vigil (Encode_SYS)

Full-stack demo: **FastAPI** backend + **Vite/React** SPA. PineScript-style templates are learned and backtested; the UI adds **paper trading**, an **authenticated trading agent**, optional **Coinbase sandbox** orders, and **real Coinbase spot** flows behind Civic sign-in.

---

## Requirements

| Tool | Notes |
|------|--------|
| **Python 3.10+** | Backend |
| **Node.js 18+** | Frontend build / dev |
| **npm** | Comes with Node |

Use a virtualenv for Python (recommended):

```bash
cd Encode_SYS/backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

---

## Repository layout

```
Encode_SYS/
├── backend/           # FastAPI app (uvicorn app.main:app)
│   ├── .env.example   # Copy to .env — never commit .env
│   └── app/static/    # Populated by `npm run build` in frontend/
├── frontend/          # Vite + React (port 8080 in dev)
├── contracts/         # Optional on-chain attestation (Solidity)
├── scripts/           # ensure-backend.sh
└── demo/              # Sample PineScript strategies
```

---

## Configuration (secrets)

1. Copy the template:

   ```bash
   cd Encode_SYS/backend
   cp .env.example .env
   ```

2. Edit **`.env`** with your keys. Never commit this file.

| Area | Typical variables |
|------|-------------------|
| Civic login | `CIVIC_CLIENT_ID`, `CIVIC_CLIENT_SECRET`, `CIVIC_REDIRECT_URI` |
| Sessions | `SESSION_SIGNING_SECRET` |
| Headlines / news | `MARKETAUX_API_TOKEN`, optional `NEWSAPI_API_KEY` |
| LLM (insights, chat) | `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL` |
| Coinbase live | `COINBASE_PRESET_*` or org keys; optional `COINBASE_CREDENTIALS_FERNET_KEY` |
| Turnstile (live gates) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| On-chain attestations | `VIGIL_FILL_ATTEST_*` (see `.env.example`) |

Confirm Git is ignoring secrets:

```bash
cd Encode_SYS/backend && git check-ignore -v .env
```

---

## Install frontend dependencies

```bash
cd Encode_SYS/frontend
npm install
```

---

## How to run (terminal)

Paths below assume your shell is at the **`Encode_SYS`** folder (the one that contains `backend/` and `frontend/`). If your clone has an extra parent directory (e.g. `Vigil_0333/Encode_SYS`), `cd` into `Encode_SYS` first.

### Option A — Production-style (built UI served by FastAPI)

Build the SPA into `backend/app/static/`, then start uvicorn:

```bash
cd Encode_SYS/frontend
npm run build

cd ../backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/**

### Option B — Idempotent backend script

From **inside `Encode_SYS`**:

```bash
bash scripts/ensure-backend.sh
```

Starts uvicorn on `127.0.0.1:8000` if nothing is listening; restarts if the process is stale (e.g. new routes return 404 after a pull). Logs: **`.logs/uvicorn.log`** (under `Encode_SYS`).

If your project root is **above** `Encode_SYS` (monorepo style):

```bash
bash Encode_SYS/scripts/ensure-backend.sh
```

### Option C — Frontend hot reload + API (two terminals)

**Terminal 1 — backend**

```bash
cd Encode_SYS/backend
source .venv/bin/activate   # if you use a venv
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Vite**

```bash
cd Encode_SYS/frontend
npm run dev
```

Open **http://127.0.0.1:8080/** — Vite proxies `/api`, `/auth`, `/status`, `/ws`, and related paths to **http://127.0.0.1:8000** (see `frontend/vite.config.ts`).

**Civic redirect:** register the URL you actually use (e.g. `http://localhost:8080/callback` for Vite, or `http://127.0.0.1:8000/callback` when using the FastAPI-served bundle).

### Optional: Coinbase sandbox IOC (overnight learning)

```bash
export COINBASE_BEARER_JWT="YOUR_JWT_HERE"
```

Without it, the learning loop still runs; sandbox execution is mocked.

### API explorer

With the backend up: **http://127.0.0.1:8000/docs** (OpenAPI / Swagger).

---

## Main URLs (built UI on port 8000)

| URL | What |
|-----|------|
| `/` | Marketing home + MarketAux headlines (token in `.env`) |
| `/demo` | Overnight learning demo + AI news summary (MarketAux + OpenRouter when configured) |
| `/dashboard` | Paper portfolio, backtest, Free vs Pro, gated live autonomous |
| `/real-trading` | Real Coinbase spot (Civic + optional Turnstile; CDP keys per user or org preset) |
| `/legacy-demo` | Legacy HTML demo |

---

## Features (overview)

1. **Overnight learning** — Upload Vigil-compatible PineScript; backend fetches BTC-GBP candles, backtests template evaluators, grid-searches parameters, returns a report and downloadable Pine with updated `input()` defaults.
2. **Paper simulation** — Fake balance, live **public** spot from Coinbase (`BTC-GBP`); in-memory only (resets on server restart). Manual buy/sell + optional **Vigil** rule automation (`/api/paper/autopilot/*`).
3. **Trading agent** — Civic `POST /auth`, Bearer sessions, `/start` / `/stop` / `/unlock`, kill switch, `/ws/feed`, execution gate on trades, optional NewsAPI cache and OpenRouter suggestions on `/report`.
4. **Coinbase sandbox** — Optional single IOC from latest signal when `COINBASE_BEARER_JWT` is set.
5. **Real Coinbase** — Advanced Trade via CDP SDK; per-user encrypted keys in SQLite or shared org/preset keys; optional **FillAttestor** contract events for audit (see `.env.example` and `contracts/`).

---

## Using the overnight learning UI

1. Upload a Pine file that follows the **template contract** below.
2. Set stop-loss %, BTC size, and optional leverage.
3. Run **Overnight Learning**; wait for the report; download updated Pine.

Sample files: `demo/sample_vigil_strategy.txt`, `demo/neon_undertow_vigil.txt`, `demo/high_gear_pulse_vigil.txt`.

---

## Pine template contract (required)

The demo does **not** execute arbitrary Pine. It reads a template marker, numeric `input()` defaults, runs a **Python equivalent** backtest, and rewrites those defaults.

### Template marker (exactly one line)

```pinescript
// @vigil:template RSIThresholdReversion
```

**Supported types:** `RSIThresholdReversion`, `RSICrossTrendFilter`, `EMACrossover`.

### Required `input()` parameters

**RSIThresholdReversion**

```pinescript
// @vigil:template RSIThresholdReversion
rsi_len   = input.int(14, "RSI Length")
rsi_lower = input.int(30, "RSI Lower")
rsi_upper = input.int(70, "RSI Upper")
```

**RSICrossTrendFilter** — same three RSI params plus `ema_len = input.int(50, "EMA Length")`.

**EMACrossover**

```pinescript
// @vigil:template EMACrossover
ema_fast = input.int(10, "Fast EMA")
ema_slow = input.int(30, "Slow EMA")
```

### Optional optimizer ranges

```pinescript
// @vigil:range rsi_len 5 30 1
```

Format: `// @vigil:range <param> <min> <max> <step>`

---

## Paper trading API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/paper/reset` | Start session (optional `starting_usd`) |
| GET | `/api/paper/status` | Balances, fills, equity curve |
| GET | `/api/paper/quote` | Refresh spot, extend equity |
| POST | `/api/paper/trade` | `buy` + `usd` or `sell` + `btc` |
| GET/PUT | `/api/paper/autopilot` / `.../config` | Vigil automation config |
| POST | `/api/paper/autopilot/start` / `stop` | Automation loop |

Spot: `https://api.coinbase.com/v2/prices/BTC-GBP/spot` (no key).

**Vigil automation:** multi-strategy vote on signal edges; shared pool; stop before changing config (409 while running).

---

## Learning loop API

| Method | Path |
|--------|------|
| POST | `/api/upload` (multipart `pine`) |
| POST | `/api/run_learning` |
| GET | `/api/report?run_id=...` |
| GET | `/api/download_pine?run_id=...` |

---

## Agent API (Bearer auth)

After `POST /auth` (Civic code exchange), send `Authorization: Bearer <access_token>`.

| Path | Role |
|------|------|
| `GET /status` | Autonomous, kill switch, flags, news summary |
| `POST /start` | Start autonomous + paper Vigil; optional live mode (Pro / gates) |
| `POST /stop` | Global kill switch; blocks paper trades until cleared |
| `POST /unlock` | Clear kill switch only |
| `GET /trades` | Ledger + blocked attempts |
| `GET /report` | P&amp;L; OpenRouter suggestions when autonomous off + profile |
| `POST /strategy` | Trades or strategy profile |
| `GET /news` | Cached headlines |
| `GET /api/marketaux-news` | Public headline proxy; `insights=1` uses OpenRouter |
| WS | `/ws/feed?token=<Bearer>` — `fill`, `blocked`, `status`, `news_refresh` |

**Execution gate:** Failing rules record **blocked** and skip execution (`400` on `/api/paper/trade` with `Trade blocked (...)`).

Strategy chat: `POST /api/strategy-chat` (same OpenRouter env as `/report`).

---

## Real Coinbase trading

- **Per-user:** paste CDP API key in UI; server encrypts with `COINBASE_CREDENTIALS_FERNET_KEY` → SQLite.
- **Shared:** `COINBASE_PRESET_*` or `COINBASE_ORG_*` in `.env` (see `.env.example`).
- **On-chain:** optional `VIGIL_FILL_ATTEST_*` for explorer-visible attestation txs (settlement remains on Coinbase).

---

## Implementation notes (demo scope)

- Long-only simulation; stop-loss uses candle low vs entry.
- Simulated P&amp;L uses exposure `btc_size × leverage`; sandbox IOC uses `btc_size` only.
- Paper portfolio is one global in-memory state per process.

---

## Editor integration

VS Code / Cursor: task **“Vigil: ensure backend”** runs `Encode_SYS/scripts/ensure-backend.sh` from the workspace folder (adjust if your workspace root differs).
