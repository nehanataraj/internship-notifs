import json
import time

from openai import OpenAI

from app.config import OPENAI_API_KEY, openai_model_chain
from app.jd_keywords import build_jd_focus_block
from app.json_parse import parse_model_json
from app.prompts import (
    DOCX_OUTPUT_ADDENDUM,
    DOCX_USER_APPENDIX,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from app.bullet_sanitize import sanitize_tailor_result
from app.docx_output import rebuild_resume_preview
from app.quality import (
    RETRY_APPENDIX,
    has_passive_voice_bullets,
    has_repetitive_bullet_openings,
)
from app.word_swap import enforce_word_swap_budget, is_tailoring_too_aggressive
from app.response_normalize import normalize_tailor_response


class TailorError(Exception):
    pass


def _call_openai(client: OpenAI, model: str, user_message: str, system: str, temperature: float) -> str:
    response = client.chat.completions.create(
        model=model,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raise TailorError(
            "OpenAI returned an empty response. Try again or use a shorter resume."
        )
    return raw


def tailor_resume(
    resume_text: str,
    job_description: str,
    writing_style: str = "",
    paragraph_map: str | None = None,
) -> dict:
    if not OPENAI_API_KEY:
        raise TailorError(
            "OPENAI_API_KEY is not set. Add it to the server environment."
        )
    if not resume_text.strip():
        raise TailorError("Resume text is empty.")
    if not job_description.strip():
        raise TailorError("Job description is empty.")

    jd_focus = build_jd_focus_block(job_description)
    base_message = USER_PROMPT_TEMPLATE.format(
        job_description=job_description.strip(),
        jd_focus=jd_focus,
        writing_style=writing_style.strip() or "(none provided)",
        resume_text=resume_text.strip(),
    )
    if paragraph_map:
        base_message += DOCX_USER_APPENDIX.format(paragraph_map=paragraph_map)

    system = SYSTEM_PROMPT + (DOCX_OUTPUT_ADDENDUM if paragraph_map else "")

    client = OpenAI(api_key=OPENAI_API_KEY)
    models = openai_model_chain()
    attempt_notes: list[str] = []
    last_error: Exception | None = None

    for model in models:
        user_message = base_message

        for pass_num in range(3):
            raw = None
            api_error: Exception | None = None

            for api_try in range(5):
                try:
                    raw = _call_openai(
                        client,
                        model,
                        user_message,
                        system,
                        temperature=0.5 + (pass_num * 0.05),
                    )
                    api_error = None
                    break
                except TailorError:
                    raise
                except Exception as e:
                    api_error = e
                    if _is_transient(e) and api_try < 4:
                        time.sleep([2, 4, 8, 15, 25][api_try])
                        continue
                    break

            if api_error is not None:
                last_error = api_error
                if _is_rate_limit(api_error):
                    attempt_notes.append(f"{model} (rate limited)")
                    break
                if _is_model_not_found(api_error):
                    attempt_notes.append(f"{model} (not found)")
                    break
                if _is_transient(api_error):
                    attempt_notes.append(f"{model} (busy)")
                    break
                raise TailorError(f"OpenAI API error ({model}): {api_error}") from api_error

            result = _parse_response(raw, for_docx=bool(paragraph_map))
            result = sanitize_tailor_result(result)
            result["text_replacements"] = enforce_word_swap_budget(
                result.get("text_replacements", [])
            )
            result["tailored_resume"] = rebuild_resume_preview(
                resume_text, result["text_replacements"]
            )

            if pass_num < 2 and (
                is_tailoring_too_aggressive(resume_text, result["tailored_resume"])
                or has_passive_voice_bullets(result["tailored_resume"])
                or has_repetitive_bullet_openings(result["tailored_resume"])
            ):
                user_message = base_message + RETRY_APPENDIX
                continue

            return result

    raise TailorError(_all_models_failed_message(attempt_notes, last_error))


def _is_rate_limit(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "rate limit" in msg or "quota" in msg


def _is_model_not_found(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "404" in msg or "does not exist" in msg or "not found" in msg


def _is_transient(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "503",
            "500",
            "502",
            "504",
            "unavailable",
            "overloaded",
            "temporarily",
            "try again",
        )
    )


def _all_models_failed_message(models_tried: list[str], last_error: Exception | None) -> str:
    tried = ", ".join(models_tried) if models_tried else "all models"
    base = (
        f"Could not complete tailoring ({tried}).\n\n"
        "Wait a minute and try again, or set OPENAI_MODEL in the server environment."
    )
    if last_error:
        detail = str(last_error)
        if len(detail) > 300:
            detail = detail[:300] + "…"
        base += f"\n\nLast error: {detail}"
    return base


def _parse_response(raw: str, for_docx: bool = False) -> dict:
    try:
        data = parse_model_json(raw)
        return normalize_tailor_response(data)
    except json.JSONDecodeError as e:
        raise TailorError(
            "Model returned invalid JSON. Please try again — if it keeps failing, "
            "use a shorter job description or resume."
        ) from e
    except ValueError as e:
        missing = str(e)
        raise TailorError(
            f"Model response incomplete (missing: {missing}). Please try again."
        ) from e
