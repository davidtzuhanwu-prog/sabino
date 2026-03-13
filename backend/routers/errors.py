"""
In-memory error store.
Services call record_error() to push errors here.
The frontend polls GET /api/errors to display them to the user.
"""
import logging
from collections import deque
from datetime import datetime
from typing import Deque

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()

# Keep the last 50 errors in memory (reset on server restart)
_MAX_ERRORS = 50
_errors: Deque[dict] = deque(maxlen=_MAX_ERRORS)


def record_error(source: str, message: str) -> None:
    """Push an error into the in-memory store. Call from any service."""
    entry = {
        "id": len(_errors),  # monotonic within a session
        "source": source,
        "message": message,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "seen": False,
    }
    _errors.append(entry)
    logger.debug("Error recorded [%s]: %s", source, message)


@router.get("")
def list_errors():
    """Return all unseen errors and mark them as seen."""
    unseen = [e for e in _errors if not e["seen"]]
    for e in unseen:
        e["seen"] = True
    return unseen


@router.delete("")
def clear_errors():
    """Clear all stored errors."""
    _errors.clear()
    return {"cleared": True}
