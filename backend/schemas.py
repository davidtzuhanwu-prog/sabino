from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ActionItemBase(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: Optional[date] = None
    prep_start_date: Optional[date] = None
    lead_time_days: Optional[int] = None
    is_short_notice: bool = False
    short_notice_note: Optional[str] = None
    completed: bool = False
    source_type: str


class ActionItemCreate(ActionItemBase):
    source_email_id: Optional[int] = None
    source_event_id: Optional[int] = None


class ActionItemUpdate(BaseModel):
    completed: Optional[bool] = None
    prep_start_date: Optional[date] = None
    event_date: Optional[date] = None
    title: Optional[str] = None
    description: Optional[str] = None


class ActionItemOut(ActionItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_email_id: Optional[int] = None
    source_event_id: Optional[int] = None
    event_group_id: Optional[int] = None
    created_at: datetime


class EventGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
    event_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime
    items: list[ActionItemOut] = []

    # Derived fields — computed in the router from the items list, not stored in DB
    all_completed: bool = False
    has_short_notice: bool = False
    earliest_prep_start_date: Optional[date] = None


class EventGroupUpdate(BaseModel):
    display_name: str


class EmailKeyPoints(BaseModel):
    summary: str = ""
    dates: list[dict] = []
    requirements: list[str] = []


class EmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    gmail_message_id: str
    sender: Optional[str] = None
    subject: Optional[str] = None
    body_plain: Optional[str] = None
    key_points: Optional[str] = None  # Raw JSON string; parsed by frontend
    audience: Optional[str] = None    # Extracted ParentSquare groups, e.g. "KHe,KH"
    received_at: Optional[datetime] = None
    analyzed: bool
    created_at: datetime
    action_items: list[ActionItemOut] = []


class CalendarEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    google_event_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    location: Optional[str] = None
    analyzed: bool
    created_at: datetime


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action_item_id: int
    remind_at: datetime
    channel: str
    status: str
    sent_at: Optional[datetime] = None
    created_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action_item_id: Optional[int] = None
    message: str
    status: str
    created_at: datetime


class AuthStatus(BaseModel):
    connected: bool
    email: Optional[str] = None
    scopes: list[str] = []


class ScanResult(BaseModel):
    emails_fetched: int
    action_items_created: int
    message: str


class CalendarInfo(BaseModel):
    id: str
    name: str
    primary: bool
    color: str


class SettingsOut(BaseModel):
    school_sender_domain: str
    school_gmail_labels: str
    poll_interval_hours: str
    reminder_channel: str
    reminder_email_address: str
    short_notice_threshold_days: str
    selected_calendar_id: str
    child_class_code: str      # e.g. "KHe" — the ParentSquare class code for the child
    child_grade_level: str     # e.g. "Kindergarten" — human-readable grade


class SettingsUpdate(BaseModel):
    school_sender_domain: Optional[str] = None
    school_gmail_labels: Optional[str] = None
    poll_interval_hours: Optional[str] = None
    reminder_channel: Optional[str] = None
    reminder_email_address: Optional[str] = None
    short_notice_threshold_days: Optional[str] = None
    selected_calendar_id: Optional[str] = None
    child_class_code: Optional[str] = None
    child_grade_level: Optional[str] = None
