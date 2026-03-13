import os
from datetime import datetime
from typing import Optional

import google.auth.transport.requests
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from sqlalchemy.orm import Session

from config import settings
from models import OAuthToken

# Required for local HTTP redirect
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = settings.oauthlib_insecure_transport

# Google returns fully-qualified scope URIs for the OpenID shorthand scopes.
# We use the canonical full-URL forms so requested == granted and no mismatch occurs.
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

CLIENT_CONFIG = {
    "web": {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uris": [settings.google_redirect_uri],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}


def get_auth_url() -> tuple[str, str]:
    # autogenerate_code_verifier=False disables PKCE — server-side web app
    # authenticates with client_secret, not a code_verifier
    flow = Flow.from_client_config(
        CLIENT_CONFIG, scopes=GOOGLE_SCOPES, autogenerate_code_verifier=False
    )
    flow.redirect_uri = settings.google_redirect_uri
    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )
    return auth_url, state


def exchange_code(code: str, db: Session) -> OAuthToken:
    flow = Flow.from_client_config(
        CLIENT_CONFIG, scopes=GOOGLE_SCOPES, autogenerate_code_verifier=False
    )
    flow.redirect_uri = settings.google_redirect_uri
    flow.fetch_token(code=code)
    creds = flow.credentials

    # Get user email
    user_email = None
    try:
        import googleapiclient.discovery
        service = googleapiclient.discovery.build("oauth2", "v2", credentials=creds)
        user_info = service.userinfo().get().execute()
        user_email = user_info.get("email")
    except Exception:
        pass

    token = db.query(OAuthToken).first()
    if token:
        token.access_token = creds.token
        token.refresh_token = creds.refresh_token
        token.token_expiry = creds.expiry
        token.scopes = ",".join(creds.scopes or [])
        token.user_email = user_email
        token.updated_at = datetime.utcnow()
    else:
        token = OAuthToken(
            access_token=creds.token,
            refresh_token=creds.refresh_token,
            token_expiry=creds.expiry,
            scopes=",".join(creds.scopes or []),
            user_email=user_email,
        )
        db.add(token)
    db.commit()
    db.refresh(token)
    return token


def get_credentials(db: Session) -> Optional[Credentials]:
    token = db.query(OAuthToken).first()
    if not token:
        return None

    creds = Credentials(
        token=token.access_token,
        refresh_token=token.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=token.scopes.split(",") if token.scopes else [],
    )
    if token.token_expiry:
        creds.expiry = token.token_expiry

    if creds.expired and creds.refresh_token:
        request = google.auth.transport.requests.Request()
        creds.refresh(request)
        # Save refreshed token
        token.access_token = creds.token
        token.token_expiry = creds.expiry
        token.updated_at = datetime.utcnow()
        db.commit()

    return creds


def disconnect(db: Session):
    token = db.query(OAuthToken).first()
    if token:
        db.delete(token)
        db.commit()
