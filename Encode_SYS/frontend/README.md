# Vigil frontend (Vite + React)

SPA for marketing, demo, dashboard, and real trading. The production build is emitted into **`../backend/app/static/`** and served by FastAPI at **`/`**.

## Commands

```bash
cd Encode_SYS/frontend
npm install
npm run dev      # http://127.0.0.1:8080 — proxies API to backend :8000
npm run build    # writes to backend/app/static/
npm run preview  # preview production build (separate from FastAPI)
npm test         # vitest
```

Full stack setup, env vars, and feature list: **[../README.md](../README.md)**.
