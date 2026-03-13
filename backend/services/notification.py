import logging
from datetime import date, datetime, time
from sqlalchemy.orm import Session

from models import ActionItem, Reminder, Notification, UserSetting

logger = logging.getLogger(__name__)


def create_reminder_for_item(item: ActionItem, db: Session):
    """Create a scheduled reminder for an action item."""
    if not item.prep_start_date:
        return

    # Get reminder channel setting
    channel_setting = db.query(UserSetting).filter_by(key="reminder_channel").first()
    channel = channel_setting.value if channel_setting else "browser"

    # Avoid duplicate reminders
    existing = db.query(Reminder).filter_by(action_item_id=item.id).first()
    if existing:
        return

    remind_at = datetime.combine(item.prep_start_date, time(8, 0))
    reminder = Reminder(
        action_item_id=item.id,
        remind_at=remind_at,
        channel=channel,
        status="pending",
    )
    db.add(reminder)
    db.commit()


def dispatch_due_reminders(db: Session):
    """Check for due reminders and dispatch them."""
    now = datetime.utcnow()
    due_reminders = (
        db.query(Reminder)
        .filter(Reminder.status == "pending", Reminder.remind_at <= now)
        .all()
    )

    for reminder in due_reminders:
        item = reminder.action_item
        if not item:
            continue

        message = _format_reminder_message(item)

        if reminder.channel == "browser":
            notif = Notification(
                action_item_id=item.id,
                message=message,
                status="pending",
            )
            db.add(notif)

        elif reminder.channel == "email":
            _send_email_reminder(item, message, db)

        reminder.status = "sent"
        reminder.sent_at = now

    db.commit()


def _format_reminder_message(item: ActionItem) -> str:
    parts = [f"Start preparing: {item.title}"]
    if item.event_date:
        parts.append(f"Event date: {item.event_date.strftime('%B %d, %Y')}")
    if item.description:
        parts.append(item.description[:200])
    return " | ".join(parts)


def _send_email_reminder(item: ActionItem, message: str, db: Session):
    email_setting = db.query(UserSetting).filter_by(key="reminder_email_address").first()
    to_email = email_setting.value if email_setting and email_setting.value else None
    if not to_email:
        return

    try:
        from services import google_oauth
        creds = google_oauth.get_credentials(db)
        if not creds:
            logger.warning("Email reminder skipped for '%s': no Google credentials", item.title)
            return

        from services import gmail_service
        subject = f"Reminder: {item.title} - Start preparing today!"
        event_date_str = item.event_date.strftime("%B %d, %Y") if item.event_date else "TBD"
        short_notice_html = ""
        if item.is_short_notice and item.short_notice_note:
            short_notice_html = f'<p style="color:#e53e3e">⚠️ {item.short_notice_note}</p>'

        body_html = f"""
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#2d3748">School Reminder</h2>
          <h3>{item.title}</h3>
          <p><strong>Event date:</strong> {event_date_str}</p>
          <p><strong>What to do:</strong> {item.description or 'See original school communication.'}</p>
          {short_notice_html}
          <hr>
          <p style="color:#718096;font-size:0.9em">
            Open your <a href="http://localhost:5173">Sabino</a> to mark this complete.
          </p>
        </div>
        """
        gmail_service.send_email(creds, to_email, subject, body_html)
        logger.info("Email reminder sent to %s for action item '%s'", to_email, item.title)
    except Exception as e:
        logger.error(
            "Failed to send email reminder to %s for action item '%s': %s",
            to_email, item.title, e, exc_info=True,
        )
        from routers.errors import record_error
        record_error("email_reminder", f"Failed to send reminder for '{item.title}' to {to_email}: {e}")
