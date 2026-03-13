from datetime import datetime, timezone, timedelta
from typing import Optional

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from sqlalchemy.orm import Session

from models import CalendarEvent


def _build_service(creds: Credentials):
    return build("calendar", "v3", credentials=creds)


def _parse_datetime(dt_str: Optional[str], date_str: Optional[str]) -> Optional[datetime]:
    if dt_str:
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            return None
    if date_str:
        try:
            return datetime.strptime(date_str, "%Y-%m-%d")
        except Exception:
            return None
    return None


def list_calendars(creds: Credentials) -> list[dict]:
    """Return all calendars the user has access to."""
    service = _build_service(creds)
    result = service.calendarList().list().execute()
    calendars = []
    for item in result.get("items", []):
        calendars.append({
            "id": item["id"],
            "name": item.get("summary", item["id"]),
            "primary": item.get("primary", False),
            "color": item.get("backgroundColor", "#4285f4"),
        })
    # Sort: primary first, then alphabetically
    calendars.sort(key=lambda c: (not c["primary"], c["name"].lower()))
    return calendars


def fetch_upcoming_events(
    creds: Credentials,
    db: Session,
    calendar_id: str = "primary",
    days_ahead: int = 90,
) -> list[CalendarEvent]:
    service = _build_service(creds)

    now = datetime.utcnow()
    time_max = now + timedelta(days=days_ahead)

    response = service.events().list(
        calendarId=calendar_id,
        timeMin=now.isoformat() + "Z",
        timeMax=time_max.isoformat() + "Z",
        maxResults=250,
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = response.get("items", [])
    saved = []

    for evt in events:
        evt_id = evt["id"]

        existing = db.query(CalendarEvent).filter_by(google_event_id=evt_id).first()
        if existing:
            continue

        start = evt.get("start", {})
        end = evt.get("end", {})
        start_dt = _parse_datetime(start.get("dateTime"), start.get("date"))
        end_dt = _parse_datetime(end.get("dateTime"), end.get("date"))

        cal_event = CalendarEvent(
            google_event_id=evt_id,
            source_calendar_id=calendar_id,
            title=evt.get("summary", ""),
            description=evt.get("description", ""),
            start_datetime=start_dt,
            end_datetime=end_dt,
            location=evt.get("location", ""),
        )
        db.add(cal_event)
        saved.append(cal_event)

    db.commit()
    for e in saved:
        db.refresh(e)
    return saved
