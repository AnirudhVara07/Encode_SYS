#!/usr/bin/env bash
# Idempotent: start Vigil FastAPI on 127.0.0.1:8000 if needed.
# If something is already listening on :8000 but GET /api/marketaux-news returns 404,
# or OpenAPI has no coinbase-live routes (stale process; POST /api/* looked like 405),
# treat it as a stale uvicorn and restart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENCODE_SYS="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$ENCODE_SYS/backend"
URL="http://127.0.0.1:8000/"
NEWS_URL="http://127.0.0.1:8000/api/marketaux-news?limit=1"
OPENAPI_URL="http://127.0.0.1:8000/openapi.json"
LOG_DIR="$ENCODE_SYS/.logs"
PID_FILE="$LOG_DIR/uvicorn.pid"
LOG_FILE="$LOG_DIR/uvicorn.log"

mkdir -p "$LOG_DIR"

stop_uvicorn_on_8000() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  sleep 0.3
  if command -v lsof >/dev/null 2>&1; then
    for p in $(lsof -ti :8000 2>/dev/null || true); do
      kill "$p" 2>/dev/null || true
    done
  fi
  sleep 0.4
}

need_start=false
if ! curl -sf --connect-timeout 1 -o /dev/null "$URL"; then
  need_start=true
else
  code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$NEWS_URL" 2>/dev/null || echo "000")
  if [ "$code" = "404" ]; then
    echo "Vigil: GET /api/marketaux-news returned 404 (stale uvicorn after a code update). Restarting backend on port 8000..." >&2
    stop_uvicorn_on_8000
    need_start=true
  elif ! curl -sf --connect-timeout 3 "$OPENAPI_URL" 2>/dev/null | grep -q "coinbase-live"; then
    echo "Vigil: OpenAPI missing coinbase-live routes (stale uvicorn; POST /api/* was returning 405). Restarting backend on port 8000..." >&2
    stop_uvicorn_on_8000
    need_start=true
  fi
fi

if [ "$need_start" = false ]; then
  echo "Vigil backend already up: $URL"
  exit 0
fi

cd "$BACKEND"
nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for _ in $(seq 1 25); do
  if curl -sf --connect-timeout 1 -o /dev/null "$URL"; then
    ncode=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$NEWS_URL" 2>/dev/null || echo "000")
    if [ "$ncode" = "404" ]; then
      echo "Vigil: port 8000 answered / but GET /api/marketaux-news still returns 404 — check $LOG_FILE and app.main (get_marketaux_news)." >&2
      exit 1
    fi
    if ! curl -sf --connect-timeout 3 "$OPENAPI_URL" 2>/dev/null | grep -q "coinbase-live"; then
      echo "Vigil: port 8000 answered / but OpenAPI still has no coinbase-live routes — check $LOG_FILE and app.main." >&2
      exit 1
    fi
    if [ "$ncode" != "000" ]; then
      echo "Started Vigil backend: $URL (log: $LOG_FILE)"
      exit 0
    fi
  fi
  sleep 0.2
done

echo "Could not confirm backend on $URL — see $LOG_FILE" >&2
exit 1
