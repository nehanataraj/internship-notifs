"""Parse model JSON even when it contains unescaped newlines or control characters."""

import json
import re

import json_repair


def strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def escape_control_chars_in_strings(text: str) -> str:
    """Turn literal newlines inside JSON strings into \\n."""
    out: list[str] = []
    in_string = False
    escape = False

    for c in text:
        if escape:
            out.append(c)
            escape = False
            continue
        if c == "\\":
            out.append(c)
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            out.append(c)
            continue
        if in_string:
            if c == "\n":
                out.append("\\n")
                continue
            if c == "\r":
                out.append("\\r")
                continue
            if c == "\t":
                out.append("\\t")
                continue
            if ord(c) < 32:
                continue
        out.append(c)

    return "".join(out)


def parse_model_json(raw: str) -> dict:
    text = strip_json_fences(raw)

    attempts = (
        text,
        escape_control_chars_in_strings(text),
    )
    last_error: json.JSONDecodeError | None = None

    for candidate in attempts:
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as e:
            last_error = e

    try:
        data = json_repair.loads(text)
        if isinstance(data, dict):
            return data
    except Exception as e:
        raise json.JSONDecodeError(str(e), text, 0) from e

    raise last_error or json.JSONDecodeError("Could not parse model JSON", text, 0)
