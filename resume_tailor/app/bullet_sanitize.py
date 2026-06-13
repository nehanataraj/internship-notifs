"""Fix AI skill-prefix gimmicks (Python-engineered, Developed a Python-based…)."""

from __future__ import annotations

import re

_VERBS = (
    "Engineered",
    "Built",
    "Created",
    "Designed",
    "Architected",
    "Developed",
    "Presented",
    "Collaborated on",
)

# Python-engineered / Python-scripted …
_SKILL_VERB_PREFIX = re.compile(
    r"^([A-Za-z][A-Za-z0-9+/\-]*)-(engineered|scripted|built|developed|created|designed|implemented|automated|commanded)\s+",
    re.I,
)

# Developed a Python-based …
_VERB_A_SKILL_BASED = re.compile(
    r"^(Developed|Built|Created|Engineered|Designed|Architected|Implemented|Automated|Presented)\s+(a|an)\s+([A-Za-z][A-Za-z0-9+/\-]*)-based\s+",
    re.I,
)

# Any Skill-based within the opening clause (first ~6 words after optional verb)
_SKILL_BASED_EARLY = re.compile(
    r"^((?:\w+\s+){0,2}(?:a|an)\s+)([A-Za-z][A-Za-z0-9+/\-]*)-based\s+",
    re.I,
)

# Tools as sentence subject: "Python-based LangChain and WebLLM engineered an AI email agent"
_TOOLS_AS_SUBJECT = re.compile(
    r"^(?:(Python)-based\s+)?(.+?)\s+"
    r"(engineered|built|developed|created|designed|implemented|automated|scripted|architected|deployed|integrated)\s+"
    r"(.+)$",
    re.I,
)

_HUMAN_VERB_START = re.compile(
    r"^(Engineered|Built|Created|Designed|Architected|Developed|Presented|Collaborated|Utilized|Trained|Deployed|Eliminated|Engaged|Participated|Contributed|Collaborated)\b",
    re.I,
)


def _format_skill_list(skills: list[str]) -> str:
    skills = [s for s in skills if s]
    if not skills:
        return ""
    if len(skills) == 1:
        return skills[0]
    if len(skills) == 2:
        return f"{skills[0]} and {skills[1]}"
    return ", ".join(skills[:-1]) + f", and {skills[-1]}"


def _fix_tools_as_subject(body: str, verb_index: int) -> tuple[str, int] | None:
    """Tools/libraries must never be the grammatical subject."""
    if _HUMAN_VERB_START.match(body):
        return None

    m = _TOOLS_AS_SUBJECT.match(body)
    if not m:
        return None

    prefix_skill = m.group(1)
    tools_chunk = m.group(2).strip()
    rest = m.group(4).strip()

    # Only fix when the subject chunk looks like tools (not a normal noun phrase)
    tool_like = re.search(
        r"\b(Python|LangChain|WebLLM|FastAPI|GPT|SQL|AWS|PostgreSQL|JavaScript|Node\.js|API|Gemini|OpenAI)\b",
        tools_chunk,
        re.I,
    ) or prefix_skill
    if not tool_like:
        return None

    skills: list[str] = []
    if prefix_skill:
        skills.append(prefix_skill)
    skills.extend(part.strip() for part in re.split(r"\s+and\s+", tools_chunk, flags=re.I))

    verb = _VERBS[verb_index % len(_VERBS)]
    verb_index += 1
    skill_str = _format_skill_list(skills)
    rest_clean = _strip_leading_article(rest)
    if "," in rest_clean:
        head, tail = rest_clean.split(",", 1)
        fixed = f"{verb} {_article_for(head)} {head} using {skill_str},{tail}"
    else:
        fixed = f"{verb} {_article_for(rest_clean)} {rest_clean} using {skill_str}"
    return fixed, verb_index


def _article_for(noun_phrase: str) -> str:
    first = noun_phrase.lstrip()[0:1].lower() if noun_phrase.strip() else "a"
    return "an" if first in "aeiou" else "a"


def _strip_leading_article(text: str) -> str:
    return re.sub(r"^(a|an)\s+", "", text.strip(), flags=re.I)


def _join_skill_tools(skill: str, tools: str) -> str:
    tools = tools.strip()
    if re.search(r"\band\b", tools, re.I):
        return f"{skill}, {tools}"
    return f"{skill} and {tools}"


