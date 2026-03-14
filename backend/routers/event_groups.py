from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import EventGroup, ActionItem
from schemas import EventGroupOut, EventGroupUpdate
from services.grouping_service import recluster_all

router = APIRouter()


def _build_out(group: EventGroup) -> EventGroupOut:
    """Attach derived fields to an EventGroup before returning it."""
    items = group.items or []
    all_completed = bool(items) and all(i.completed for i in items)
    has_short_notice = any(i.is_short_notice for i in items)
    prep_dates = [i.prep_start_date for i in items if i.prep_start_date is not None]
    earliest_prep = min(prep_dates) if prep_dates else None

    return EventGroupOut(
        id=group.id,
        display_name=group.display_name,
        event_date=group.event_date,
        created_at=group.created_at,
        updated_at=group.updated_at,
        items=items,
        all_completed=all_completed,
        has_short_notice=has_short_notice,
        earliest_prep_start_date=earliest_prep,
    )


@router.get("", response_model=list[EventGroupOut])
def list_event_groups(
    event_date_from: Optional[date] = None,
    event_date_to: Optional[date] = None,
    include_completed: bool = False,
    db: Session = Depends(get_db),
):
    """Return EventGroups with their nested ActionItems, sorted by event_date asc."""
    q = db.query(EventGroup).options(selectinload(EventGroup.items))

    if event_date_from is not None:
        q = q.filter(EventGroup.event_date >= event_date_from)
    if event_date_to is not None:
        q = q.filter(EventGroup.event_date <= event_date_to)

    groups = q.order_by(EventGroup.event_date.asc(), EventGroup.display_name.asc()).all()

    # Pre-filter completed groups in Python before calling _build_out to avoid
    # building full EventGroupOut objects for groups that will be discarded.
    if not include_completed:
        groups = [g for g in groups if not (g.items and all(i.completed for i in g.items))]

    return [_build_out(g) for g in groups]


@router.post("/recluster")
def recluster(db: Session = Depends(get_db)):
    """Recompute EventGroup assignments for all ActionItems. Idempotent."""
    n = recluster_all(db)
    return {"groups_updated": n}


@router.get("/{group_id}", response_model=EventGroupOut)
def get_event_group(group_id: int, db: Session = Depends(get_db)):
    group = db.query(EventGroup).options(selectinload(EventGroup.items)).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Event group not found")
    return _build_out(group)


@router.patch("/{group_id}", response_model=EventGroupOut)
def update_event_group(
    group_id: int,
    update: EventGroupUpdate,
    db: Session = Depends(get_db),
):
    """Update the display name of an event group (user-editable canonical title)."""
    group = db.query(EventGroup).options(selectinload(EventGroup.items)).get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Event group not found")

    group.display_name = update.display_name
    db.commit()
    db.refresh(group)
    return _build_out(group)
