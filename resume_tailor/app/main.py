import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.config import (
    ALLOWED_EXTENSIONS,
    OPENAI_API_KEY,
    MAX_UPLOAD_BYTES,
    ROOT,
    UPLOAD_DIR,
)
from app.bullet_sanitize import sanitize_tailor_result
from app.docx_output import build_paragraph_prompt, build_tailored_docx, ensure_docx_editable
from app.docx_store import get_docx_path, save_docx
from app.extract import extract_text
from app.pdf_export import markdown_to_pdf_bytes
from app.style import compact_writing_style, load_writing_style
from app.tailor import TailorError, tailor_resume

app = FastAPI(title="Resume Tailor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://webapp-two-peach.vercel.app",
        "https://nehanataraj.github.io",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=ROOT / "templates")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


class TailorMdRequest(BaseModel):
    resume_text: str
    job_description: str
    writing_style: str = ""


class MdToPdfRequest(BaseModel):
    markdown: str


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"has_api_key": bool(OPENAI_API_KEY)},
    )


@app.get("/api/health")
async def health():
    return {"ok": True, "api_key_configured": bool(OPENAI_API_KEY)}


@app.get("/api/writing-style")
async def get_writing_style():
    return {"text": load_writing_style()}


@app.post("/api/tailor-md")
async def tailor_md(body: TailorMdRequest):
    style = compact_writing_style(body.writing_style.strip() or load_writing_style())
    try:
        result = tailor_resume(body.resume_text, body.job_description, style, paragraph_map=None)
    except TailorError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Tailoring failed: {e}") from e

    return {
        "tailored_resume": result["tailored_resume"],
        "changelog": result["changelog"],
        "alignment_notes": result["alignment_notes"],
        "replacements_applied": len(result.get("text_replacements") or []),
    }


@app.post("/api/md-to-pdf")
async def md_to_pdf(body: MdToPdfRequest):
    try:
        pdf = markdown_to_pdf_bytes(body.markdown)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"PDF export failed: {e}") from e

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="tailored_resume.pdf"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/extract")
async def extract_resume(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file selected.")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported file type. Use: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")
    if not content:
        raise HTTPException(400, "File is empty.")

    try:
        text = extract_text(file.filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    docx_upload_id = None
    if ext == ".docx":
        docx_upload_id = str(uuid.uuid4())
        save_docx(docx_upload_id, content)
    elif ext == ".doc":
        raise HTTPException(
            400,
            "Legacy .doc files are not supported. In Word: File → Save As → .docx, then upload again.",
        )

    return {
        "text": text,
        "filename": file.filename,
        "docx_upload_id": docx_upload_id,
        "preserves_word_format": docx_upload_id is not None,
    }


@app.post("/api/tailor")
async def tailor(
    resume_text: str = Form(...),
    job_description: str = Form(...),
    writing_style: str = Form(""),
    docx_upload_id: str = Form(""),
    source_docx: UploadFile | None = File(None),
):
    raw_style = writing_style.strip() or load_writing_style()
    style = compact_writing_style(raw_style)

    docx_path = None
    if source_docx and source_docx.filename:
        ext = Path(source_docx.filename).suffix.lower()
        if ext != ".docx":
            raise HTTPException(400, "source_docx must be a .docx file.")
        content = await source_docx.read()
        upload_id = docx_upload_id.strip() or str(uuid.uuid4())
        docx_path = save_docx(upload_id, content)
    elif docx_upload_id.strip():
        docx_path = get_docx_path(docx_upload_id.strip())

    if not docx_path:
        raise HTTPException(
            400,
            "Upload your resume as a Word file (.docx) to get tailored output in the same format. "
            "PDF and pasted text only produce a markdown preview.",
        )

    paragraph_map = None
    if docx_path:
        paragraph_map, _ = build_paragraph_prompt(docx_path)

    try:
        result = tailor_resume(resume_text, job_description, style, paragraph_map=paragraph_map)
    except TailorError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Tailoring failed: {e}") from e

    session_id = str(uuid.uuid4())
    session_dir = UPLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    (session_dir / "changelog.md").write_text(result["changelog"], encoding="utf-8")
    (session_dir / "alignment_notes.md").write_text(result["alignment_notes"], encoding="utf-8")

    out_docx = session_dir / "tailored_resume.docx"
    _, validated_replacements, preview_text = build_tailored_docx(
        docx_path,
        result["tailored_resume"],
        result.get("paragraph_updates", []),
        result.get("text_replacements", []),
        out_docx,
        original_resume_text=resume_text,
    )

    (session_dir / "tailored_resume.md").write_text(preview_text, encoding="utf-8")

    return JSONResponse(
        {
            "session_id": session_id,
            "has_docx": True,
            "docx_filename": "tailored_resume.docx",
            "tailored_resume": preview_text,
            "replacements_applied": len(validated_replacements),
            "changelog": result["changelog"],
            "alignment_notes": result["alignment_notes"],
        }
    )


@app.get("/api/download/{session_id}/resume.docx")
async def download_docx(session_id: str):
    path = UPLOAD_DIR / session_id / "tailored_resume.docx"
    if not path.is_file():
        raise HTTPException(404, "Word file not found. Upload a .docx resume and tailor again.")
    ensure_docx_editable(path)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="tailored_resume.docx",
        headers={
            "Content-Disposition": 'attachment; filename="tailored_resume.docx"',
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8765, reload=True)
