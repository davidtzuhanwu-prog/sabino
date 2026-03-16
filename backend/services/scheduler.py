import logging
from datetime import datetime
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

            # Persist scan timestamps so the UI shows the correct "last scanned" time
            now = datetime.utcnow()
            for key in ("last_email_scan_at", "last_calendar_scan_at"):
                row = db.query(UserSetting).filter_by(key=key).first()
                if row:
                    row.value = now.isoformat()
                else:
                    db.add(UserSetting(key=key, value=now.isoformat()))
            db.commit()
            logger.info(f"Scheduled scan complete at {now.isoformat()}")

        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in poll_and_analyze_job: {e}", exc_info=True)


def process_newsletter_pdfs_job():
    """
    Find emails that have PDF filenames recorded but no analysis yet.
    Try to download each PDF directly (works for pre-signed CloudFront URLs)
    and run Claude analysis. Skips PDFs that require a browser session.
    """
    logger.info("Running scheduled process_newsletter_pdfs_job")
    try:
        import json
        from database import SessionLocal
        from models import Email, UserSetting
        from services.parentsquare_service import fetch_pdf_bytes, fetch_pdf_with_session, get_ps_cookies_from_chrome
        from services.pdf_service import extract_text_from_bytes, analyze_pdf_with_claude

        db = SessionLocal()
        try:
            # Try Chrome cookies first (automatic), fall back to manually stored cookie
            cookies = get_ps_cookies_from_chrome()
            if not cookies:
                setting = db.query(UserSetting).filter_by(key="ps_session_cookie").first()
                session_cookie = setting.value if setting and setting.value else ""
                if session_cookie:
                    cookies = {"_ps_session": session_cookie}

            # Find all emails with ps_attachments that have pdf_filenames but missing analyses
            emails_with_ps = db.query(Email).filter(Email.ps_attachments.isnot(None)).all()
            for email in emails_with_ps:
                try:
                    ps = json.loads(email.ps_attachments)
                except Exception:
                    continue

                pdf_filenames = ps.get("pdf_filenames", [])
                pdf_urls = ps.get("pdf_urls", [])
                existing_analyses = {a["filename"] for a in ps.get("pdf_analyses", [])}

                pending = [fn for fn in pdf_filenames if fn not in existing_analyses]
                if not pending:
                    continue

                logger.info("Email id=%s has %d pending PDFs: %s", email.id, len(pending), pending)

                # Try to download each pending PDF via its stored URL
                url_map = dict(zip(pdf_filenames, pdf_urls))  # filename → url (may be incomplete)
                changed = False

                feed_url = ps.get("feed_url", "")

                for filename in pending:
                    pdf_bytes = None

                    # Try session-authenticated download first (most reliable)
                    if cookies and feed_url:
                        logger.info("Fetching PDF %r via Chrome cookies", filename)
                        pdf_bytes = fetch_pdf_with_session(feed_url, filename, cookies=cookies)

                    # Fall back to stored CloudFront URL (no auth needed)
                    if not pdf_bytes:
                        url = url_map.get(filename)
                        if url:
                            logger.info("Downloading PDF %r from stored URL %s", filename, url[:80])
                            pdf_bytes = fetch_pdf_bytes(url)

                    if not pdf_bytes:
                        logger.info("Could not download %r (email %s) — Chrome not running or PS session expired", filename, email.id)
                        continue

                    text = extract_text_from_bytes(pdf_bytes)
                    if not text:
                        logger.warning("No text extracted from %r", filename)
                        continue

                    logger.info("Extracted %d chars from %r, running Claude...", len(text), filename)
                    analysis = analyze_pdf_with_claude(text, filename)
                    if not analysis:
                        logger.warning("Claude analysis failed for %r", filename)
                        continue

                    # Persist into pdf_analyses list
                    pdf_analyses = ps.get("pdf_analyses", [])
                    idx = next((i for i, a in enumerate(pdf_analyses) if a.get("filename") == filename), None)
                    entry = {"filename": filename, "analysis": analysis}
                    if idx is not None:
                        pdf_analyses[idx] = entry
                    else:
                        pdf_analyses.append(entry)
                    ps["pdf_analyses"] = pdf_analyses
                    changed = True
                    logger.info("Persisted PDF analysis for %r in email %s", filename, email.id)

                if changed:
                    email.ps_attachments = json.dumps(ps)
                    db.commit()

        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in process_newsletter_pdfs_job: {e}", exc_info=True)


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
    _scheduler.add_job(
        process_newsletter_pdfs_job,
        trigger=IntervalTrigger(hours=1),
        id="process_newsletter_pdfs",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(f"Scheduler started: poll every {hours}h, reminders every 1h, PDF processing every 1h")


def stop_scheduler():
    _scheduler.shutdown(wait=False)
