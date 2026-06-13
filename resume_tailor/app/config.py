import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md", ".markdown"}

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

_fallbacks = os.getenv("OPENAI_MODEL_FALLBACKS", "").strip()
DEFAULT_FALLBACKS = ["gpt-4o-mini", "gpt-4.1-mini"]


def openai_model_chain() -> list[str]:
    if _fallbacks:
        chain = [OPENAI_MODEL] + [m.strip() for m in _fallbacks.split(",") if m.strip()]
    else:
        chain = [OPENAI_MODEL, *DEFAULT_FALLBACKS]
    seen: set[str] = set()
    out: list[str] = []
    for m in chain:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out
