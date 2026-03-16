import os
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from config import settings


class Base(DeclarativeBase):
    pass


# Ensure data directory exists
os.makedirs("data", exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)

# Enable WAL mode for better concurrency with SQLite
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    from models import Base as ModelsBase  # noqa: F401 — import to register models
    ModelsBase.metadata.create_all(bind=engine)
    _migrate_db()
    _seed_default_settings()


def _migrate_db():
    """Apply additive schema migrations that create_all won't handle."""
    migrations = [
        "ALTER TABLE action_items ADD COLUMN item_type TEXT",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists

        # Backfill item_type for existing rows that predate the column.
        # Mirrors the logic in _classify_item_type() so the two stay in sync.
        # Safe to run on every startup — WHERE clause limits to null-only rows.
        backfills = [
            # homework_spelling — spelling / homophone / word pair
            """UPDATE action_items SET item_type = 'homework_spelling'
               WHERE item_type IS NULL
                 AND (LOWER(title) LIKE '%spelling%'
                   OR LOWER(title) LIKE '%homophone%'
                   OR LOWER(title) LIKE '%word pair%'
                   OR LOWER(description) LIKE '%spelling%'
                   OR LOWER(description) LIKE '%homophone%'
                   OR LOWER(description) LIKE '%word pair%')""",

            # homework_poem — poem + qualifier
            """UPDATE action_items SET item_type = 'homework_poem'
               WHERE item_type IS NULL
                 AND (LOWER(title) LIKE '%poem%' OR LOWER(description) LIKE '%poem%')
                 AND (LOWER(title) LIKE '%recit%' OR LOWER(description) LIKE '%recit%'
                   OR LOWER(title) LIKE '%of the month%' OR LOWER(description) LIKE '%of the month%'
                   OR LOWER(title) LIKE '%memoriz%' OR LOWER(description) LIKE '%memoriz%'
                   OR LOWER(title) LIKE '%memoris%' OR LOWER(description) LIKE '%memoris%')""",

            # homework_special_project — performances, contests, projects, etc.
            """UPDATE action_items SET item_type = 'homework_special_project'
               WHERE item_type IS NULL
                 AND (LOWER(title) LIKE '%spring gala%' OR LOWER(description) LIKE '%spring gala%'
                   OR LOWER(title) LIKE '%science fair%' OR LOWER(description) LIKE '%science fair%'
                   OR LOWER(title) LIKE '%performance%' OR LOWER(description) LIKE '%performance%'
                   OR LOWER(title) LIKE '%rehearse%'    OR LOWER(description) LIKE '%rehearse%'
                   OR LOWER(title) LIKE '%script%'      OR LOWER(description) LIKE '%script%'
                   OR LOWER(title) LIKE '%costume%'     OR LOWER(description) LIKE '%costume%'
                   OR LOWER(title) LIKE '%contest%'     OR LOWER(description) LIKE '%contest%'
                   OR LOWER(title) LIKE '%showcase%'    OR LOWER(description) LIKE '%showcase%'
                   OR LOWER(title) LIKE '%presentation%' OR LOWER(description) LIKE '%presentation%'
                   OR LOWER(title) LIKE '%pi day%'      OR LOWER(description) LIKE '%pi day%'
                   OR LOWER(title) LIKE '%memorization contest%' OR LOWER(description) LIKE '%memorization contest%'
                   OR LOWER(title) LIKE '%diorama%'     OR LOWER(description) LIKE '%diorama%'
                   OR LOWER(title) LIKE '%poster%'      OR LOWER(description) LIKE '%poster%'
                   OR LOWER(title) LIKE '%report%'      OR LOWER(description) LIKE '%report%')""",

            # permission_slip
            """UPDATE action_items SET item_type = 'permission_slip'
               WHERE item_type IS NULL
                 AND (LOWER(title) LIKE '%permission slip%' OR LOWER(description) LIKE '%permission slip%'
                   OR LOWER(title) LIKE '%sign and return%' OR LOWER(description) LIKE '%sign and return%'
                   OR LOWER(title) LIKE '%consent form%'   OR LOWER(description) LIKE '%consent form%')""",
        ]
        for sql in backfills:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass


def _seed_default_settings():
    from models import UserSetting
    db = SessionLocal()
    try:
        defaults = {
            "school_sender_domain": "",
            "school_gmail_labels": "[]",
            "poll_interval_hours": "6",
            "reminder_channel": "browser",
            "reminder_email_address": "",
            "short_notice_threshold_days": "7",
            "child_class_code": "",
            "child_grade_level": "",
        }
        for key, value in defaults.items():
            existing = db.query(UserSetting).filter_by(key=key).first()
            if not existing:
                db.add(UserSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
