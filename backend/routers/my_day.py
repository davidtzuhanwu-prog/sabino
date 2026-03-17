"""My Day API router — daily planner for kids."""
import logging
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import DailyPlanItem, DailyRoutine, MyDaySettings, ActionItem
from services.routine_service import (
    generate_items_for_date,
    import_action_items_for_date,
    get_or_create_settings,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Schemas ─────────────────────────────────────────────────────────────────

class PlanItemOut(BaseModel):
    id: int
    title: str
    emoji: Optional[str]
    scheduled_date: str
    start_time: str
    duration_minutes: int
    category: str
    notes: Optional[str]
    completed: bool
    completed_at: Optional[str]
    source_action_item_id: Optional[int]
    routine_id: Optional[int]
    sort_order: int

    model_config = {"from_attributes": True}


class PlanItemCreate(BaseModel):
    title: str
    emoji: Optional[str] = None
    scheduled_date: str
    start_time: str
    duration_minutes: int = 15
    category: str = "morning_routine"
    notes: Optional[str] = None
    sort_order: int = 0


class PlanItemUpdate(BaseModel):
    title: Optional[str] = None
    emoji: Optional[str] = None
    start_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class ReorderEntry(BaseModel):
    id: int
    start_time: str
    sort_order: int


class ReorderRequest(BaseModel):
    updates: List[ReorderEntry]


class ImportRequest(BaseModel):
    date: str


class RoutineOut(BaseModel):
    id: int
    title: str
    emoji: Optional[str]
    start_time: str
    duration_minutes: int
    category: str
    notes: Optional[str]
    recurrence: str
    custom_days: Optional[str]
    active: bool

    model_config = {"from_attributes": True}


class RoutineCreate(BaseModel):
    title: str
    emoji: Optional[str] = None
    start_time: str
    duration_minutes: int = 15
    category: str = "morning_routine"
    notes: Optional[str] = None
    recurrence: str = "daily"
    custom_days: Optional[str] = None
    active: bool = True


class RoutineUpdate(BaseModel):
    title: Optional[str] = None
    emoji: Optional[str] = None
    start_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    recurrence: Optional[str] = None
    custom_days: Optional[str] = None
    active: Optional[bool] = None


class SettingsOut(BaseModel):
    id: int
    pin_code: Optional[str]
    day_start_hour: int
    day_end_hour: int
    school_start_time: str
    school_end_time: str
    show_school_block: bool
    auto_import_action_items: bool

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    pin_code: Optional[str] = None
    day_start_hour: Optional[int] = None
    day_end_hour: Optional[int] = None
    school_start_time: Optional[str] = None
    school_end_time: Optional[str] = None
    show_school_block: Optional[bool] = None
    auto_import_action_items: Optional[bool] = None


class PinVerifyRequest(BaseModel):
    pin: str


def _item_out(item: DailyPlanItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "emoji": item.emoji,
        "scheduled_date": str(item.scheduled_date),
        "start_time": item.start_time,
        "duration_minutes": item.duration_minutes,
        "category": item.category,
        "notes": item.notes,
        "completed": item.completed,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "source_action_item_id": item.source_action_item_id,
        "routine_id": item.routine_id,
        "sort_order": item.sort_order,
    }


# ─── Daily Plan Items ─────────────────────────────────────────────────────────

@router.get("/items")
def get_items(date: str, db: Session = Depends(get_db)):
    """Get all plan items for a given date (YYYY-MM-DD)."""
    try:
        target = date_from_str(date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")

    items = (
        db.query(DailyPlanItem)
        .filter(DailyPlanItem.scheduled_date == target)
        .order_by(DailyPlanItem.start_time, DailyPlanItem.sort_order)
        .all()
    )

    # Auto-generate from routines if no items exist yet for this date
    if not items:
        settings = get_or_create_settings(db)
        n = generate_items_for_date(db, target)
        if settings.auto_import_action_items:
            import_action_items_for_date(db, target)
        if n > 0:
            items = (
                db.query(DailyPlanItem)
                .filter(DailyPlanItem.scheduled_date == target)
                .order_by(DailyPlanItem.start_time, DailyPlanItem.sort_order)
                .all()
            )

    total = len(items)
    completed_count = sum(1 for i in items if i.completed)

    return {
        "date": str(target),
        "items": [_item_out(i) for i in items],
        "progress": {"total": total, "completed": completed_count},
    }


@router.post("/items", status_code=201)
def create_item(body: PlanItemCreate, db: Session = Depends(get_db)):
    try:
        target = date_from_str(body.scheduled_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format.")
    item = DailyPlanItem(
        title=body.title,
        emoji=body.emoji,
        scheduled_date=target,
        start_time=body.start_time,
        duration_minutes=body.duration_minutes,
        category=body.category,
        notes=body.notes,
        sort_order=body.sort_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: PlanItemUpdate, db: Session = Depends(get_db)):
    item = db.query(DailyPlanItem).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(DailyPlanItem).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found.")
    db.delete(item)
    db.commit()


@router.patch("/items/{item_id}/complete")
def toggle_complete(item_id: int, db: Session = Depends(get_db)):
    item = db.query(DailyPlanItem).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found.")
    item.completed = not item.completed
    item.completed_at = datetime.utcnow() if item.completed else None

    # Two-way sync: if linked to an ActionItem, sync its completed state too
    if item.source_action_item_id:
        ai = db.query(ActionItem).get(item.source_action_item_id)
        if ai:
            ai.completed = item.completed

    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.post("/items/reorder")
def reorder_items(body: ReorderRequest, db: Session = Depends(get_db)):
    for entry in body.updates:
        item = db.query(DailyPlanItem).get(entry.id)
        if item:
            item.start_time = entry.start_time
            item.sort_order = entry.sort_order
    db.commit()
    return {"updated": len(body.updates)}


@router.post("/items/import")
def import_items(body: ImportRequest, db: Session = Depends(get_db)):
    try:
        target = date_from_str(body.date)
    except ValueError:
        raise HTTPException(400, "Invalid date format.")
    created = import_action_items_for_date(db, target)
    return {"created": created}


# ─── Routines ─────────────────────────────────────────────────────────────────

@router.get("/routines")
def list_routines(db: Session = Depends(get_db)):
    routines = db.query(DailyRoutine).order_by(DailyRoutine.start_time).all()
    return [_routine_out(r) for r in routines]


@router.post("/routines", status_code=201)
def create_routine(body: RoutineCreate, db: Session = Depends(get_db)):
    r = DailyRoutine(**body.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return _routine_out(r)


@router.patch("/routines/{routine_id}")
def update_routine(routine_id: int, body: RoutineUpdate, db: Session = Depends(get_db)):
    r = db.query(DailyRoutine).get(routine_id)
    if not r:
        raise HTTPException(404, "Routine not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(r, field, value)
    db.commit()
    db.refresh(r)
    return _routine_out(r)


@router.delete("/routines/{routine_id}", status_code=204)
def delete_routine(routine_id: int, db: Session = Depends(get_db)):
    r = db.query(DailyRoutine).get(routine_id)
    if not r:
        raise HTTPException(404, "Routine not found.")
    db.delete(r)
    db.commit()


@router.post("/routines/generate")
def generate_routines(date: str, db: Session = Depends(get_db)):
    try:
        target = date_from_str(date)
    except ValueError:
        raise HTTPException(400, "Invalid date format.")
    created = generate_items_for_date(db, target)
    return {"created": created, "date": str(target)}


def _routine_out(r: DailyRoutine) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "emoji": r.emoji,
        "start_time": r.start_time,
        "duration_minutes": r.duration_minutes,
        "category": r.category,
        "notes": r.notes,
        "recurrence": r.recurrence,
        "custom_days": r.custom_days,
        "active": r.active,
    }


# ─── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return _settings_out(s)


@router.put("/settings")
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return _settings_out(s)


@router.post("/settings/verify-pin")
def verify_pin(body: PinVerifyRequest, db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    if not s.pin_code:
        # No PIN set → always allow
        return {"valid": True}
    return {"valid": s.pin_code == body.pin}


def _settings_out(s: MyDaySettings) -> dict:
    return {
        "id": s.id,
        "pin_code": s.pin_code,
        "day_start_hour": s.day_start_hour,
        "day_end_hour": s.day_end_hour,
        "school_start_time": s.school_start_time,
        "school_end_time": s.school_end_time,
        "show_school_block": s.show_school_block,
        "auto_import_action_items": s.auto_import_action_items,
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def date_from_str(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()
