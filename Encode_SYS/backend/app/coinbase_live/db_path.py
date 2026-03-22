from __future__ import annotations

import os
from pathlib import Path

from ..env_bootstrap import BACKEND_ROOT

_DEFAULT_DB = BACKEND_ROOT / "data" / "coinbase_live.db"


def get_coinbase_live_db_path() -> Path:
    raw = (os.getenv("COINBASE_LIVE_DB_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _DEFAULT_DB.resolve()
