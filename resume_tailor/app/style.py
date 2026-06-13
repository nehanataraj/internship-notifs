import re
from pathlib import Path

from app.config import ROOT

STYLE_FILE = ROOT / "resume" / "writing_style.md"
MAX_STYLE_CHARS = 2_000


def load_writing_style() -> str:
    """Load saved style reference from resume/writing_style.md."""
    if not STYLE_FILE.is_file():
        return ""
    return compact_writing_style(STYLE_FILE.read_text(encoding="utf-8").strip())


def compact_writing_style(text: str) -> str:
    """Keep voice cues only — smaller payload, faster API calls."""
    if not text.strip():
        return ""

    parts: list[str] = []

    for heading in (
        "Tone",
        "Bullet examples",
        "Words / patterns to avoid",
        "Words / patterns you prefer",
    ):
        block = _section(text, heading)
        if block:
            parts.append(block)

    narrative = _section(text, "Narrative voice")
    if narrative and "Voice cues" in narrative:
        idx = narrative.find("Voice cues")
        parts.append("## Voice (summary)\n" + narrative[idx : idx + 280])

    out = "\n\n".join(parts).strip()
    if len(out) > MAX_STYLE_CHARS:
        out = out[:MAX_STYLE_CHARS] + "\n…"
    return out or text[:MAX_STYLE_CHARS]


def _section(text: str, heading_prefix: str) -> str:
    pattern = re.escape(heading_prefix)
    m = re.search(rf"^## {pattern}.*?(?=^## |\Z)", text, re.M | re.S)
    return m.group(0).strip() if m else ""
