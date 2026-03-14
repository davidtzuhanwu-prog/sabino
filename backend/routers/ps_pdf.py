"""
Router for receiving ParentSquare PDF uploads from the browser.

The frontend (running with the user's PS session) fetches PDFs via XHR and
POSTs the base64-encoded bytes here. We extract text, run Claude, and persist
the analysis back to the Email.ps_attachments JSON blob.
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Email
from services.pdf_service import process_pdf, analyze_pdf_with_claude

logger = logging.getLogger(__name__)
router = APIRouter()


class PDFReceiveRequest(BaseModel):
    filename: str
    feed_id: Optional[int] = None
    email_id: Optional[int] = None   # if known, attach analysis directly to this email
    size: Optional[int] = None
    data: str                         # base64-encoded PDF bytes


class PDFReceiveResponse(BaseModel):
    ok: bool
    filename: str
    feed_id: Optional[int] = None
    email_id: Optional[int] = None
    text_length: int = 0
    analysis: Optional[dict] = None
    error: Optional[str] = None


@router.post("/receive", response_model=PDFReceiveResponse)
def receive_pdf(req: PDFReceiveRequest, db: Session = Depends(get_db)):
    """
    Accept a base64-encoded PDF from the browser, extract text, analyze with
    Claude, and persist the analysis into the matching Email row.
    """
    logger.info(
        "PDF receive: filename=%r feed_id=%s email_id=%s size=%s",
        req.filename, req.feed_id, req.email_id, req.size,
    )

    # Run extraction + analysis
    result = process_pdf(req.data, req.filename, req.feed_id)

    if result.get("error"):
        logger.warning("PDF processing error for %r: %s", req.filename, result["error"])
        return PDFReceiveResponse(
            ok=False,
            filename=req.filename,
            feed_id=req.feed_id,
            error=result["error"],
        )

    analysis = result.get("analysis")
    text_length = result.get("text_length", 0)

    # Persist analysis into the Email row that owns this PS feed
    email = _find_email(db, req.email_id, req.feed_id)
    if email:
        _persist_pdf_analysis(email, req.filename, analysis, db)
        logger.info("Persisted PDF analysis to email id=%s", email.id)
    else:
        logger.warning("Could not find email for feed_id=%s email_id=%s", req.feed_id, req.email_id)

    return PDFReceiveResponse(
        ok=True,
        filename=req.filename,
        feed_id=req.feed_id,
        email_id=email.id if email else req.email_id,
        text_length=text_length,
        analysis=analysis,
    )


class PDFTextRequest(BaseModel):
    filename: str
    feed_id: Optional[int] = None
    email_id: Optional[int] = None
    text: str           # already-extracted plain text (from pdf.js in browser)
    pages: Optional[int] = None


@router.post("/receive-text", response_model=PDFReceiveResponse)
def receive_pdf_text(req: PDFTextRequest, db: Session = Depends(get_db)):
    """
    Accept pre-extracted PDF text from the browser (pdf.js extracts, we just analyze).
    Lighter than sending raw bytes — avoids large base64 uploads.
    """
    logger.info(
        "PDF text receive: filename=%r feed_id=%s email_id=%s pages=%s chars=%s",
        req.filename, req.feed_id, req.email_id, req.pages, len(req.text),
    )

    analysis = analyze_pdf_with_claude(req.text, req.filename)

    email = _find_email(db, req.email_id, req.feed_id)
    if email:
        _persist_pdf_analysis(email, req.filename, analysis, db)
        logger.info("Persisted PDF analysis to email id=%s", email.id)

    return PDFReceiveResponse(
        ok=True,
        filename=req.filename,
        feed_id=req.feed_id,
        email_id=email.id if email else req.email_id,
        text_length=len(req.text),
        analysis=analysis,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_email(db: Session, email_id: Optional[int], feed_id: Optional[int]) -> Optional[Email]:
    """Find the Email row for a given email_id or feed_id."""
    if email_id:
        return db.get(Email, email_id)
    if feed_id:
        # Look for email whose ps_attachments contains this feed_id
        emails = db.query(Email).filter(Email.ps_attachments.isnot(None)).all()
        for em in emails:
            try:
                ps = json.loads(em.ps_attachments)
                if ps.get("feed_id") == feed_id or str(feed_id) in (em.ps_attachments or ""):
                    return em
            except Exception:
                continue
    return None


def _persist_pdf_analysis(email: Email, filename: str, analysis: Optional[dict], db: Session) -> None:
    """
    Merge the PDF analysis into the email's ps_attachments JSON blob.
    Adds/updates a 'pdf_analyses' list: [{filename, analysis}, ...].
    """
    try:
        ps = json.loads(email.ps_attachments) if email.ps_attachments else {}
    except Exception:
        ps = {}

    pdf_analyses: list = ps.get("pdf_analyses", [])

    # Replace existing entry for same filename, or append
    existing_idx = next((i for i, p in enumerate(pdf_analyses) if p.get("filename") == filename), None)
    entry = {"filename": filename, "analysis": analysis}
    if existing_idx is not None:
        pdf_analyses[existing_idx] = entry
    else:
        pdf_analyses.append(entry)

    ps["pdf_analyses"] = pdf_analyses
    email.ps_attachments = json.dumps(ps)
    db.commit()
