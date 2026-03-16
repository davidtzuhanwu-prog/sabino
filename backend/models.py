from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base


class EventGroup(Base):
    """A deduplicated grouping of ActionItems that share the same real-world event.

    Multiple ActionItems extracted from different emails or calendar events that all
    refer to the same real-world event (same event_date + similar titles) are grouped
    here. The display_name is user-editable and persisted.
    """
    __tablename__ = "event_groups"

    id           = Column(Integer, primary_key=True)
    display_name = Column(String, nullable=False)   # editable canonical name shown in UI
    event_date   = Column(Date, nullable=True)      # shared event date across all items
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    items = relationship("ActionItem", back_populates="event_group",
                         foreign_keys="ActionItem.event_group_id")


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    id = Column(Integer, primary_key=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime)
    scopes = Column(Text)
    user_email = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Email(Base):
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True)
    gmail_message_id = Column(String, unique=True, nullable=False)
    sender = Column(String)
    subject = Column(String)
    body_plain = Column(Text)
    key_points = Column(Text)       # JSON: {summary, dates, requirements}
    audience = Column(String, nullable=True)  # Extracted ParentSquare groups, e.g. "KHe,KH"
    ps_attachments = Column(Text, nullable=True)  # JSON: {feed_url, thumbnail_urls, post_text, ...}
    received_at = Column(DateTime)
    analyzed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    action_items = relationship("ActionItem", back_populates="source_email", foreign_keys="ActionItem.source_email_id")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True)
    google_event_id = Column(String, unique=True, nullable=False)
    source_calendar_id = Column(String, nullable=True)  # Google Calendar ID this event came from
    title = Column(String)
    description = Column(Text)
    start_datetime = Column(DateTime)
    end_datetime = Column(DateTime)
    location = Column(String)
    analyzed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    action_items = relationship("ActionItem", back_populates="source_event", foreign_keys="ActionItem.source_event_id")


class ActionItem(Base):
    __tablename__ = "action_items"

    id = Column(Integer, primary_key=True)
    source_type = Column(String, nullable=False)  # 'email' | 'calendar' | 'combined'
    source_email_id = Column(Integer, ForeignKey("emails.id"), nullable=True)
    source_event_id = Column(Integer, ForeignKey("calendar_events.id"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    event_date = Column(Date)
    prep_start_date = Column(Date)
    lead_time_days = Column(Integer)
    is_short_notice = Column(Boolean, default=False)
    short_notice_note = Column(Text)
    completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    event_group_id = Column(Integer, ForeignKey("event_groups.id"), nullable=True)
    # Broad item category — e.g. 'homework_spelling' | 'homework_poem' | 'homework_special_project'
    # | 'permission_slip' | 'payment' | 'attendance' | 'bring_item' | None
    # Items with item_type starting with 'homework_' appear in the Homework tab.
    item_type = Column(String, nullable=True)

    source_email = relationship("Email", back_populates="action_items", foreign_keys=[source_email_id])
    source_event = relationship("CalendarEvent", back_populates="action_items", foreign_keys=[source_event_id])
    reminders = relationship("Reminder", back_populates="action_item", cascade="all, delete-orphan")
    event_group = relationship("EventGroup", back_populates="items", foreign_keys=[event_group_id])


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True)
    action_item_id = Column(Integer, ForeignKey("action_items.id"), nullable=False)
    remind_at = Column(DateTime, nullable=False)
    channel = Column(String, nullable=False)  # 'browser' | 'email'
    status = Column(String, default="pending")  # 'pending' | 'sent' | 'dismissed'
    sent_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    action_item = relationship("ActionItem", back_populates="reminders")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    action_item_id = Column(Integer, ForeignKey("action_items.id"), nullable=True)
    message = Column(Text, nullable=False)
    status = Column(String, default="pending")  # 'pending' | 'shown' | 'dismissed'
    created_at = Column(DateTime, default=datetime.utcnow)


class UserSetting(Base):
    __tablename__ = "user_settings"

    key = Column(String, primary_key=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
