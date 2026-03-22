from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken


def get_fernet() -> Fernet:
    key = (os.getenv("COINBASE_CREDENTIALS_FERNET_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "COINBASE_CREDENTIALS_FERNET_KEY is not set. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(plain: str) -> bytes:
    return get_fernet().encrypt(plain.encode("utf-8"))


def decrypt_secret(blob: bytes) -> str:
    try:
        return get_fernet().decrypt(blob).decode("utf-8")
    except InvalidToken as e:
        raise RuntimeError("Could not decrypt stored Coinbase credentials (wrong COINBASE_CREDENTIALS_FERNET_KEY?)") from e
