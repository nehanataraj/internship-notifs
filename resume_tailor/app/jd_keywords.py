"""Extract priority terms from a job description for explicit tailoring."""

import re

# Longest first for matching
_TECH_TERMS = sorted(
    [
        "full-stack",
        "full stack",
        "machine learning",
        "postgresql",
        "javascript",
        "typescript",
        "kubernetes",
        "microservices",
        "distributed systems",
        "rest api",
        "rest apis",
        "python",
        "react",
        "node.js",
        "node",
        "java",
        "sql",
        "aws",
        "gcp",
        "azure",
        "docker",
        "postgres",
        "api",
        "apis",
        "backend",
        "frontend",
        "database",
        "databases",
        "etl",
        "ci/cd",
        "agile",
        "scala",
        "go",
        "golang",
        "c++",
        "linux",
        "git",
        "nosql",
        "mongodb",
        "redis",
        "kafka",
        "spark",
        "data engineering",
        "software engineer",
        "systems design",
        "program management",
        "project management",
        "technical program",
        "cross-functional",
        "stakeholder",
        "documentation",
        "forecasting",
        "analytics",
        "herndon",
    ],
    key=len,
    reverse=True,
)


def build_jd_focus_block(job_description: str) -> str:
    jd = job_description.strip()
    if not jd:
        return "(none detected)"

    jd_lower = jd.lower()
    keywords: list[str] = []
    seen: set[str] = set()

    for term in _TECH_TERMS:
        if term in jd_lower:
            key = term.replace(" ", "")
            if key not in seen:
                seen.add(key)
                keywords.append(term)

    requirement_lines: list[str] = []
    for line in jd.splitlines():
        stripped = line.strip()
        if len(stripped) < 15:
            continue
        lower = stripped.lower()
        if any(
            w in lower
            for w in (
                "required",
                "must",
                "minimum",
                "qualifications",
                "requirements",
                "experience",
                "proficiency",
                "preferred",
                "responsibilities",
                "you will",
                "you'll",
            )
        ):
            cleaned = re.sub(r"^[\-\*•\d.]+\s*", "", stripped)
            if cleaned and cleaned not in requirement_lines:
                requirement_lines.append(cleaned[:220])

    parts = ["### Keywords detected in JD (use in bullets when resume supports them)"]
    parts.append(", ".join(keywords[:20]) if keywords else "(extract manually from JD)")

    if requirement_lines:
        parts.append("\n### Requirement lines from JD")
        for i, line in enumerate(requirement_lines[:12], 1):
            parts.append(f"{i}. {line}")

    parts.append(
        "\n### Tailoring rule\n"
        "Word swap only: 8–10 words total across the resume, max 3 words per line. "
        "Keep 95%+ of each sentence. Active voice. No rewrites."
    )
    return "\n".join(parts)
