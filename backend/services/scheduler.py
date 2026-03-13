import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler()


def poll_and_analyze_job():
    """Fetch new emails + calendar events and run Claude analysis."""
    logger.info("Running scheduled poll_and_analyze_job")
    try:
        from database import SessionLocal
        from models import UserSetting, Email, CalendarEvent
        from services import google_oauth, gmail_service, calendar_service, claude_service, notification

        db = SessionLocal()
        try:
            creds = google_oauth.get_credentials(db)
            if not creds:
                logger.warning("No Google credentials; skipping poll job")
                return

            # Get settings
            domain_setting = db.query(UserSetting).filter_by(key="school_sender_domain").first()
            sender_domain = domain_setting.value if domain_setting else ""

            labels_setting = db.query(UserSetting).filter_by(key="school_gmail_labels").first()
            import json
            labels = json.loads(labels_setting.value) if labels_setting and labels_setting.value else []

            # Fetch emails
            new_emails = gmail_service.fetch_school_emails(creds, db, sender_domain, labels)
            logger.info(f"Fetched {len(new_emails)} new emails")

            # Analyze unanalyzed emails
            unanalyzed = db.query(Email).filter(Email.analyzed == False).all()  # noqa: E712
            for email in unanalyzed:
                items = claude_service.analyze_email(email, db)
                for item in items:
                    notification.create_reminder_for_item(item, db)
                logger.info(f"Analyzed email '{email.subject}': {len(items)} action items")

            # Fetch calendar events
            new_events = calendar_service.fetch_upcoming_events(creds, db)
            logger.info(f"Fetched {len(new_events)} new calendar events")

            # Cross-reference all upcoming events
            all_events = db.query(CalendarEvent).all()
            if all_events:
                new_items = claude_service.crossref_calendar(all_events, db)
                for item in new_items:
                    notification.create_reminder_for_item(item, db)
                logger.info(f"Calendar cross-ref created {len(new_items)} new action items")

        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in poll_and_analyze_job: {e}", exc_info=True)


def check_reminders_job():
    """Dispatch any due reminders."""
    logger.info("Running scheduled check_reminders_job")
    try:
        from database import SessionLocal
        from services import notification

        db = SessionLocal()
        try:
            notification.dispatch_due_reminders(db)
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in check_reminders_job: {e}", exc_info=True)


def _get_poll_interval() -> int:
    try:
        from database import SessionLocal
        from models import UserSetting
        db = SessionLocal()
        setting = db.query(UserSetting).filter_by(key="poll_interval_hours").first()
        db.close()
        return int(setting.value) if setting and setting.value else 6
    except Exception:
        return 6


def start_scheduler():
    hours = _get_poll_interval()
    _scheduler.add_job(
        poll_and_analyze_job,
        trigger=IntervalTrigger(hours=hours),
        id="poll_and_analyze",
        replace_existing=True,
    )
    _scheduler.add_job(
        check_reminders_job,
        trigger=IntervalTrigger(hours=1),
        id="check_reminders",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(f"Scheduler started: poll every {hours}h, reminders every 1h")


def stop_scheduler():
    _scheduler.shutdown(wait=False)
