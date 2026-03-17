"""
PDF extraction and AI analysis service for ParentSquare newsletter attachments.

Flow:
  1. Browser POSTs base64 PDF bytes to /api/ps-pdf/receive
  2. extract_text_from_bytes()  — PyMuPDF → plain text
  3. analyze_pdf_with_claude()  — Claude extracts structured newsletter summary
  4. Result stored as JSON in Email.ps_attachments alongside thumbnail URLs
"""
import base64
import json
import logging
import re
from typing import Optional

import fitz  # PyMuPDF

from config import settings
import anthropic

logger = logging.getLogger(__name__)
_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def extract_text_from_bytes(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF given raw bytes. Returns plain text."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text("text"))
        doc.close()
        return "\n\n".join(pages).strip()
    except Exception as e:
        logger.error("PDF text extraction failed: %s", e)
        return ""


def extract_text_from_base64(b64_data: str) -> str:
    """Decode base64 and extract text."""
    try:
        pdf_bytes = base64.b64decode(b64_data)
        return extract_text_from_bytes(pdf_bytes)
    except Exception as e:
        logger.error("Base64 PDF decode failed: %s", e)
        return ""


# ---------------------------------------------------------------------------
# Claude analysis
# ---------------------------------------------------------------------------

_ANALYSIS_PROMPT = """\
You are a school-parent communication assistant. The following is the text content
of a classroom newsletter PDF. Extract structured information that is most useful
for parents.

NEWSLETTER TEXT:
{text}

---

Return ONLY valid JSON with this exact shape (no prose, no code fences):
{{
  "title": "Short descriptive title of this newsletter (e.g. 'KHe Week 27 Newsletter')",
  "week_of": "Date string like 'Week of March 10' or null if not found",
  "summary": "2-4 sentence plain-English summary of what happened and what is coming up",
  "learning_areas": [
    {{
      "subject": "Subject name (e.g. 'Math', 'Science', 'Language Arts', 'Social Studies', 'Art', 'PE', 'Music')",
      "what_we_learned": "1-3 sentences about topics covered or skills practiced this week",
      "coming_up": "1-2 sentences about what is next, if mentioned. Null if not mentioned."
    }}
  ],
  "upcoming_events": [
    {{
      "label": "Short event label",
      "date": "Human-readable date string from the newsletter, or null"
    }}
  ],
  "reminders": [
    "One concise sentence per reminder or action item for parents"
  ],
  "poem_text": "The full verbatim text of the poem the student must memorize and recite, if one is printed in this newsletter. Preserve all line breaks. Null if no poem is included."
}}

Rules:
- "learning_areas" should cover all subjects mentioned in the newsletter.
- "upcoming_events" should only include dates/events explicitly mentioned.
- "reminders" are things parents need to do, remember, or bring.
- "poem_text" must be the exact poem text as printed, not a summary. Include the title line if it appears as part of the poem block. Null if no poem is present.
- Keep language concise and parent-friendly.
- If the text is very short or unreadable, return the best partial result you can.
"""


def analyze_pdf_with_claude(text: str, filename: str = "") -> Optional[dict]:
    """
    Run Claude on extracted PDF text to produce a structured newsletter summary.
    Returns a dict or None on failure.
    """
    if not text or len(text) < 50:
        logger.warning("PDF text too short to analyze (%d chars) for %s", len(text), filename)
        return None

    # Truncate to avoid token limits (~12k chars ≈ 3k tokens, well within limits)
    truncated = text[:12000]
    prompt = _ANALYSIS_PROMPT.format(text=truncated)

    try:
        message = _client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        result.setdefault("title", filename or "Newsletter")
        result.setdefault("week_of", None)
        result.setdefault("summary", "")
        result.setdefault("learning_areas", [])
        result.setdefault("upcoming_events", [])
        result.setdefault("reminders", [])
        result.setdefault("poem_text", None)
        return result
    except Exception as e:
        logger.error("Claude PDF analysis failed for %s: %s", filename, e)
        return None


# ---------------------------------------------------------------------------
# High-level entry point
# ---------------------------------------------------------------------------

def process_pdf(b64_data: str, filename: str, feed_id: Optional[int] = None) -> dict:
    """
    Full pipeline: decode → extract text → analyze → return result dict.

    Returns a dict with keys: filename, text_length, analysis (or error).
    """
    logger.info("Processing PDF: %s (feed_id=%s)", filename, feed_id)

    text = extract_text_from_base64(b64_data)
    if not text:
        return {"filename": filename, "feed_id": feed_id, "error": "Could not extract text from PDF", "analysis": None}

    logger.info("Extracted %d chars from %s", len(text), filename)
    analysis = analyze_pdf_with_claude(text, filename)

    return {
        "filename": filename,
        "feed_id": feed_id,
        "text_length": len(text),
        "analysis": analysis,
    }
