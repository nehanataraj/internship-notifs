# Resume Tailor

Tailor your resume to a job description **without changing facts**. Upload your resume in the GUI, paste the job posting, and get a reordered/reworded version plus a changelog of what changed.

**We never add employers, skills, or metrics you did not already have.**

## Run the app (GUI)

```bash
cd /Users/ahalyaanil/Documents/resume_tailor
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=...  (free: https://aistudio.google.com/apikey)

chmod +x run.sh
./run.sh
```

Open **http://127.0.0.1:8765** in your browser.

1. **Upload** your resume (PDF, Word, Markdown, or text) — or paste into the text box.
2. **Paste** the job description.
3. *(Optional)* Add writing-style notes so rewrites sound like you.
4. Click **Tailor resume**, then review the result, changelog, and alignment notes.
5. **Download Word (.docx)** if you uploaded a `.docx` — same layout/fonts as your original, with tailored text.
6. Or **Copy** / **Download .md** for the markdown preview.

Uploaded files are **not** stored in the project repo. Session output goes under `uploads/<session-id>/` (gitignored) only for that run.

## API key (Gemini — free tier)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.
2. Put it in `.env` as `GEMINI_API_KEY=...`
3. Restart the app.

By default the app uses `gemini-2.0-flash-lite` and automatically tries other models if you hit rate limits. Override with `GEMINI_MODEL` in `.env` if needed.

**Hit a 429 / quota error?** Wait a minute and retry, or set `GEMINI_MODEL=gemini-2.5-flash-lite` in `.env`. Check [rate limits](https://ai.dev/rate-limit). If free tier shows limit `0`, you may need a new API key or billing enabled on your Google Cloud project.

## What tailoring does

- Reorders sections and bullets so JD-relevant experience is first
- Lightly rewords **existing** bullets to surface matching skills
- Lists honest gaps where the JD asks for something your resume does not show

## What it never does

- Invent jobs, tools, dates, degrees, or metrics
- Copy JD requirements into bullets without support in your resume

## Cursor chat (optional)

You can still tailor via Cursor without the GUI: put files in `resume/` and `job_descriptions/`, then ask to tailor using the project rules. The GUI is the recommended path if you do not want files in the repo.

## Requirements

- Python 3.10+
- Google Gemini API key (free tier available)
