from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import asc, desc

from database import get_db
from models import ActionItem
from schemas import ActionItemOut, ActionItemUpdate

router = APIRouter()


@router.get("", response_model=list[ActionItemOut])
def list_action_items(
    completed: Optional[bool] = None,
    is_short_notice: Optional[bool] = None,
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
    db.delete(item)
    db.commit()
    return {"message": "Deleted"}
