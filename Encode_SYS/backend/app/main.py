from fastapi import FastAPI
from fastapi.responses import FileResponse
from pathlib import Path

from .api.routes import router as api_router

app = FastAPI(title="Vigil Demo", version="0.1")
app.include_router(api_router)

_STATIC_INDEX_PATH = (Path(__file__).resolve().parent / "static" / "index.html").resolve()


@app.get("/")
def index():
    # Serves the temporary demo UI.
    return FileResponse(str(_STATIC_INDEX_PATH))

