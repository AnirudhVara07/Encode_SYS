from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .crypto_util import decrypt_secret, encrypt_secret
from .db_path import get_coinbase_live_db_path

_lock = threading.Lock()


def _migrate_autopilot_drop_foreign_key(conn: sqlite3.Connection) -> None:
    """Org mode needs autopilot rows without a coinbase_credentials parent; drop legacy FK if present."""
    try:
        rows = conn.execute("PRAGMA foreign_key_list(coinbase_live_autopilot)").fetchall()
    except sqlite3.OperationalError:
        return
    if not rows:
        return
    conn.execute(
        """
        CREATE TABLE coinbase_live_autopilot_mig (
            civic_sub TEXT PRIMARY KEY,
            interval_sec REAL NOT NULL DEFAULT 60,
            lookback_hours INTEGER NOT NULL DEFAULT 168,
            buy_usd REAL NOT NULL DEFAULT 1000,
            sell_fraction REAL NOT NULL DEFAULT 0.25,
            running INTEGER NOT NULL DEFAULT 0,
            strategies_json TEXT NOT NULL DEFAULT '[]',
            updated_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO coinbase_live_autopilot_mig
            (civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, running, strategies_json, updated_at)
        SELECT civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, running, strategies_json, updated_at
        FROM coinbase_live_autopilot
        """
    )
    conn.execute("DROP TABLE coinbase_live_autopilot")
    conn.execute("ALTER TABLE coinbase_live_autopilot_mig RENAME TO coinbase_live_autopilot")


def _connect() -> sqlite3.Connection:
    path = get_coinbase_live_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema() -> None:
    with _lock:
        conn = _connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS coinbase_credentials (
                    civic_sub TEXT PRIMARY KEY,
                    api_key_id TEXT NOT NULL,
                    secret_ciphertext BLOB NOT NULL,
                    product_id TEXT NOT NULL DEFAULT 'BTC-GBP',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS coinbase_live_autopilot (
                    civic_sub TEXT PRIMARY KEY,
                    interval_sec REAL NOT NULL DEFAULT 60,
                    lookback_hours INTEGER NOT NULL DEFAULT 168,
                    buy_usd REAL NOT NULL DEFAULT 1000,
                    sell_fraction REAL NOT NULL DEFAULT 0.25,
                    running INTEGER NOT NULL DEFAULT 0,
                    strategies_json TEXT NOT NULL DEFAULT '[]',
                    updated_at REAL NOT NULL
                );
                """
            )
            _migrate_autopilot_drop_foreign_key(conn)
            conn.commit()
        finally:
            conn.close()


@dataclass
class LinkedCredentials:
    civic_sub: str
    api_key_id: str
    api_key_secret: str
    product_id: str


def upsert_credentials(*, civic_sub: str, api_key_id: str, api_key_secret: str, product_id: str) -> None:
    now = time.time()
    pid = (product_id or "BTC-GBP").strip() or "BTC-GBP"
    blob = encrypt_secret(api_key_secret)
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO coinbase_credentials (civic_sub, api_key_id, secret_ciphertext, product_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(civic_sub) DO UPDATE SET
                    api_key_id = excluded.api_key_id,
                    secret_ciphertext = excluded.secret_ciphertext,
                    product_id = excluded.product_id,
                    updated_at = excluded.updated_at
                """,
                (civic_sub, api_key_id.strip(), blob, pid, now, now),
            )
            conn.execute(
                """
                INSERT INTO coinbase_live_autopilot
                    (civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, running, strategies_json, updated_at)
                VALUES (?, 60, 168, 1000, 0.25, 0, '[]', ?)
                ON CONFLICT(civic_sub) DO NOTHING
                """,
                (civic_sub, now),
            )
            conn.commit()
        finally:
            conn.close()


def delete_autopilot_row_only(civic_sub: str) -> None:
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM coinbase_live_autopilot WHERE civic_sub = ?", (civic_sub,))
            conn.commit()
        finally:
            conn.close()


