import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Optional

import anthropic
from sqlalchemy.orm import Session

from config import settings
from models import ActionItem, Email, CalendarEvent, UserSetting

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _call_claude(prompt: str, max_tokens: int = 2048) -> str:
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw


def _get_threshold(db: Session) -> int:
    setting = db.query(UserSetting).filter_by(key="short_notice_threshold_days").first()
    return int(setting.value) if setting and setting.value else 7


def _build_email_analysis_prompt(
    subject: str,
    body: str,
    received_date: str,
    today: str,
    threshold: int,
) -> str:
    return f"""You are a school-parent communication assistant. Analyze the following email from a school and extract any action items that require a parent to prepare something.

TODAY'S DATE: {today}
EMAIL RECEIVED DATE: {received_date}

EMAIL SUBJECT: {subject}

EMAIL BODY:
{body[:4000]}

---

Your task:
1. Identify every action item that requires parent preparation. Examples include:
   - Bringing items to school (food, supplies, materials, costumes, instruments)
   - Wearing specific clothes or costumes
   - Completing a project or homework by a deadline
   - Making a purchase or reservation
   - Signing and returning forms or permission slips
   - Attending a school event (parent attendance required)
   - Making a payment or donation
   - Scheduling an appointment

2. For each action item, provide:
   - title: A short, clear description (max 10 words)
   - description: Full detail extracted from the email
   - event_date: The actual date of the event or deadline (YYYY-MM-DD). If no year is given, assume the upcoming occurrence relative to today. If truly unknown, use null.
   - prep_start_date: The date the parent should START preparing. Use this logic:
     * For items requiring purchases, baking, or crafting: 5-7 days before event_date
     * For signing/returning forms: 2 days before event_date
     * For wearing specific clothes the parent likely already owns: 1 day before event_date
     * For large projects (science fair, dioramas, presentations): 14 days before event_date
     * For scheduling appointments: 7 days before event_date
     * NEVER suggest a prep_start_date in the past. If it would be past, use tomorrow ({(datetime.strptime(today, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')}).
     * If event_date is null, suggest a reasonable date starting tomorrow.
   - lead_time_days: Integer. Days between the email received date and the event_date. Use null if event_date is unknown.
   - is_short_notice: true if lead_time_days < {threshold} AND lead_time_days is not null, false otherwise.
   - short_notice_note: If is_short_notice is true, write one sentence explaining why this is problematic (e.g., "School gave only 3 days to source and bake items for the party."). If is_short_notice is false, use null.

3. If the email contains NO action items requiring parent preparation, return an empty list.

Return ONLY valid JSON, no prose, no code fences:
{{
  "action_items": [
    {{
      "title": "string",
      "description": "string",
      "event_date": "YYYY-MM-DD or null",
      "prep_start_date": "YYYY-MM-DD",
      "lead_time_days": integer_or_null,
      "is_short_notice": boolean,
      "short_notice_note": "string or null"
    }}
  ]
}}"""


def _build_calendar_crossref_prompt(
    calendar_events: list[dict],
    existing_action_items: list[dict],
    today: str,
) -> str:
    events_json = json.dumps(calendar_events, indent=2, default=str)
    items_json = json.dumps(existing_action_items, indent=2, default=str)
    return f"""You are a school-parent communication assistant. Cross-reference upcoming calendar events with known action items.

TODAY'S DATE: {today}

UPCOMING CALENDAR EVENTS (next 90 days):
{events_json}

EXISTING ACTION ITEMS EXTRACTED FROM EMAILS:
{items_json}

Tasks:
1. For any calendar event that clearly requires parent preparation (e.g., "Science Fair", "Costume Day", "Bake Sale", "Field Trip", "Picture Day", "Holiday Concert", "Book Fair") and does NOT already have a corresponding action item in the existing list, create a new action item.

2. For any existing action item with a null event_date, check if a matching calendar event exists and provide a correction.

3. Do NOT duplicate items already in the existing list.

4. If an existing action item's event_date doesn't match its calendar event, provide a correction.

Return ONLY valid JSON:
{{
  "new_action_items": [
    {{
      "title": "string",
      "description": "string",
      "event_date": "YYYY-MM-DD or null",
      "prep_start_date": "YYYY-MM-DD",
      "lead_time_days": null,
      "is_short_notice": false,
      "short_notice_note": null,
      "source_type": "calendar"
    }}
  ],
  "date_corrections": [
    {{
      "action_item_id": integer,
      "corrected_event_date": "YYYY-MM-DD",
      "corrected_prep_start_date": "YYYY-MM-DD"
    }}
  ]
}}"""


def _build_key_points_prompt(subject: str, body: str) -> str:
    return f"""You are a school-parent communication assistant. Read the following school email and extract the key information a parent needs to know at a glance.

EMAIL SUBJECT: {subject}

EMAIL BODY:
{body[:4000]}

---

Extract and return ONLY valid JSON with this exact shape:
{{
  "summary": "2-3 sentence plain-English summary of what this email is about",
  "dates": [
    {{
      "label": "Short label (e.g. 'Field Trip', 'Permission Slip Due', 'Picture Day')",
      "date": "Human-readable date string from the email (e.g. 'Friday, March 14' or 'March 14, 2025'). Use null if no specific date."
    }}
  ],
  "requirements": [
    "One concise sentence per thing the parent needs to do or provide"
  ]
}}

Rules:
- "dates" should only include concrete dates or deadlines mentioned in the email. Empty array if none.
- "requirements" should only include actionable items for the parent. Empty array if none.
- Keep all text concise and parent-friendly.
- Return ONLY the JSON object, no prose, no code fences."""


