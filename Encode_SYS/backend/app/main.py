from typing import Optional

from . import env_bootstrap

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.agent_routes import router as agent_root_router
from .api.coinbase_live_routes import router as coinbase_live_router
from .api.paper_routes import router as paper_router
from .api.routes import get_marketaux_news, router as api_router
from .coinbase_live.runner import ensure_scheduler_started

app = FastAPI(title="Vigil Demo", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_DIR = (env_bootstrap.APP_DIR / "static").resolve()
_LEGACY_DEMO = (env_bootstrap.APP_DIR / "legacy_demo.html").resolve()
_STATIC_INDEX = (_STATIC_DIR / "index.html").resolve()
_ASSETS_DIR = _STATIC_DIR / "assets"
# Ensure mount is always registered after `npm run build`. If this dir was missing at
# first import, the old conditional mount never ran and /assets/* stayed 404 until restart.
_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(_ASSETS_DIR)), name="assets")

# Register on the app first so this route cannot be missing when api_router is stale/cached in a long-lived process.
app.add_api_route("/api/marketaux-news", get_marketaux_news, methods=["GET"])

app.include_router(api_router)
app.include_router(paper_router, prefix="/api")
app.include_router(coinbase_live_router, prefix="/api")
app.include_router(agent_root_router)

ensure_scheduler_started()


@app.get("/")
def index():
    if not _STATIC_INDEX.is_file():
        raise HTTPException(
            status_code=503,
            detail="SPA not built. Run `npm install && npm run build` in Encode_SYS/frontend (output: backend/app/static).",
        )
    return FileResponse(str(_STATIC_INDEX))


@app.get("/legacy-demo")
def legacy_demo():
    """Original single-file demo (paper portfolio, agent controls, Chart.js)."""
    if not _LEGACY_DEMO.is_file():
        raise HTTPException(status_code=404, detail="legacy_demo.html missing")
    return FileResponse(str(_LEGACY_DEMO))


def _is_reserved_backend_path(full_path: str) -> bool:
    """Paths that must not be served the SPA shell (API, assets, agent, OpenAPI)."""
    if full_path == "api" or full_path.startswith("api/"):
        return True
    if full_path == "assets" or full_path.startswith("assets/"):
        return True
    if full_path == "ws" or full_path.startswith("ws/"):
        return True
    if full_path == "docs" or full_path.startswith("docs/"):
        return True
    if full_path in ("redoc", "openapi.json"):
        return True
    root = full_path.split("/")[0]
    # Agent HTTP surface (single-segment GETs; POSTs use other routes)
    if root == "strategy" and (full_path == "strategy" or full_path.startswith("strategy/")):
        return True
    if root in {
        "status",
        "trades",
        "report",
        "news",
        "profile",
        "start",
        "stop",
        "unlock",
        "auth",
        "civic-oauth-config",
    }:
        if "/" not in full_path.rstrip("/"):
            return True
    return False


def _try_static_root_file(full_path: str) -> Optional[FileResponse]:
    """Serve files copied to static/ root by Vite (e.g. vigil-logo.png, favicon.ico, robots.txt)."""
    if not full_path or ".." in full_path.split("/"):
        return None
    root = _STATIC_DIR.resolve()
    try:
        target = (root / full_path).resolve()
        target.relative_to(root)
    except ValueError:
        return None
    if target.is_file():
        return FileResponse(str(target))
    return None


@app.api_route(
    "/{full_path:path}",
    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
)
def spa_history_fallback(full_path: str, request: Request):
    """
    React Router client routes (e.g. /demo). Registered after API routers; OpenAPI /docs etc. stay first.

    Must accept non-GET methods: otherwise Starlette matches this path pattern and returns 405 for POST /api/...
    when a stale process omitted newer API routers (confusing vs a clear 503).
    """
    if _is_reserved_backend_path(full_path):
        if full_path.startswith("api/"):
            if request.method in ("GET", "HEAD"):
                return JSONResponse(
                    status_code=503,
                    content={
                        "articles": [],
                        "meta": None,
                        "error": (
                            "This API path is not available on the running server (stale or mismatched backend build). "
                            "Stop and restart uvicorn from the current Vigil project (e.g. Encode_SYS/backend) so "
                            "routes such as GET /api/marketaux-news are registered."
                        ),
                    },
                )
            return JSONResponse(
                status_code=503,
                content={
                    "detail": (
                        "This API path is not handled by the running server (often a stale uvicorn after a code update). "
                        "Restart uvicorn from Encode_SYS/backend. For Coinbase, link the account with "
                        "POST /api/coinbase-live/link and a JSON body (api_key_id, api_key_secret, product_id)."
                    ),
                },
            )
        raise HTTPException(status_code=404, detail="Not found")
    if request.method not in ("GET", "HEAD"):
        raise HTTPException(status_code=404, detail="Not found")

    root_file = _try_static_root_file(full_path)
    if root_file is not None:
        return root_file
    if not _STATIC_INDEX.is_file():
        raise HTTPException(
            status_code=503,
            detail="SPA not built. Run `npm install && npm run build` in Encode_SYS/frontend.",
        )
    return FileResponse(str(_STATIC_INDEX))

