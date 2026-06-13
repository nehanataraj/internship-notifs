"""Markdown resume → PDF."""

from __future__ import annotations

import io

import markdown
from xhtml2pdf import pisa

_RESUME_CSS = """
@page { size: letter; margin: 0.65in; }
body {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.35;
  color: #1f1a1d;
}
h1 { font-size: 16pt; margin: 0 0 6pt; }
h2 { font-size: 11pt; margin: 12pt 0 4pt; text-transform: uppercase; letter-spacing: 0.04em; }
h3 { font-size: 10.5pt; margin: 8pt 0 3pt; }
p { margin: 0 0 4pt; }
ul { margin: 2pt 0 6pt; padding-left: 14pt; }
li { margin: 1pt 0; }
strong { font-weight: bold; }
"""


def _md_to_html(md: str) -> str:
    body = markdown.markdown(
        md or "",
        extensions=["extra", "nl2br", "sane_lists"],
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{_RESUME_CSS}</style></head>
<body>{body}</body></html>"""


def markdown_to_pdf_bytes(md: str) -> bytes:
    text = (md or "").strip()
    if not text:
        raise ValueError("Resume text is empty.")
    html = _md_to_html(text)
    buf = io.BytesIO()
    result = pisa.CreatePDF(html, dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError("PDF generation failed.")
    return buf.getvalue()
