import base64
import json
import re
from datetime import datetime, timezone
from email import message_from_bytes
from typing import Optional

import html2text
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from sqlalchemy.orm import Session

from models import Email
from services.audience_service import extract_audience


def _build_service(creds: Credentials):
    return build("gmail", "v1", credentials=creds)


def _decode_body(payload: dict) -> str:
    """Extract plain text from a Gmail message payload."""
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = True

    def _extract(part: dict) -> str:
        mime = part.get("mimeType", "")
        body_data = part.get("body", {}).get("data", "")
        parts = part.get("parts", [])

        if mime == "text/plain" and body_data:
            return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        if mime == "text/html" and body_data:
            html_content = base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
            return h.handle(html_content)
        if parts:
            for p in parts:
                result = _extract(p)
                if result:
                    return result
        return ""

    return _extract(payload).strip()


def _get_header(headers: list, name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _parse_date(date_str: str) -> Optional[datetime]:
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def fetch_school_emails(
    creds: Credentials,
    db: Session,
    sender_domain: str = "",
    labels: list[str] = None,
    max_results: int = 50,
) -> list[Email]:
    service = _build_service(creds)

    # Build query
    query_parts = []
    if sender_domain:
        query_parts.append(f"from:*@{sender_domain}")
    if labels:
        for label in labels:
            query_parts.append(f"label:{label}")

    query = " ".join(query_parts) if query_parts else ""

    # Get list of message IDs
    list_params = {"userId": "me", "maxResults": max_results}
    if query:
        list_params["q"] = query

    response = service.users().messages().list(**list_params).execute()
    messages = response.get("messages", [])

    if not messages:
        return []

    saved = []
    for msg_ref in messages:
        msg_id = msg_ref["id"]

        # Skip already-stored messages
        if db.query(Email).filter_by(gmail_message_id=msg_id).first():
            continue

        # Fetch full message
        msg = service.users().messages().get(
            userId="me", id=msg_id, format="full"
        ).execute()

        headers = msg.get("payload", {}).get("headers", [])
        subject = _get_header(headers, "Subject")
        sender = _get_header(headers, "From")
        date_str = _get_header(headers, "Date")
        received_at = _parse_date(date_str) if date_str else None

        body = _decode_body(msg.get("payload", {}))

        email = Email(
            gmail_message_id=msg_id,
            sender=sender,
            subject=subject,
            body_plain=body,
            audience=extract_audience(body),
            received_at=received_at,
        )
        db.add(email)
        saved.append(email)

    db.commit()
    for e in saved:
        db.refresh(e)
    return saved


def send_email(creds: Credentials, to: str, subject: str, body_html: str):
    import email.mime.text
    import email.mime.multipart

    service = _build_service(creds)
    msg = email.mime.multipart.MIMEMultipart("alternative")
    msg["To"] = to
    msg["Subject"] = subject
    part = email.mime.text.MIMEText(body_html, "html")
    msg.attach(part)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
