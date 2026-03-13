from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Reminder, Notification
from schemas import ReminderOut, NotificationOut

router = APIRouter()


@router.get("", response_model=list[ReminderOut])
def list_reminders(db: Session = Depends(get_db)):
    return db.query(Reminder).order_by(Reminder.remind_at.asc()).all()


@router.get("/notifications", response_model=list[NotificationOut])
def get_pending_notifications(db: Session = Depends(get_db)):
    return (
        db.query(Notification)
        .filter(Notification.status == "pending")
        .order_by(Notification.created_at.desc())
        .all()
    )


@router.post("/notifications/{notif_id}/dismiss")
def dismiss_notification(notif_id: int, db: Session = Depends(get_db)):
    notif = db.query(Notification).get(notif_id)
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.status = "dismissed"
    db.commit()
    return {"message": "Dismissed"}
