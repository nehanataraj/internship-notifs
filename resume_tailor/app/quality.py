"""Detect shallow tailoring (cosmetic edits) vs meaningful JD-aligned rewrites."""

import re
from difflib import SequenceMatcher

_STOPWORDS = frozenset(
    "a an the and or but in on at to for of with by from as is was were be been being".split()
)

# Reject rewrites this similar — e.g. only "from scratch" removed or "to support" → "supporting"
_MAX_SIMILARITY = 0.81


def _content_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        line = re.sub(r"^[\-\*•]\s+", "", line)
        line = re.sub(r"^\d+\.\s+", "", line)
        if len(line) > 12 and not line.startswith("#"):
            lines.append(line)
    return lines


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _opening_words(text: str, n: int = 4) -> str:
    return " ".join(text.lower().split()[:n])


def is_cosmetic_rewrite(original: str, tailored: str) -> bool:
    """
    True when After is basically the same sentence as Before.
    Catches: removing 'from scratch', 'to support' → 'supporting', etc.
    """
    if original.strip() == tailored.strip():
        return True

    ratio = _similarity(original, tailored)
    if ratio >= _MAX_SIMILARITY:
        return True

    # Same opening + high overlap = cosmetic
    if _opening_words(original) == _opening_words(tailored) and ratio >= 0.72:
        return True

    o_words = original.lower().split()
    t_words = tailored.lower().split()
    o_content = set(o_words) - _STOPWORDS
    t_content = set(t_words) - _STOPWORDS

    # Only one content word changed
    if len(o_content.symmetric_difference(t_content)) <= 1 and ratio >= 0.78:
        return True

    return False


def count_meaningful_rewrites(original_resume: str, tailored_resume: str) -> int:
    orig = _content_lines(original_resume)
    new = _content_lines(tailored_resume)
    matcher = SequenceMatcher(None, orig, new)
    meaningful = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for o, n in zip(orig[i1:i2], new[j1:j2]):
                if o != n and not is_cosmetic_rewrite(o, n):
                    meaningful += 1
        elif tag == "replace":
            for o, n in zip(orig[i1:i2], new[j1:j2]):
                if o != n and not is_cosmetic_rewrite(o, n):
                    meaningful += 1

    return meaningful


def is_tailoring_too_shallow(original_resume: str, tailored_resume: str) -> bool:
    """Deprecated for word-swap mode — kept for tests. Never triggers aggressive retry."""
    return False


_PASSIVE_PATTERNS = (
    re.compile(r"\b(were|was|is|are|been|being)\s+(used|built|engineered|developed|created|designed|implemented|deployed|integrated)\b", re.I),
    re.compile(r"\b(were|was)\s+used\s+to\b", re.I),
    re.compile(r"\b\w+-based\s+\w+.*\bwere\s+used\b", re.I),
)

# Tools/libraries as grammatical subject (not active candidate voice)
_TOOLS_AS_SUBJECT = re.compile(
    r"^(?:(?:Python|SQL|AWS|Java|API)-based\s+)?"
    r"(?:[A-Za-z][A-Za-z0-9+/\-]*(?:\s+and\s+[A-Za-z][A-Za-z0-9+/\-]*)+)\s+"
    r"(engineered|built|developed|created|designed|implemented|automated|scripted|architected|deployed)\b",
    re.I,
)
_TOOLS_AS_SUBJECT_SINGLE = re.compile(
    r"^(?:Python-based\s+)?(?:LangChain|WebLLM|FastAPI|GPT-4o|PostgreSQL|JavaScript)\s+"
    r"(engineered|built|developed|created|designed|implemented|automated|scripted|architected)\b",
    re.I,
)


def has_passive_voice_bullets(tailored_resume: str) -> bool:
    """True if any content line uses passive, tool-first, or tool-as-subject phrasing."""
    for line in _content_lines(tailored_resume):
        for pat in _PASSIVE_PATTERNS:
            if pat.search(line):
                return True
        if _TOOLS_AS_SUBJECT.match(line) or _TOOLS_AS_SUBJECT_SINGLE.match(line):
            return True
    return False


_SKILL_VERB_PREFIX = re.compile(
    r"^([A-Za-z][A-Za-z0-9+/\-]*)-(engineered|scripted|built|developed|created|designed|implemented|automated|commanded)\b",
    re.I,
)
_VERB_A_SKILL_BASED = re.compile(
    r"^(Developed|Built|Created|Engineered|Designed|Architected|Implemented|Automated|Presented)\s+(a|an)\s+([A-Za-z][A-Za-z0-9+/\-]*)-based\b",
    re.I,
)
_SKILL_BASED_EARLY = re.compile(
    r"^((?:\w+\s+){0,2}(?:a|an)\s+)([A-Za-z][A-Za-z0-9+/\-]*)-based\b",
    re.I,
)


def has_repetitive_bullet_openings(tailored_resume: str) -> bool:
    """True when bullets use Skill-verb or Skill-based opening gimmicks."""
    for line in _content_lines(tailored_resume):
        if _SKILL_VERB_PREFIX.match(line):
            return True
        if _VERB_A_SKILL_BASED.match(line):
            return True
        if _SKILL_BASED_EARLY.match(line):
            return True
    return False


RETRY_APPENDIX = """

CRITICAL — REJECTED: You rewrote sentences instead of doing word swaps.

This is WORD SWAP mode: **8–10 words total** across the resume. Each changed line must stay **95%+ identical**.

UNACCEPTABLE — full rewrite:
Before: "Engineered an AI-powered email agent with LangChain and WebLLM…"
After: "Python-based LangChain and WebLLM engineered an AI email agent…"
^ Entire sentence restructured. BANNED.

ACCEPTABLE — word swap (1 word):
Before: "Engineered an AI-powered email agent with LangChain and WebLLM…"
After: "Engineered a Python AI-powered email agent with LangChain and WebLLM…"

Rules for this retry:
1. Max **10 word swaps total**, max **3 words per line**, max **6 lines** touched.
2. Keep the same sentence structure and opening verb on every line.
3. text_replacements only — exact original paragraph text, tailored = same sentence with 1–3 words swapped.
4. Active voice — never passive, never tools as subject.
5. No fabrication. No full rewrites.
"""
