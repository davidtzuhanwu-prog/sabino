from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import UserSetting
from schemas import SettingsOut, SettingsUpdate

router = APIRouter()

SETTING_KEYS = [
    "school_sender_domain",
    "school_gmail_labels",
    "poll_interval_hours",
    "reminder_channel",
    "reminder_email_address",
    "short_notice_threshold_days",
    "child_class_code",
    "child_grade_level",
    "ps_session_cookie",
]


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(UserSetting).all()
    data = {r.key: r.value or "" for r in rows}
    # Fill missing keys with defaults
    defaults = {
        "school_sender_domain": "",
        "school_gmail_labels": "[]",
        "poll_interval_hours": "6",
        "reminder_channel": "browser",
        "reminder_email_address": "",
        "short_notice_threshold_days": "7",
        "selected_calendar_id": "primary",
        "child_class_code": "",
        "child_grade_level": "",
        "ps_session_cookie": "",
    }
    for k, v in defaults.items():
        data.setdefault(k, v)
    return SettingsOut(**{k: data.get(k, "") for k in SettingsOut.model_fields})


@router.put("", response_model=SettingsOut)
def update_settings(update: SettingsUpdate, db: Session = Depends(get_db)):
    for field, value in update.model_dump(exclude_unset=True, exclude_none=True).items():
        setting = db.query(UserSetting).filter_by(key=field).first()
        if setting:
            setting.value = value
        else:
            db.add(UserSetting(key=field, value=value))
    db.commit()
    return get_settings(db)
