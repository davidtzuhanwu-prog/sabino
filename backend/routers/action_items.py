from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc, desc

from database import get_db
from models import ActionItem, EventGroup
from schemas import ActionItemOut, ActionItemCreate, ActionItemUpdate

router = APIRouter()


@router.post("", response_model=ActionItemOut, status_code=201)
def create_action_item(body: ActionItemCreate, db: Session = Depends(get_db)):
    """Create a manual action item. source_type must be 'manual'.
    Pass event_group_id to attach to an existing EventGroup, or leave it null
    for a standalone item (it won't appear in any merged cluster).
    """
    if body.source_type != "manual":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="source_type must be 'manual' for manual creation")

    # Validate event_group_id if provided
    if body.event_group_id is not None:
        group = db.query(EventGroup).get(body.event_group_id)
        if not group:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Event group not found")

    item = ActionItem(
        source_type=body.source_type,
        source_email_id=None,
        source_event_id=None,
        event_group_id=body.event_group_id,
        title=body.title,
        description=body.description,
        event_date=body.event_date,
        prep_start_date=body.prep_start_date,
        lead_time_days=body.lead_time_days,
        is_short_notice=body.is_short_notice,
        short_notice_note=body.short_notice_note,
        completed=body.completed,
        item_type=body.item_type,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("", response_model=list[ActionItemOut])
def list_action_items(
    completed: Optional[bool] = None,
    is_short_notice: Optional[bool] = None,
    item_type: Optional[str] = Query(None, description="Filter by item_type, e.g. 'homework_spelling' or prefix 'homework_'"),
    sort_by: str = Query("event_date", enum=["event_date", "prep_start_date", "created_at"]),
    order: str = Query("asc", enum=["asc", "desc"]),
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(ActionItem)
    if completed is not None:
        q = q.filter(ActionItem.completed == completed)
    if is_short_notice is not None:
        q = q.filter(ActionItem.is_short_notice == is_short_notice)
    if item_type is not None:
        if item_type.endswith("_"):
            # Prefix match: e.g. "homework_" matches all homework subtypes
            q = q.filter(ActionItem.item_type.like(f"{item_type}%"))
        else:
            q = q.filter(ActionItem.item_type == item_type)

    sort_col = getattr(ActionItem, sort_by)
    q = q.order_by(asc(sort_col) if order == "asc" else desc(sort_col))
    return q.offset(offset).limit(limit).all()


@router.get("/upcoming", response_model=list[ActionItemOut])
def upcoming_items(days: int = 14, db: Session = Depends(get_db)):
    from datetime import date, timedelta
    cutoff = date.today() + timedelta(days=days)
    return (
        db.query(ActionItem)
        .filter(
            ActionItem.completed == False,  # noqa: E712
            ActionItem.event_date != None,  # noqa: E711
            ActionItem.event_date <= cutoff,
        )
        .order_by(ActionItem.event_date.asc())
        .all()
    )


@router.get("/short-notice", response_model=list[ActionItemOut])
def short_notice_items(db: Session = Depends(get_db)):
    return (
        db.query(ActionItem)
        .filter(ActionItem.is_short_notice == True)  # noqa: E712
        .order_by(ActionItem.created_at.desc())
        .all()
    )


@router.get("/{item_id}", response_model=ActionItemOut)
def get_action_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(ActionItem).get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found")
    return item


@router.patch("/{item_id}", response_model=ActionItemOut)
def update_action_item(item_id: int, update: ActionItemUpdate, db: Session = Depends(get_db)):
    item = db.query(ActionItem).get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found")

    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_action_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(ActionItem).get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found")
    if item.source_type != "manual":
        raise HTTPException(status_code=403, detail="Only manually-created action items can be deleted")
    group_id = item.event_group_id
    db.delete(item)
    db.commit()
    # If the EventGroup is now empty and was manual, delete it too
    if group_id is not None:
        group = db.query(EventGroup).get(group_id)
        if group and not group.items:
            db.delete(group)
            db.commit()
    return {"message": "Deleted"}