def summarize_email(email: Email, db: Session) -> None:
    """Generate key points for an email and save them as JSON to email.key_points."""
    if not email.body_plain and not email.subject:
        return

    prompt = _build_key_points_prompt(
        subject=email.subject or "(no subject)",
        body=email.body_plain or "",
    )

    try:
        raw = _call_claude(prompt, max_tokens=1024)
        data = json.loads(raw)
        data.setdefault("summary", "")
        data.setdefault("dates", [])
        data.setdefault("requirements", [])
        email.key_points = json.dumps(data)
        db.commit()
    except Exception as e:
        logger.warning("Key points extraction failed for email %s (%s): %s", email.id, email.subject, e)
        from routers.errors import record_error
        record_error("claude_key_points", f"Email '{email.subject}': {e}")


def analyze_email(email: Email, db: Session) -> list[ActionItem]:
    threshold = _get_threshold(db)
    today = date.today().isoformat()
    received = email.received_at.date().isoformat() if email.received_at else today

    prompt = _build_email_analysis_prompt(
        subject=email.subject or "(no subject)",
        body=email.body_plain or "",
        received_date=received,
        today=today,
        threshold=threshold,
    )

    try:
        raw = _call_claude(prompt)
        data = json.loads(raw)
        items_data = data.get("action_items", [])
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(
            "Claude response parse failed for email %s (%s): %s — retrying",
            email.id, email.subject, e,
        )
        from routers.errors import record_error
        record_error("claude_parse", f"Email '{email.subject}': {e} — retrying")
        retry_prompt = prompt + "\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY the JSON object, nothing else."
        try:
            raw = _call_claude(retry_prompt)
            data = json.loads(raw)
            items_data = data.get("action_items", [])
        except Exception as retry_err:
            logger.error(
                "Claude retry also failed for email %s (%s): %s",
                email.id, email.subject, retry_err, exc_info=True,
            )
            record_error("claude_parse", f"Email '{email.subject}': retry failed — {retry_err}")
            return []

    created = []
    for item_data in items_data:
        action_item = ActionItem(
            source_type="email",
            source_email_id=email.id,
            title=item_data.get("title", "Untitled"),
            description=item_data.get("description"),
            event_date=_parse_date(item_data.get("event_date")),
            prep_start_date=_parse_date(item_data.get("prep_start_date")),
            lead_time_days=item_data.get("lead_time_days"),
            is_short_notice=item_data.get("is_short_notice", False),
            short_notice_note=item_data.get("short_notice_note"),
        )
        db.add(action_item)
        created.append(action_item)

    email.analyzed = True
    db.commit()
    for item in created:
        db.refresh(item)
    return created


def crossref_calendar(
    calendar_events: list[CalendarEvent],
    db: Session,
) -> list[ActionItem]:
    today_dt = date.today()
    today = today_dt.isoformat()

    # Slim the payload: future events only, title+start only (no description), cap at 50
    future_events = [
        e for e in calendar_events
        if e.start_datetime and e.start_datetime.date() >= today_dt
    ]
    future_events.sort(key=lambda e: e.start_datetime)
    events_data = [
        {
            "id": e.id,
            "title": e.title or "(no title)",
            "start": e.start_datetime.date().isoformat() if e.start_datetime else None,
        }
        for e in future_events[:50]
    ]

    # Get existing action items
    existing = db.query(ActionItem).filter(ActionItem.completed == False).all()  # noqa: E712
    existing_data = [
        {
            "id": a.id,
            "title": a.title,
            "event_date": a.event_date.isoformat() if a.event_date else None,
        }
        for a in existing
    ]

    if not events_data:
        return []

    prompt = _build_calendar_crossref_prompt(events_data, existing_data, today)

    try:
        raw = _call_claude(prompt, max_tokens=4096)
        data = json.loads(raw)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(
            "Calendar cross-reference parse failed: %s — retrying with reduced payload", e
        )
        from routers.errors import record_error
        record_error("calendar_crossref", f"Calendar cross-reference failed (retrying): {e}")

        # Retry: cut events list in half and add explicit JSON reminder
        retry_events = events_data[:25]
        retry_prompt = (
            _build_calendar_crossref_prompt(retry_events, existing_data, today)
            + "\n\nIMPORTANT: Your previous response was not valid JSON. "
            "Return ONLY the JSON object with keys 'new_action_items' and 'date_corrections'. "
            "No prose, no code fences, no trailing commas."
        )
        try:
            raw = _call_claude(retry_prompt, max_tokens=4096)
            data = json.loads(raw)
        except Exception as retry_err:
            logger.error(
                "Calendar cross-reference retry also failed: %s", retry_err, exc_info=True
            )
            record_error("calendar_crossref", f"Calendar cross-reference retry failed: {retry_err}")
            return []

    created = []
    for item_data in data.get("new_action_items", []):
        action_item = ActionItem(
            source_type=item_data.get("source_type", "calendar"),
            title=item_data.get("title", "Untitled"),
            description=item_data.get("description"),
            event_date=_parse_date(item_data.get("event_date")),
            prep_start_date=_parse_date(item_data.get("prep_start_date")),
            lead_time_days=item_data.get("lead_time_days"),
            is_short_notice=item_data.get("is_short_notice", False),
            short_notice_note=item_data.get("short_notice_note"),
        )
        db.add(action_item)
        created.append(action_item)

    for correction in data.get("date_corrections", []):
        item = db.query(ActionItem).get(correction["action_item_id"])
        if item:
            item.event_date = _parse_date(correction.get("corrected_event_date"))
            item.prep_start_date = _parse_date(correction.get("corrected_prep_start_date"))

    db.commit()
    for item in created:
        db.refresh(item)
    return created


def _parse_date(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None
