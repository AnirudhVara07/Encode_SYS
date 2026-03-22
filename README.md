# Vigil

**Your trading strategy never sleeps. Your guardrails never blink.**

Vigil is a full-stack trading intelligence demo: learn from Pine-style strategy templates, simulate risk in paper mode, automate with rule-based Vigil loops, and-when you're ready-trade for real on Coinbase behind Civic auth, with optional on-chain attestations so fills and commitments leave a public audit trail.

This is not a black-box "magic AI" that promises returns. It's a transparent pipeline: **backtest → report → paper → gated live execution**, with kill switches, execution gates, and session-scoped secrets kept where they belong—in `.env`, never in git.

## Why Vigil Hits Different

**Overnight Learning**  
Upload Vigil-compatible PineScript. The backend pulls BTC-GBP candles, runs template evaluators, grid-searches parameters, and hands you a report plus a downloadable Pine file with smarter defaults.

**Paper That Feels Real**  
Reset a balance, trade against live spot from Coinbase's public price API. In-memory—fast, honest, zero exchange risk.

**Vigil Automation**  
Multi-strategy signal voting on a timer. Same template logic as learning—not a random LLM trader.

**Agent + Civic**  
Sign in, get a Bearer session, hit `/start` / `/stop` / `/unlock`. WebSocket feed for fills, blocks, and status.

**Real Coinbase**  
Advanced Trade via CDP: per-user encrypted keys or org/preset keys from env. Turnstile optional human check before live fire.

**On-Chain Receipts (Optional)**  
Deploy `VigilFillAttestor`, set `VIGIL_FILL_ATTEST_*` in `.env`—explorer-visible attestation without moving settlement off Coinbase.

**Headlines + LLM Layer**  
MarketAux on the home page; OpenRouter for insights, strategy chat, and report suggestions—only when you configure keys.

## The Stack (No Fluff)

- **Backend**: FastAPI + Uvicorn · Python 3.10+
- **Frontend**: Vite + React + Tailwind/shadcn-style UI · Node 18+
- **Contracts**: Solidity (`Encode_SYS/contracts/`) for optional attestations
- **Scripts**: `Encode_SYS/scripts/ensure-backend.sh` — idempotent :8000 bring-up

## Quick Start

### 1. Clone and Enter the App Tree

```bash
cd Encode_SYS
```

If your folder is nested (e.g., `Vigil_0333/Encode_SYS`), `cd` there first.

### 2. Python Environment + Dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Secrets (Non-Negotiable for Full Features)

```bash
cp .env.example .env
# Edit .env — NEVER commit it
```

### 4. Frontend Dependencies + Production Build

```bash
cd ../frontend
npm install
npm run build
```

### 5. Launch

```bash
cd ../backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Or from `Encode_SYS`:

```bash
bash scripts/ensure-backend.sh
```

### 6. Dev Mode (Hot Reload)

**Terminal A**:
```bash
cd Encode_SYS/backend
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal B**:
```bash
cd Encode_SYS/frontend
npm run dev
```

Open `http://127.0.0.1:8080` (Vite proxies API to :8000). Register the matching Civic redirect (e.g., `http://localhost:8080/callback`).

## Routes & Features

| URL | What Happens |
|-----|--------------|
| `/` | Marketing home + headlines (when `MARKETAUX_API_TOKEN` is set) |
| `/demo` | Overnight learning + AI news angle (MarketAux + OpenRouter when configured) |
| `/dashboard` | Paper, backtest, Free vs Pro, gated live autonomous |
| `/real-trading` | Real spot flow after Civic (and optional Turnstile / CDP keys) |
| `/docs` | OpenAPI — every route, try-it-live |
| `/legacy-demo` | Classic all-in-one HTML |

## Documentation

- **Full terminal + API reference**: `Encode_SYS/README.md`
- **Frontend scripts**: `Encode_SYS/frontend/README.md`
- **Env template** (every variable explained): `Encode_SYS/backend/.env.example`

## Important Notes

- Paper state dies on restart—by design.
- Long-only demo assumptions in the simulator; leverage affects simulated P&L per README details.
- Rotate keys if `.env` ever leaked; keys are yours, not the repo's.

---

**Ship the loop. Own the risk. Keep the receipt.**
