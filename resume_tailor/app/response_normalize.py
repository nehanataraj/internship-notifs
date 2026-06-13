"""Normalize model JSON keys and types into a consistent shape."""


def _coerce_str(value, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            parts.append(f"## {k}\n{_coerce_str(v)}")
        return "\n\n".join(parts).strip()
    if isinstance(value, list):
        return "\n".join(_coerce_str(x) for x in value if x is not None).strip()
    return str(value).strip()


def _first_present(data: dict, *keys: str) -> str:
    for key in keys:
        if key in data and data[key] is not None:
            text = _coerce_str(data[key])
            if text:
                return text
    return ""


def normalize_tailor_response(data: dict) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Response is not a JSON object")

    tailored = _first_present(
        data,
        "tailored_resume",
        "tailoredResume",
        "resume",
        "tailored",
    )
    changelog = _first_present(
        data,
        "changelog",
        "change_log",
        "changes",
        "what_changed",
    )
    alignment = _first_present(
        data,
        "alignment_notes",
        "alignmentNotes",
        "alignment_outlook",
        "alignment",
        "alignment_summary",
    )

    if not tailored:
        raise ValueError("tailored_resume")

    if not changelog:
        changelog = "## Note\nChangelog was not returned by the model. Compare your Word download to your original."

    if not alignment:
        alignment = (
            "## Strong matches\n"
            "(Model did not return alignment notes — check the tailored resume and changelog.)\n\n"
            "## Honest gaps\n"
            "Re-run tailoring if you need a full alignment breakdown."
        )

    result = {
        "tailored_resume": tailored,
        "changelog": changelog,
        "alignment_notes": alignment,
        "paragraph_updates": [],
        "text_replacements": [],
    }

    for src, dest in (
        ("paragraph_updates", "paragraph_updates"),
        ("paragraphUpdates", "paragraph_updates"),
        ("text_replacements", "text_replacements"),
        ("textReplacements", "text_replacements"),
    ):
        val = data.get(src)
        if isinstance(val, list):
            result[dest] = val

    return result
