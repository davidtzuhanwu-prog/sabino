import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from database import get_db
from models import OAuthToken
from schemas import AuthStatus
from services import google_oauth

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/url")
def get_auth_url():
    if not google_oauth.settings.google_client_id:
        return {"error": "Google client credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env"}
    auth_url, state = google_oauth.get_auth_url()
    return {"auth_url": auth_url, "state": state}


@router.get("/callback")
def oauth_callback(
    code: str = None,
    state: str = "",
    error: str = None,
    db: Session = Depends(get_db),
):
    # User cancelled or Google returned an error
    if error or not code:
        reason = error or "cancelled"
        logger.warning("OAuth callback aborted: %s", reason)
        return RedirectResponse(url="http://localhost:5174/settings")

    try:
        google_oauth.exchange_code(code, db)
        return RedirectResponse(url="http://localhost:5174/?auth=success")
    except Exception as e:
        logger.error("OAuth callback failed: %s", e, exc_info=True)
        params = urlencode({"auth": "error", "message": str(e)})
        return RedirectResponse(url=f"http://localhost:5174/settings?{params}")


@router.get("/status", response_model=AuthStatus)
def auth_status(db: Session = Depends(get_db)):
    token = db.query(OAuthToken).first()
    if not token:
        return AuthStatus(connected=False)
    scopes = token.scopes.split(",") if token.scopes else []
    return AuthStatus(connected=True, email=token.user_email, scopes=scopes)


@router.delete("/disconnect")
def disconnect(db: Session = Depends(get_db)):
    google_oauth.disconnect(db)
    return {"message": "Disconnected"}
