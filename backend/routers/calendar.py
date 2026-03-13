from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import CalendarEvent, UserSetting
from schemas import CalendarEventOut, CalendarInfo
from services import google_oauth, calendar_service, claude_service, notification

router = APIRouter()


@router.get("", response_model=list[CalendarEventOut])
def list_events(
    days_ahead: int = Query(90, le=365),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() + timedelta(days=days_ahead)

    # Only return events from the currently selected calendar
    setting = db.query(UserSetting).filter_by(key="selected_calendar_id").first()
    selected_cal = setting.value if setting and setting.value else None

    query = db.query(CalendarEvent).filter(CalendarEvent.start_datetime <= cutoff)
    if selected_cal:
        query = query.filter(CalendarEvent.source_calendar_id == selected_cal)

    return query.order_by(CalendarEvent.start_datetime.asc()).all()


@router.get("/list", response_model=list[CalendarInfo])
def list_user_calendars(db: Session = Depends(get_db)):
    """Return all Google Calendars the connected account has access to."""
    creds = google_oauth.get_credentials(db)
    if not creds:
        return []
    return calendar_service.list_calendars(creds)


@router.delete("/events")
def clear_calendar_events(db: Session = Depends(get_db)):
    """Delete all stored calendar events so the next scan fetches fresh ones."""
    deleted = db.query(CalendarEvent).delete()
    db.commit()
    return {"deleted": deleted}


@router.post("/sync")
def sync_calendar(db: Session = Depends(get_db)):
    creds = google_oauth.get_credentials(db)
    if not creds:
        return {"message": "Google account not connected", "events_fetched": 0, "action_items_created": 0}

    setting = db.query(UserSetting).filter_by(key="selected_calendar_id").first()
    calendar_id = setting.value if setting and setting.value else "primary"

    # Remove any events that came from a different (or unknown) calendar — keeps the
    # DB in sync when the user changes their selected calendar.
    stale = db.query(CalendarEvent).filter(
        (CalendarEvent.source_calendar_id == None) |  # noqa: E711
        (CalendarEvent.source_calendar_id != calendar_id)
    ).all()
    for evt in stale:
        db.delete(evt)
    if stale:
        db.commit()

    new_events = calendar_service.fetch_upcoming_events(creds, db, calendar_id=calendar_id)

    all_events = db.query(CalendarEvent).filter(
        CalendarEvent.source_calendar_id == calendar_id
    ).all()
    new_items = claude_service.crossref_calendar(all_events, db) if all_events else []
    for item in new_items:
        notification.create_reminder_for_item(item, db)

    return {
        "message": f"Synced {len(new_events)} new events, created {len(new_items)} action items",
        "events_fetched": len(new_events),
        "action_items_created": len(new_items),
    }
