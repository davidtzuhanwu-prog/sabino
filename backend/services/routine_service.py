"""Routine generation service — creates DailyPlanItems from DailyRoutines."""
import json
import logging
from datetime import date, datetime

from sqlalchemy.orm import Session

from models import DailyRoutine, DailyPlanItem, ActionItem, MyDaySettings

logger = logging.getLogger(__name__)

# Weekday number mapping (Python: Mon=0 … Sun=6 → spec uses Sun=0 … Sat=6)
_PY_TO_SPEC = {0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 0}


def _routine_applies(routine: DailyRoutine, target: date) -> bool:
    """Return True if this routine should fire on target date."""
    spec_dow = _PY_TO_SPEC[target.weekday()]  # 0=Sun … 6=Sat
    if routine.recurrence == "daily":
        return True
    if routine.recurrence == "weekdays":
        return spec_dow in (1, 2, 3, 4, 5)
    if routine.recurrence == "weekends":
        return spec_dow in (0, 6)
    if routine.recurrence == "custom" and routine.custom_days:
        try:
            days = json.loads(routine.custom_days)
            return spec_dow in days
        except Exception:
            return False
    return False


def generate_items_for_date(db: Session, target: date) -> int:
    """Generate DailyPlanItems from active routines for target date. Idempotent.

    Returns the number of new items created.
    """
    routines = db.query(DailyRoutine).filter(DailyRoutine.active == True).all()  # noqa: E712
    created = 0
    for routine in routines:
        if not _routine_applies(routine, target):
            continue
        # Idempotency check
        existing = db.query(DailyPlanItem).filter(
            DailyPlanItem.routine_id == routine.id,
            DailyPlanItem.scheduled_date == target,
        ).first()
        if existing:
            continue
        item = DailyPlanItem(
            title=routine.title,
            emoji=routine.emoji,
            scheduled_date=target,
            start_time=routine.start_time,
            duration_minutes=routine.duration_minutes,
            category=routine.category,
            notes=routine.notes,
            routine_id=routine.id,
            sort_order=0,
        )
        db.add(item)
        created += 1
    if created:
        db.commit()
        logger.info("Generated %d plan item(s) from routines for %s", created, target)
    return created


def import_action_items_for_date(db: Session, target: date) -> int:
    """Import unlinked ActionItems with event_date == target into DailyPlanItems.

    Returns the number of new items imported.
    """
    # Find ActionItems for this date not yet linked to a plan item
    linked_ids = {
        row[0] for row in db.query(DailyPlanItem.source_action_item_id)
        .filter(
            DailyPlanItem.scheduled_date == target,
            DailyPlanItem.source_action_item_id != None,  # noqa: E711
        ).all()
        if row[0] is not None
    }

    action_items = db.query(ActionItem).filter(
        ActionItem.event_date == target,
        ActionItem.completed == False,  # noqa: E712
    ).all()

    created = 0
    for ai in action_items:
        if ai.id in linked_ids:
            continue
        # Determine category & default start time from item_type
        if ai.item_type and ai.item_type.startswith("homework_"):
            category = "homework"
            start_time = "15:30"
        else:
            category = "afterschool"
            start_time = "15:00"

        item = DailyPlanItem(
            title=ai.title,
            emoji=_emoji_for_category(category),
            scheduled_date=target,
            start_time=start_time,
            duration_minutes=20,
            category=category,
            notes=ai.description,
            source_action_item_id=ai.id,
            sort_order=0,
        )
        db.add(item)
        created += 1

    if created:
        db.commit()
        logger.info("Imported %d action item(s) into My Day for %s", created, target)
    return created


def _emoji_for_category(category: str) -> str:
    return {
        "morning_routine": "☀️",
        "school": "🏫",
        "homework": "📝",
        "afterschool": "🏃",
        "evening_routine": "🌙",
        "meal": "🍽️",
    }.get(category, "📋")


def get_or_create_settings(db: Session) -> MyDaySettings:
    settings = db.query(MyDaySettings).first()
    if not settings:
        settings = MyDaySettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings
