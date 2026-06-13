import shutil
from pathlib import Path

from app.config import UPLOAD_DIR

SOURCE_DIR = UPLOAD_DIR / "sources"
SOURCE_DIR.mkdir(parents=True, exist_ok=True)


def save_docx(upload_id: str, content: bytes) -> Path:
    folder = SOURCE_DIR / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "original.docx"
    path.write_bytes(content)
    return path


def get_docx_path(upload_id: str) -> Path | None:
    path = SOURCE_DIR / upload_id / "original.docx"
    return path if path.is_file() else None


def copy_to_session(upload_id: str, session_dir: Path) -> Path | None:
    src = get_docx_path(upload_id)
    if not src:
        return None
    dest = session_dir / "tailored_resume.docx"
    shutil.copy2(src, dest)
    return dest