def update_linked_product_id(*, civic_sub: str, product_id: str) -> bool:
    """Update trading pair for SQLite-linked credentials only (not preset/org env)."""
    pid = (product_id or "BTC-GBP").strip() or "BTC-GBP"
    now = time.time()
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "UPDATE coinbase_credentials SET product_id = ?, updated_at = ? WHERE civic_sub = ?",
                (pid, now, civic_sub),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def delete_credentials(civic_sub: str) -> bool:
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM coinbase_live_autopilot WHERE civic_sub = ?", (civic_sub,))
            cur = conn.execute("DELETE FROM coinbase_credentials WHERE civic_sub = ?", (civic_sub,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def get_linked_meta(civic_sub: str) -> Optional[Dict[str, Any]]:
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT api_key_id, product_id, created_at, updated_at FROM coinbase_credentials WHERE civic_sub = ?",
                (civic_sub,),
            ).fetchone()
            if not row:
                return None
            return {
                "api_key_id": row["api_key_id"],
                "product_id": row["product_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        finally:
            conn.close()


def load_credentials(civic_sub: str) -> Optional[LinkedCredentials]:
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT api_key_id, secret_ciphertext, product_id FROM coinbase_credentials WHERE civic_sub = ?",
                (civic_sub,),
            ).fetchone()
            if not row:
                return None
            secret = decrypt_secret(row["secret_ciphertext"])
            return LinkedCredentials(
                civic_sub=civic_sub,
                api_key_id=str(row["api_key_id"]),
                api_key_secret=secret,
                product_id=str(row["product_id"] or "BTC-GBP"),
            )
        finally:
            conn.close()


def _default_strategies() -> List[Dict[str, Any]]:
    return [
        {
            "id": "demo-rsi",
            "name": "RSI reversion",
            "template_type": "RSIThresholdReversion",
            "params": {"rsi_len": 14, "rsi_lower": 30, "rsi_upper": 70},
            "enabled": True,
        }
    ]


def get_autopilot_row(civic_sub: str) -> Dict[str, Any]:
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM coinbase_live_autopilot WHERE civic_sub = ?", (civic_sub,)).fetchone()
            if not row:
                return {
                    "interval_sec": 60.0,
                    "lookback_hours": 168,
                    "buy_usd": 1000.0,
                    "sell_fraction": 0.25,
                    "running": False,
                    "strategies": _default_strategies(),
                }
            try:
                strategies = json.loads(row["strategies_json"] or "[]")
            except json.JSONDecodeError:
                strategies = _default_strategies()
            if not strategies:
                strategies = _default_strategies()
            return {
                "interval_sec": float(row["interval_sec"]),
                "lookback_hours": int(row["lookback_hours"]),
                "buy_usd": float(row["buy_usd"]),
                "sell_fraction": float(row["sell_fraction"]),
                "running": bool(row["running"]),
                "strategies": strategies,
            }
        finally:
            conn.close()


def save_autopilot_config(
    *,
    civic_sub: str,
    interval_sec: float,
    lookback_hours: int,
    buy_usd: float,
    sell_fraction: float,
    strategies: List[Dict[str, Any]],
) -> None:
    now = time.time()
    sj = json.dumps(strategies)
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO coinbase_live_autopilot
                    (civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, running, strategies_json, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                ON CONFLICT(civic_sub) DO UPDATE SET
                    interval_sec = excluded.interval_sec,
                    lookback_hours = excluded.lookback_hours,
                    buy_usd = excluded.buy_usd,
                    sell_fraction = excluded.sell_fraction,
                    strategies_json = excluded.strategies_json,
                    updated_at = excluded.updated_at
                """,
                (civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, sj, now),
            )
            conn.commit()
        finally:
            conn.close()


def set_autopilot_running(civic_sub: str, running: bool) -> None:
    now = time.time()
    run_i = 1 if running else 0
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "UPDATE coinbase_live_autopilot SET running = ?, updated_at = ? WHERE civic_sub = ?",
                (run_i, now, civic_sub),
            )
            if cur.rowcount == 0:
                conn.execute(
                    """
                    INSERT INTO coinbase_live_autopilot
                        (civic_sub, interval_sec, lookback_hours, buy_usd, sell_fraction, running, strategies_json, updated_at)
                    VALUES (?, 60, 168, 1000, 0.25, ?, '[]', ?)
                    """,
                    (civic_sub, run_i, now),
                )
            conn.commit()
        finally:
            conn.close()


def get_running_civic_sub_other_than(exclude_sub: str) -> Optional[str]:
    """If any user other than exclude_sub has autopilot running, return their civic_sub (else None)."""
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                """
                SELECT civic_sub FROM coinbase_live_autopilot
                WHERE running = 1 AND civic_sub != ?
                LIMIT 1
                """,
                (exclude_sub,),
            ).fetchone()
            return str(row[0]) if row else None
        finally:
            conn.close()


def list_running_civic_subs() -> List[str]:
    with _lock:
        conn = _connect()
        try:
            rows = conn.execute(
                "SELECT civic_sub FROM coinbase_live_autopilot WHERE running = 1"
            ).fetchall()
            return [str(r[0]) for r in rows]
        finally:
            conn.close()


# Initialize schema on import (idempotent)
init_schema()
