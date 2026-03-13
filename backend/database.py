import os
from sqlalchemy import create_engine, event
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
    _seed_default_settings()


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
