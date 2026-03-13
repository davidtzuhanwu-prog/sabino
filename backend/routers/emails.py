import json
from datetime import datetime
from typing import Optional, Generator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Email, CalendarEvent, UserSetting
from schemas import EmailOut, ScanResult
from services import google_oauth, gmail_service, calendar_service, claude_service, notification

router = APIRouter()

_scanning = False
_last_scan_at: Optional[datetime] = None

# Settings keys used to persist scan timestamps across restarts
_KEY_EMAIL_SCAN = "last_email_scan_at"
_KEY_CALENDAR_SCAN = "last_calendar_scan_at"


def _persist_scan_time(db: Session, key: str, dt: datetime) -> None:
    """Store a scan timestamp in UserSetting so it survives server restarts."""
    row = db.query(UserSetting).filter_by(key=key).first()
    iso = dt.isoformat()
    if row:
        row.value = iso
    else:
        db.add(UserSetting(key=key, value=iso))
    db.commit()


def _load_scan_time(db: Session, key: str) -> Optional[datetime]:
    row = db.query(UserSetting).filter_by(key=key).first()
    if row and row.value:
        try:
            return datetime.fromisoformat(row.value)
        except ValueError:
            return None
    return None


def _sse(event: str, data: dict) -> str:
    """Format a single SSE message."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("", response_model=list[EmailOut])
def list_emails(
    analyzed: Optional[bool] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Email)
    if analyzed is not None:
        q = q.filter(Email.analyzed == analyzed)
    return q.order_by(Email.received_at.desc()).offset(offset).limit(limit).all()


@router.get("/scan/status")
def scan_status(db: Session = Depends(get_db)):
    email_dt = _load_scan_time(db, _KEY_EMAIL_SCAN)
    calendar_dt = _load_scan_time(db, _KEY_CALENDAR_SCAN)
    return {
        "scanning": _scanning,
        "last_scan_at": _last_scan_at.isoformat() if _last_scan_at else None,
        "last_email_scan_at": email_dt.isoformat() if email_dt else None,
        "last_calendar_scan_at": calendar_dt.isoformat() if calendar_dt else None,
    }


@router.get("/scan/stream")
def scan_stream(db: Session = Depends(get_db)):
    """SSE endpoint — streams progress events while a scan runs."""
    global _scanning, _last_scan_at

    def generate() -> Generator[str, None, None]:
        global _scanning, _last_scan_at

        if _scanning:
            yield _sse("error", {"message": "Scan already in progress"})
            return

        _scanning = True
        try:
            yield _sse("progress", {"step": "auth", "message": "Checking Google credentials…"})

            creds = google_oauth.get_credentials(db)
            if not creds:
                yield _sse("error", {"message": "Google account not connected"})
                return

            # Settings
            domain_setting = db.query(UserSetting).filter_by(key="school_sender_domain").first()
            sender_domain = domain_setting.value if domain_setting else ""
            labels_setting = db.query(UserSetting).filter_by(key="school_gmail_labels").first()
            labels = json.loads(labels_setting.value) if labels_setting and labels_setting.value else []

            # Fetch emails
            yield _sse("progress", {"step": "fetch", "message": "Fetching emails from Gmail…"})
            new_emails = gmail_service.fetch_school_emails(creds, db, sender_domain, labels)
            yield _sse("progress", {"step": "fetch_done", "message": f"Found {len(new_emails)} new email(s)"})

            # Analyze unanalyzed emails
            unanalyzed = db.query(Email).filter(Email.analyzed == False).all()  # noqa: E712
            total_items = 0
            for i, email in enumerate(unanalyzed, 1):
                subject = email.subject or "(no subject)"

                yield _sse("progress", {
                    "step": "summarize",
                    "message": f"[{i}/{len(unanalyzed)}] Summarizing: {subject[:60]}",
                })
                claude_service.summarize_email(email, db)

                yield _sse("progress", {
                    "step": "analyze",
                    "message": f"[{i}/{len(unanalyzed)}] Extracting action items: {subject[:60]}",
                })
                items = claude_service.analyze_email(email, db)
                for item in items:
                    notification.create_reminder_for_item(item, db)
                total_items += len(items)

                yield _sse("progress", {
                    "step": "email_done",
                    "message": f"[{i}/{len(unanalyzed)}] Done — {len(items)} action item(s) found",
                })

            # Backfill key_points for already-analyzed emails
            needs_summary = db.query(Email).filter(
                Email.analyzed == True, Email.key_points == None  # noqa: E711
            ).all()
            if needs_summary:
                yield _sse("progress", {
                    "step": "backfill",
                    "message": f"Generating summaries for {len(needs_summary)} older email(s)…",
                })
                for i, email in enumerate(needs_summary, 1):
                    subject = email.subject or "(no subject)"
                    yield _sse("progress", {
                        "step": "backfill_item",
                        "message": f"[{i}/{len(needs_summary)}] Summarizing: {subject[:60]}",
                    })
                    claude_service.summarize_email(email, db)

            # Persist email scan time
            email_scan_dt = datetime.utcnow()
            _persist_scan_time(db, _KEY_EMAIL_SCAN, email_scan_dt)

            # Sync calendar using whichever calendar the user selected
            cal_setting = db.query(UserSetting).filter_by(key="selected_calendar_id").first()
            calendar_id = cal_setting.value if cal_setting and cal_setting.value else "primary"
            yield _sse("progress", {"step": "calendar_fetch", "message": f"Syncing calendar '{calendar_id}'…"})
            new_events = calendar_service.fetch_upcoming_events(creds, db, calendar_id=calendar_id)
            yield _sse("progress", {
                "step": "calendar_done",
                "message": f"Synced {len(new_events)} new calendar event(s)",
            })

            # Cross-reference calendar events with action items
            all_events = db.query(CalendarEvent).all()
            if all_events:
                yield _sse("progress", {"step": "crossref", "message": "Cross-referencing calendar with action items…"})
                new_cal_items = claude_service.crossref_calendar(all_events, db)
                for item in new_cal_items:
                    notification.create_reminder_for_item(item, db)
                total_items += len(new_cal_items)
                if new_cal_items:
                    yield _sse("progress", {
                        "step": "crossref_done",
                        "message": f"Found {len(new_cal_items)} new action item(s) from calendar",
                    })

            # Persist calendar scan time
            cal_scan_dt = datetime.utcnow()
            _persist_scan_time(db, _KEY_CALENDAR_SCAN, cal_scan_dt)

            _last_scan_at = datetime.utcnow()
            yield _sse("done", {
                "emails_fetched": len(new_emails),
                "action_items_created": total_items,
                "message": f"Scan complete — {len(new_emails)} email(s), {len(new_events)} calendar event(s), {total_items} action item(s)",
            })

        except Exception as e:
            yield _sse("error", {"message": str(e)})
        finally:
            _scanning = False

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/scan", response_model=ScanResult)
def trigger_scan(db: Session = Depends(get_db)):
    global _scanning, _last_scan_at
    if _scanning:
        return ScanResult(emails_fetched=0, action_items_created=0, message="Scan already in progress")

    _scanning = True
    try:
        creds = google_oauth.get_credentials(db)
        if not creds:
            return ScanResult(emails_fetched=0, action_items_created=0, message="Google account not connected")

        domain_setting = db.query(UserSetting).filter_by(key="school_sender_domain").first()
        sender_domain = domain_setting.value if domain_setting else ""
        labels_setting = db.query(UserSetting).filter_by(key="school_gmail_labels").first()
        labels = json.loads(labels_setting.value) if labels_setting and labels_setting.value else []

        new_emails = gmail_service.fetch_school_emails(creds, db, sender_domain, labels)

        unanalyzed = db.query(Email).filter(Email.analyzed == False).all()  # noqa: E712
        total_items = 0
        for email in unanalyzed:
            claude_service.summarize_email(email, db)
            items = claude_service.analyze_email(email, db)
            for item in items:
                notification.create_reminder_for_item(item, db)
            total_items += len(items)

        needs_summary = db.query(Email).filter(
            Email.analyzed == True, Email.key_points == None  # noqa: E711
        ).all()
        for email in needs_summary:
            claude_service.summarize_email(email, db)

        _persist_scan_time(db, _KEY_EMAIL_SCAN, datetime.utcnow())

        cal_setting = db.query(UserSetting).filter_by(key="selected_calendar_id").first()
        calendar_id = cal_setting.value if cal_setting and cal_setting.value else "primary"
        new_events = calendar_service.fetch_upcoming_events(creds, db, calendar_id=calendar_id)
        all_events = db.query(CalendarEvent).all()
        if all_events:
            new_cal_items = claude_service.crossref_calendar(all_events, db)
            for item in new_cal_items:
                notification.create_reminder_for_item(item, db)
            total_items += len(new_cal_items)

        _persist_scan_time(db, _KEY_CALENDAR_SCAN, datetime.utcnow())
        _last_scan_at = datetime.utcnow()
        return ScanResult(
            emails_fetched=len(new_emails),
            action_items_created=total_items,
            message=f"Fetched {len(new_emails)} emails, {len(new_events)} calendar events, {total_items} action items",
        )
    finally:
        _scanning = False


@router.get("/{email_id}", response_model=EmailOut)
def get_email(email_id: int, db: Session = Depends(get_db)):
    email = db.query(Email).get(email_id)
    if not email:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Email not found")
    return email
