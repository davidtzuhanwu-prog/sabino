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

import html
import json
import logging
import re
from typing import Optional
from urllib.parse import unquote

import requests

logger = logging.getLogger(__name__)

_CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)


def get_ps_cookies_from_chrome() -> dict:
    """
    Read ParentSquare session cookies directly from Chrome's cookie store.
    Uses pycookiecheat to decrypt Chrome's AES-encrypted cookie database.
    Returns a dict of cookie name → value, or empty dict on failure.
    """
    try:
        from pycookiecheat import chrome_cookies
        cookies = chrome_cookies("https://www.parentsquare.com")
        if cookies:
            logger.info("Read %d PS cookies from Chrome", len(cookies))
        else:
            logger.warning("No PS cookies found in Chrome cookie store")
        return cookies
    except Exception as exc:
        logger.warning("Could not read Chrome cookies for PS: %s", exc)
        return {}

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
        "User-Agent": _CHROME_UA,
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

    # Extract PDF/document filenames and download URLs from attachment elements.
    # ParentSquare renders PDFs as:
    #   <a href="https://...cdn.../file.pdf?..." ...><i class="fa fa-download"></i> filename.pdf</a>
    # Sometimes the anchor is "disabled" (no href) and the URL is in a data attribute.
    pdf_filenames: list[str] = []
    pdf_urls: list[str] = []

    # Try to capture both href URL and filename in one pass
    for m in re.finditer(
        r'<a[^>]*(?:href=["\']([^"\']*\.pdf[^"\']*)["\']|data-url=["\']([^"\']+)["\'])[^>]*>'
        r'(?:.*?<i class="fa fa-download"[^>]*></i>)?\s*([^\n<]+\.pdf)',
        html, re.I | re.S
    ):
        url = (m.group(1) or m.group(2) or "").strip()
        name = m.group(3).strip()
        if name:
            pdf_filenames.append(name)
            if url:
                pdf_urls.append(url)

    # Fallback: extract filenames-only from download icon pattern
    if not pdf_filenames:
        pdf_filenames = [
            f.strip()
            for f in re.findall(r'<i class="fa fa-download"[^>]*></i>\s*([^\n<]+\.pdf)', html, re.I)
            if f.strip()
        ]

    # Also look for direct media.parentsquare.com PDF URLs (CloudFront pre-signed)
    if not pdf_urls:
        pdf_urls = re.findall(
            r'(https://media\.parentsquare\.com/[^\s"\'<>]+\.pdf[^\s"\'<>]*)',
            html, re.I
        )

    return {
        "feed_id": feed_id,
        "thumbnail_urls": thumbnails,
        "post_text": post_text,
        "pdf_filenames": pdf_filenames,
        "pdf_urls": pdf_urls,
    }


def fetch_pdf_with_session(
    feed_url: str,
    filename: str,
    session_cookie: str = "",
    cookies: Optional[dict] = None,
) -> Optional[bytes]:
    """
    Use ParentSquare session cookies to find and download a PDF attachment.

    Accepts either:
    - cookies: dict from get_ps_cookies_from_chrome() (preferred)
    - session_cookie: legacy _ps_session string (fallback)

    Returns raw bytes or None on failure.
    """
    if cookies is None:
        # Build cookies dict from legacy string for backward compat
        cookies = {"_ps_session": session_cookie} if session_cookie else {}

    headers = {
        "User-Agent": _CHROME_UA,
        "Accept": "application/json, text/html, */*",
    }

    # Step 1: Fetch feed JSON to discover attachment download URLs
    feed_id_m = re.search(r"/feeds/(\d+)", feed_url)
    if not feed_id_m:
        logger.warning("Could not extract feed_id from %s", feed_url)
        return None
    feed_id = feed_id_m.group(1)

    try:
        json_url = f"https://www.parentsquare.com/feeds/{feed_id}.json"
        resp = requests.get(json_url, headers={**headers, "Accept": "application/json"}, cookies=cookies, timeout=20)
        if resp.status_code == 200:
            data = resp.json()
            # Look for attachment with matching filename
            attachments = data.get("attachments", []) or data.get("feed", {}).get("attachments", [])
            for att in attachments:
                att_name = att.get("file_name") or att.get("filename") or att.get("name") or ""
                if att_name.lower().strip() == filename.lower().strip() or filename.lower() in att_name.lower():
                    pdf_url = att.get("url") or att.get("download_url") or att.get("file_url")
                    if pdf_url:
                        logger.info("Found PDF URL for %r via JSON API: %s", filename, pdf_url[:80])
                        return fetch_pdf_bytes(pdf_url)
            logger.info("JSON API returned %d attachments but none matched %r", len(attachments), filename)
    except Exception as exc:
        logger.warning("JSON API fetch failed for feed %s: %s", feed_id, exc)

    # Step 2: Fall back to HTML page scrape with session cookies
    try:
        resp = requests.get(feed_url, headers=headers, cookies=cookies, timeout=20)
        if resp.status_code != 200:
            logger.warning("Feed page returned %s with session cookies", resp.status_code)
            return None
        html = resp.text

        # With a session, the page may now expose actual PDF hrefs
        pdf_href_patterns = [
            rf'<a[^>]*href=["\']([^"\']+)["\'][^>]*>\s*(?:[^<]*<[^>]+>)*[^<]*{re.escape(filename.split(".")[0][:10])}[^<]*\.pdf',
            r'href=["\']([^"\']+\.pdf[^"\']*)["\']',
        ]
        for pattern in pdf_href_patterns:
            matches = re.findall(pattern, html, re.I | re.S)
            for url in matches:
                if url.startswith("http"):
                    logger.info("Found PDF URL via HTML scrape: %s", url[:80])
                    return fetch_pdf_bytes(url)
    except Exception as exc:
        logger.warning("Authenticated HTML fetch failed for %s: %s", feed_url, exc)

    return None


def fetch_pdf_bytes(url: str) -> Optional[bytes]:
    """
    Download a PDF from a ParentSquare / CloudFront URL without browser session.
    Works for pre-signed CloudFront URLs (media.parentsquare.com).
    Returns raw bytes or None on failure.
    """
    headers = {
        "User-Agent": _CHROME_UA,
        "Accept": "application/pdf,*/*",
    }
    # Unescape HTML entities (e.g. &amp; → &) that may be present when URL
    # was extracted from an HTML attribute value
    url = html.unescape(url)
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "html" in content_type and len(resp.content) < 5000:
            # Got a login redirect page, not a PDF
            logger.warning("Got HTML instead of PDF from %s (session required)", url)
            return None
        return resp.content
    except Exception as exc:
        logger.warning("fetch_pdf_bytes failed for %s: %s", url, exc)
        return None


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
        "pdf_urls": result.get("pdf_urls", []),
    }
