"""Load backend/.env before other app code reads os.environ (import this module first from main)."""

from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_ROOT / ".env", override=True)

APP_DIR = Path(__file__).resolve().parent
