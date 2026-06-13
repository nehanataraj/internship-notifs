"""Word-swap tailoring limits — light keyword swaps, not sentence rewrites."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

_STOPWORDS = frozenset(
    "a an the and or but in on at to for of with by from as is was were be been being".split()
)

MAX_TOTAL_WORD_SWAPS = 10
MAX_WORDS_PER_PARAGRAPH = 3
MIN_LINE_SIMILARITY = 0.90


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _tokens(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"\w+(?:[-/]\w+)*", text or "")]


def count_word_edits(original: str, tailored: str) -> int:
    """Approximate count of word-level insert/replace/delete between two strings."""
    o = [w for w in _tokens(original) if w not in _STOPWORDS]
    t = [w for w in _tokens(tailored) if w not in _STOPWORDS]
    if o == t:
        return 0

    edits = 0
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, o, t).get_opcodes():
        if tag == "replace":
            edits += max(i2 - i1, j2 - j1)
        elif tag == "delete":
            edits += i2 - i1
        elif tag == "insert":
            edits += j2 - j1
    return edits


def line_similarity(original: str, tailored: str) -> float:
    return SequenceMatcher(None, original.lower(), tailored.lower()).ratio()


def is_valid_word_swap(original: str, tailored: str) -> bool:
    if not original or not tailored or original.strip() == tailored.strip():
        return False
    if line_similarity(original, tailored) < MIN_LINE_SIMILARITY:
        return False
    if count_word_edits(original, tailored) > MAX_WORDS_PER_PARAGRAPH:
        return False
    return True


def enforce_word_swap_budget(
    text_replacements: list[dict],
    *,
    max_total: int = MAX_TOTAL_WORD_SWAPS,
) -> list[dict]:
    """
    Keep only small in-place swaps, up to max_total word edits across the resume.
    Prefer fewer, higher-similarity changes first.
    """
    candidates: list[tuple[float, int, dict]] = []

    for item in text_replacements or []:
        if not isinstance(item, dict):
            continue
        original = _plain(str(item.get("original", "")))
        tailored = _plain(str(item.get("tailored", "")))
        if not is_valid_word_swap(original, tailored):
            continue
        edits = count_word_edits(original, tailored)
        sim = line_similarity(original, tailored)
        candidates.append((sim, edits, {"original": original, "tailored": tailored}))

    # Highest similarity first (smallest touch), then fewer edits
    candidates.sort(key=lambda x: (-x[0], x[1]))

    kept: list[dict] = []
    budget = 0
    for _, edits, item in candidates:
        if budget + edits > max_total:
            continue
        kept.append(item)
        budget += edits

    return kept


def count_total_word_edits(original_resume: str, tailored_resume: str) -> int:
    orig_lines = [ln.strip() for ln in original_resume.splitlines() if ln.strip()]
    new_lines = [ln.strip() for ln in tailored_resume.splitlines() if ln.strip()]
    total = 0

    matcher = SequenceMatcher(None, orig_lines, new_lines)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for o, n in zip(orig_lines[i1:i2], new_lines[j1:j2]):
                if o != n:
                    total += count_word_edits(o, n)
        elif tag == "replace":
            for o, n in zip(orig_lines[i1:i2], new_lines[j1:j2]):
                total += count_word_edits(o, n)

    return total


def is_tailoring_too_aggressive(original_resume: str, tailored_resume: str) -> bool:
    if count_total_word_edits(original_resume, tailored_resume) > MAX_TOTAL_WORD_SWAPS:
        return True

    orig_lines = [ln.strip() for ln in original_resume.splitlines() if ln.strip() and len(ln.strip()) > 12]
    new_lines = [ln.strip() for ln in tailored_resume.splitlines() if ln.strip() and len(ln.strip()) > 12]
    matcher = SequenceMatcher(None, orig_lines, new_lines)

    changed_bullets = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for o, n in zip(orig_lines[i1:i2], new_lines[j1:j2]):
                if o != n:
                    changed_bullets += 1
                    if line_similarity(o, n) < MIN_LINE_SIMILARITY:
                        return True
                    if count_word_edits(o, n) > MAX_WORDS_PER_PARAGRAPH:
                        return True
        elif tag == "replace":
            changed_bullets += max(len(orig_lines[i1:i2]), len(new_lines[j1:j2]))
            if changed_bullets > 6:
                return True

    return False
