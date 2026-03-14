"""
ParentSquare attachment scraper.

Emails from ParentSquare contain a signed JWT URL of the form:
    https://www.parentsquare.com/feeds/{ID}?s={JWT}

The JWT encodes the user's id, an expiry (~3 months out), and the target URL.
Fetching that URL without a session cookie returns the full HTML page with:
  - Pre-signed CloudFront thumbnail URLs for every photo attachment
    (media.parentsquare.com/feeds/thumb_* — valid for ~weeks, ~6 KB each)
  - The post body text

We scrape this page at email-analysis time and store the results so the
frontend can show an inline photo gallery without any additional auth.
"""

import json
import logging
import re
from typing import Optional
from urllib.parse import unquote

import requests

logger = logging.getLogger(__name__)

# ── Extraction helpers ──────────────────────────────────────────────────────

_PS_FEED_RE = re.compile(
    r'https://www\.parentsquare\.com/feeds/(\d+)'
    r'\?s=([\w\-_]+\.[\w\-_]+\.[\w\-_]+)',   # JWT: header.payload.sig (URL-safe base64)
)

_ATTACHMENT_COUNT_RE = re.compile(
    r'[Tt]here (?:is|are) (\d+) attachments? with this post'
)

_THUMB_SRC_RE = re.compile(
    r'src="(https://media\.parentsquare\.com/feeds/thumb_[^"]+)"'
)

_INLINE_IMAGE_RE = re.compile(
    r'!\[[^\]]*\]\((https://posts\.parentsquare\.com/[^)]+)\)'
)


def extract_ps_feed_url(body: str) -> Optional[str]:
    """Return the first fully signed ParentSquare feed URL found in an email body."""
    m = _PS_FEED_RE.search(body or "")
    if not m:
        return None
    return f"https://www.parentsquare.com/feeds/{m.group(1)}?s={m.group(2)}"


def attachment_count(body: str) -> int:
    """How many attachments does the email say the post has?"""
    m = _ATTACHMENT_COUNT_RE.search(body or "")
    return int(m.group(1)) if m else 0


def inline_images(body: str) -> list[str]:
    """Images already embedded in the email body by html2text (posts.parentsquare.com)."""
    return _INLINE_IMAGE_RE.findall(body or "")


# ── Main scraper ────────────────────────────────────────────────────────────

def fetch_attachments(signed_url: str) -> dict:
    """
    Fetch the ParentSquare feed page and extract:
      - thumbnail_urls: list of CloudFront-signed thumbnail image URLs
      - post_text:      plain-text content of the post (for AI analysis)
      - feed_id:        numeric feed ID

    Returns a dict with those keys, or raises on network / parse errors.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    }

    resp = requests.get(signed_url, headers=headers, timeout=20)
    resp.raise_for_status()
    html = resp.text

    # Extract CloudFront-signed thumbnail URLs
    raw_thumbs = _THUMB_SRC_RE.findall(html)
    # Un-escape HTML entities in the URLs (&amp; → &)
    thumbnails = [unquote(u.replace("&amp;", "&")) for u in raw_thumbs]

    # Extract plain-text post content via <title> and og tags
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S)
    og_desc_m = re.search(
        r'property=["\']og:description["\'][^>]*content=["\']([^"\']+)', html
    )

    # Try to find the post body text from common container patterns
    # ParentSquare renders content in a turbo-frame that may be JS-driven,
    # but the share-URL version usually includes static text
    post_text_parts: list[str] = []

    # 1. Try stripping all tags from the main content div
    content_match = re.search(
        r'<div[^>]+class="[^"]*(?:post-detail|feed-post|post-body)[^"]*"[^>]*>(.*?)</div>',
        html, re.S | re.I
    )
    if content_match:
        raw = re.sub(r"<[^>]+>", " ", content_match.group(1))
        post_text_parts.append(re.sub(r"\s+", " ", raw).strip())

    # 2. Fallback: og:description
    if not post_text_parts and og_desc_m:
        post_text_parts.append(og_desc_m.group(1))

    # 3. Fallback: page title
    if not post_text_parts and title_m:
        post_text_parts.append(re.sub(r"<[^>]+>", "", title_m.group(1)).strip())

    post_text = "\n".join(post_text_parts).strip()

    # Feed ID from URL
    feed_id_m = re.search(r"/feeds/(\d+)", signed_url)
    feed_id = int(feed_id_m.group(1)) if feed_id_m else None

    return {
        "feed_id": feed_id,
        "thumbnail_urls": thumbnails,
        "post_text": post_text,
    }


def scrape_email_attachments(body: str) -> Optional[dict]:
    """
    High-level entry point: given a stored email body, check if it has a
    ParentSquare signed URL with attachments, fetch them, and return a dict
    ready to be JSON-serialised into Email.ps_attachments.

    Returns None if no ParentSquare signed URL is present.
    """
    signed_url = extract_ps_feed_url(body)
    if not signed_url:
        return None

    count = attachment_count(body)
    already_inline = inline_images(body)

    try:
        result = fetch_attachments(signed_url)
    except Exception as exc:
        logger.warning("ParentSquare fetch failed for %s: %s", signed_url, exc)
        return {
            "feed_url": signed_url,
            "attachment_count": count,
            "thumbnail_urls": already_inline,  # use what we already have from email
            "post_text": "",
            "error": str(exc),
        }

    return {
        "feed_url": signed_url,
        "attachment_count": count,
        "thumbnail_urls": result["thumbnail_urls"] or already_inline,
        "post_text": result["post_text"],
        "feed_id": result["feed_id"],
    }
