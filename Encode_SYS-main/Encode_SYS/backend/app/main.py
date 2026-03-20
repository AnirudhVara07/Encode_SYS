from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path

from .api.agent_routes import router as agent_root_router
from .api.routes import router as api_router
from .api.paper_routes import router as paper_router

app = FastAPI(title="Vigil Demo", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.include_router(paper_router, prefix="/api")
app.include_router(agent_root_router)

_STATIC_INDEX_PATH = (Path(__file__).resolve().parent / "static" / "index.html").resolve()


@app.get("/")
def index():
    # Serves the temporary demo UI.
    return FileResponse(str(_STATIC_INDEX_PATH))

