# Vigil_0333

Monorepo layout: application code lives under **`Encode_SYS/`** (FastAPI backend, Vite frontend, contracts, scripts).

## Documentation

- **Run, features, and API overview:** [Encode_SYS/README.md](Encode_SYS/README.md)
- **Frontend (Vite):** [Encode_SYS/frontend/README.md](Encode_SYS/frontend/README.md)

## Secrets and API keys

- **Never commit** real API keys, JWT signing secrets, Coinbase credentials, or wallet private keys.
- Copy **`Encode_SYS/backend/.env.example`** to **`Encode_SYS/backend/.env`** and fill values locally. That file is listed in `.gitignore` and must stay out of version control.
- Before pushing, confirm: `git check-ignore -v Encode_SYS/backend/.env` should report that the path is ignored.
- If any secret was ever committed or shared, **revoke and rotate** it at the provider (OpenRouter, MarketAux, Civic, Coinbase, etc.) and update only your local `.env`.

## Quick start

From the repo root:

```bash
bash Encode_SYS/scripts/ensure-backend.sh
```

Then open `http://127.0.0.1:8000/` (see Encode_SYS README for full setup).
