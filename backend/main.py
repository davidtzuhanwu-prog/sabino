import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from services.scheduler import start_scheduler, stop_scheduler
from routers import auth, emails, calendar, action_items, settings, reminders, errors, event_groups, ps_pdf

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
            "level": "DEBUG",
        },
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "sabino.log",
            "maxBytes": 5_242_880,  # 5 MB
            "backupCount": 3,
            "formatter": "standard",
            "level": "DEBUG",
        },
    },
    "root": {
        "handlers": ["console", "file"],
        "level": "INFO",
    },
    "loggers": {
        "services": {"level": "DEBUG", "propagate": True},
        "routers": {"level": "DEBUG", "propagate": True},
    },
}

logging.config.dictConfig(LOGGING_CONFIG)


def _migrate_and_backfill():
    """Add new columns if missing, backfill audience, and prune mismatched calendar events."""
    from sqlalchemy import text
    from database import SessionLocal, engine
    from models import Email, CalendarEvent, UserSetting
    from services.audience_service import extract_audience

    with engine.connect() as conn:
        # ── emails table ─────────────────────────────────────────────────────
        email_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(emails)")).fetchall()]
        if "audience" not in email_cols:
            conn.execute(text("ALTER TABLE emails ADD COLUMN audience TEXT"))
            conn.commit()

        # ── calendar_events table ─────────────────────────────────────────────
        cal_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(calendar_events)")).fetchall()]
        if "source_calendar_id" not in cal_cols:
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN source_calendar_id TEXT"))
            conn.commit()

        # ── action_items table ────────────────────────────────────────────────
        # event_groups table is created by SQLAlchemy create_all above.
        ai_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(action_items)")).fetchall()]
        if "event_group_id" not in ai_cols:
            conn.execute(text(
                "ALTER TABLE action_items ADD COLUMN event_group_id INTEGER REFERENCES event_groups(id)"
            ))
            conn.commit()

        # ── emails table ─────────────────────────────────────────────────────
        email_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(emails)")).fetchall()]
        if "ps_attachments" not in email_cols:
            conn.execute(text("ALTER TABLE emails ADD COLUMN ps_attachments TEXT"))
            conn.commit()

    db = SessionLocal()
    try:
        # Backfill email audience where NULL
        emails = db.query(Email).filter(Email.audience == None).all()  # noqa: E711
        for email in emails:
            email.audience = extract_audience(email.body_plain)
        if emails:
            db.commit()

        # Backfill ParentSquare attachments for emails that have a signed PS URL
        # but haven't been scraped yet (new column, or emails added before this feature)
        import logging as _log2
        _ps_log = _log2.getLogger(__name__)
        from services.parentsquare_service import scrape_email_attachments
        import json as _json
        ps_needed = db.query(Email).filter(
            Email.ps_attachments == None,  # noqa: E711
            Email.body_plain.contains("attachments with this post"),
        ).all()
        if ps_needed:
            _ps_log.info("Backfilling ParentSquare attachments for %d email(s)…", len(ps_needed))
            done = 0
            for em in ps_needed:
                result = scrape_email_attachments(em.body_plain)
                if result:
                    em.ps_attachments = _json.dumps(result)
                    done += 1
            if done:
                db.commit()
                _ps_log.info("ParentSquare backfill: scraped %d post(s)", done)

        # Prune calendar events that don't belong to the currently selected calendar.
        # Events with source_calendar_id = NULL are legacy rows fetched before this
        # column existed — we can't know which calendar they came from, so remove them.
        setting = db.query(UserSetting).filter_by(key="selected_calendar_id").first()
        selected_cal = setting.value if setting and setting.value else ""
        if selected_cal:
            stale = db.query(CalendarEvent).filter(
                (CalendarEvent.source_calendar_id == None) |  # noqa: E711
                (CalendarEvent.source_calendar_id != selected_cal)
            ).all()
            if stale:
                import logging
                logging.getLogger(__name__).info(
                    "Pruning %d calendar events not from selected calendar %s",
                    len(stale), selected_cal[:20]
                )
                for evt in stale:
                    db.delete(evt)
                db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _migrate_and_backfill()
    # Backfill EventGroup assignments for all existing ActionItems
    from database import SessionLocal
    from services.grouping_service import recluster_all
    import logging as _logging
    _log = _logging.getLogger(__name__)
    with SessionLocal() as db:
        n = recluster_all(db)
        _log.info("Startup recluster: %d event groups", n)
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Sabino", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176", "http://localhost:5177"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(emails.router, prefix="/api/emails", tags=["emails"])
app.include_router(calendar.router, prefix="/api/calendar", tags=["calendar"])
app.include_router(action_items.router, prefix="/api/action-items", tags=["action-items"])
app.include_router(event_groups.router, prefix="/api/event-groups", tags=["event-groups"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(reminders.router, prefix="/api/reminders", tags=["reminders"])
app.include_router(errors.router, prefix="/api/errors", tags=["errors"])
app.include_router(ps_pdf.router, prefix="/api/ps-pdf", tags=["ps-pdf"])


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Sabino"}