def _split_trailing_clause(tools: str) -> tuple[str, str]:
    """Keep tool list separate from trailing ', verb-ing …' impact clause."""
    m = re.match(
        r"^(.+?),\s+(automating|parsing|locating|reducing|integrating|deploying|handling|enabling|supporting|visualizing|collaborating|training|utilizing)\b(.*)$",
        tools,
        re.I,
    )
    if m:
        return m.group(1).strip(), f", {m.group(2)}{m.group(3)}"
    return tools.strip(), ""


def _merge_skill_into_using(rest: str, skill: str) -> str:
    """Move skill into a using/with/in clause instead of a hyphenated prefix."""
    rest = _strip_leading_article(rest).strip().rstrip(".")

    # "Inverted Index Algorithm, locating …" → "… Algorithm in Python, locating …"
    if "," in rest and not re.search(r"\busing\b|\bwith\b", rest[: rest.index(",")], re.I):
        head, tail = rest.split(",", 1)
        return f"{head.strip()} in {skill},{tail}"

    using_match = re.match(r"^(.+?)\s+using\s+(.+)$", rest, re.I | re.S)
    if using_match:
        obj, tools = using_match.group(1).strip(), using_match.group(2).strip()
        tool_list, suffix = _split_trailing_clause(tools)
        return f"{obj} using {_join_skill_tools(skill, tool_list)}{suffix}"

    with_match = re.match(r"^(.+?)\s+with\s+(.+)$", rest, re.I | re.S)
    if with_match:
        obj, tools = with_match.group(1).strip(), with_match.group(2).strip()
        tool_list, suffix = _split_trailing_clause(tools)
        return f"{obj} with {_join_skill_tools(skill, tool_list)}{suffix}"

    return f"{rest} using {skill}"


def sanitize_bullet_line(line: str, verb_index: int) -> tuple[str, int]:
    """Return (fixed_line, next_verb_index)."""
    stripped = line.strip()
    if len(stripped) <= 12:
        return line, verb_index

    body = stripped
    prefix = ""
    for bullet_prefix in (r"^[\-\*•]\s+", r"^\d+\.\s+"):
        m = re.match(bullet_prefix, body)
        if m:
            prefix = m.group(0)
            body = body[m.end() :]
            break

    original_body = body

    fixed_tools = _fix_tools_as_subject(body, verb_index)
    if fixed_tools:
        body, verb_index = fixed_tools
    elif _SKILL_VERB_PREFIX.match(body):
        m = _SKILL_VERB_PREFIX.match(body)
        assert m is not None
        skill = m.group(1)
        rest = body[m.end() :].strip()
        verb = _VERBS[verb_index % len(_VERBS)]
        verb_index += 1
        merged = _merge_skill_into_using(rest, skill)
        body = f"{verb} {_article_for(merged.split(',')[0].split(' using ')[0].split(' with ')[0])} {merged}"
    else:
        m = _VERB_A_SKILL_BASED.match(body) or _SKILL_BASED_EARLY.match(body)
        if m:
            if _VERB_A_SKILL_BASED.match(body):
                skill = m.group(3)
                rest = body[m.end() :].strip()
            else:
                skill = m.group(2)
                rest = body[m.end() :].strip()
            verb = _VERBS[verb_index % len(_VERBS)]
            verb_index += 1
            merged = _merge_skill_into_using(rest, skill)
            body = f"{verb} {_article_for(merged)} {merged}"

    if body == original_body:
        return line, verb_index

    if body and body[-1] not in ".!?":
        body += "."

    return prefix + body, verb_index


def sanitize_tailored_text(text: str) -> str:
    if not text:
        return text

    verb_index = 0
    out_lines: list[str] = []
    for raw in text.splitlines():
        fixed, verb_index = sanitize_bullet_line(raw, verb_index)
        out_lines.append(fixed)
    return "\n".join(out_lines)


def sanitize_tailor_result(result: dict) -> dict:
    """Apply bullet fixes to all user-visible text fields."""
    result = dict(result)
    result["tailored_resume"] = sanitize_tailored_text(result.get("tailored_resume", ""))

    replacements = result.get("text_replacements") or []
    fixed_replacements: list[dict] = []
    verb_index = 0
    for item in replacements:
        if not isinstance(item, dict):
            continue
        tailored = str(item.get("tailored", ""))
        fixed, verb_index = sanitize_bullet_line(tailored, verb_index)
        fixed_replacements.append({**item, "tailored": fixed})
    result["text_replacements"] = fixed_replacements

    updates = result.get("paragraph_updates") or []
    fixed_updates: list[dict] = []
    for item in updates:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", ""))
        fixed, verb_index = sanitize_bullet_line(text, verb_index)
        fixed_updates.append({**item, "text": fixed})
    result["paragraph_updates"] = fixed_updates

    return result
