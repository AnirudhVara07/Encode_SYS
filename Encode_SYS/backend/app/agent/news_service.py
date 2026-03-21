from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, List

import requests

from . import ws_bus
from .secrets_redact import redact_secrets_for_client

_lock = threading.Lock()
_cache: Dict[str, Any] = {
    "fetched_at": None,
    "articles": [],
    "error": None,
}


def refresh_news(*, limit: int = 20) -> Dict[str, Any]:
    key = os.getenv("NEWSAPI_API_KEY", "").strip()
    if not key:
        with _lock:
            _cache["error"] = "NEWSAPI_API_KEY not set"
            _cache["fetched_at"] = time.time()
            _cache["articles"] = []
        return snapshot_unlocked()

    articles: List[Dict[str, Any]] = []
    err: str | None = None
    try:
        r = requests.get(
            "https://newsapi.org/v2/top-headlines",
            params={"category": "business", "language": "en", "pageSize": limit, "apiKey": key},
            timeout=15,
        )
        data = r.json()
        if not r.ok:
            err = redact_secrets_for_client(str(data.get("message") or data))
        else:
            for a in data.get("articles") or []:
                articles.append(
                    {
                        "title": a.get("title") or "",
                        "description": (a.get("description") or "")[:300],
                        "url": a.get("url") or "",
                        "publishedAt": a.get("publishedAt") or "",
                        "source": (a.get("source") or {}).get("name") or "",
                    }
                )
    except Exception as e:
        err = redact_secrets_for_client(str(e))

    with _lock:
        _cache["fetched_at"] = time.time()
        _cache["articles"] = articles
        _cache["error"] = err
    try:
        ws_bus.broadcast({"event": "news_refresh", "data": {"count": len(articles), "error": err}})
    except Exception:
        pass
    return snapshot_unlocked()


def snapshot_unlocked() -> Dict[str, Any]:
    return {
        "fetched_at": _cache["fetched_at"],
        "articles": list(_cache["articles"]),
        "error": _cache["error"],
    }


def get_snapshot() -> Dict[str, Any]:
    with _lock:
        return snapshot_unlocked()


def get_headline_titles() -> List[str]:
    with _lock:
        return [str(a.get("title") or "") for a in _cache["articles"]]
