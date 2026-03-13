"""
audience_service.py
───────────────────
Parses the ParentSquare "posted in [GROUP(S)]" header from email body text
and returns a normalized audience string for relevance scoring.

The raw audience string is stored on Email.audience so that:
  • Existing emails can be backfilled without re-fetching from Gmail
  • The frontend can recompute relevance any time the user changes their
    child's class setting — no backend re-classification needed
"""

import re
from typing import Optional

# Matches: "[Sender Name] posted in [GROUP LIST]\n"
# The group list is on the first line only; it ends at the first newline.
# Groups are comma-separated class/school names.
_POSTED_IN_RE = re.compile(
    r"posted in\s+(.+?)$",
    re.IGNORECASE | re.MULTILINE,
)

# ParentSquare group names that unambiguously mean Upper/Middle School
_UPPER_SCHOOL_PATTERNS = re.compile(
    r"\b(upper school|high school|middle school|"
    r"6th grade|7th grade|8th grade|9th grade|10th grade|11th grade|12th grade|"
    r"grade 6|grade 7|grade 8|grade 9|grade 10|grade 11|grade 12)\b",
    re.IGNORECASE,
)


def extract_audience(body_plain: Optional[str]) -> str:
    """
    Extract and normalize the audience from a ParentSquare email body.

    Returns a compact, comma-separated string of group codes/names, e.g.:
        "KHe"
        "KHe,KH"
        "Lower School"
        "BASIS Independent Fremont"
        ""   ← HTML newsletter / no group header found

    The caller stores this verbatim on Email.audience.
    """
    if not body_plain:
        return ""

    # Only look at the first 600 chars — the group header is always at the top
    head = body_plain[:600]

    match = _POSTED_IN_RE.search(head)
    if not match:
        return ""

    raw = match.group(1).strip()

    # Clean up: collapse whitespace, remove trailing punctuation
    raw = re.sub(r"\s+", " ", raw).strip(" ,.")

    # Normalise individual group names into a compact comma-separated list
    # Split on comma; each token is one ParentSquare group
    parts = [p.strip() for p in raw.split(",") if p.strip()]

    # Collapse verbose class names to their code, e.g.:
    #   "1 Carbon (1C)" → "1C"
    #   "Kindergarten Helium (KHe)" → "KHe"
    #   "TK Oxygen (TKO)" → "TKO"
    #   "BASIS Independent Fremont Lower School (Kearney Street Campus)" → "Lower School"
    normalised = []
    for part in parts:
        code_match = re.search(r"\(([A-Za-z0-9]+)\)\s*$", part)
        if code_match:
            normalised.append(code_match.group(1))
        elif "lower school" in part.lower():
            normalised.append("Lower School")
        elif "upper school" in part.lower():
            normalised.append("Upper School")
        elif "basis independent fremont" in part.lower() and len(parts) == 1:
            normalised.append("BASIS Independent Fremont")
        elif "language and literacy" in part.lower():
            # e.g. "Language and Literacy Foundation (KHe Language) - Bhuskat"
            # Extract the class code prefix
            lang_match = re.search(r"\((\w+)\s+Language\)", part, re.IGNORECASE)
            if lang_match:
                normalised.append(lang_match.group(1))
            else:
                normalised.append(part[:60])
        else:
            normalised.append(part[:60])  # cap length for safety

    # De-duplicate while preserving order
    seen: set[str] = set()
    deduped = []
    for n in normalised:
        if n not in seen:
            seen.add(n)
            deduped.append(n)

    return ",".join(deduped)


def classify_tier(audience: str, child_class_code: str) -> str:
    """
    Given a stored audience string and the parent's configured child class
    code (e.g. "KHe"), return a relevance tier string:

        "mine"          – directly about the child's class
        "grade"         – same grade level (sibling class or grade grouping)
        "lower_school"  – all of lower school
        "whole_school"  – entire school (BIF-wide)
        "upper_school"  – upper / middle school only → not relevant
        "unknown"       – no group header (HTML newsletter, direct message, etc.)
    """
    if not audience:
        return "unknown"

    a = audience.lower()
    code = child_class_code.strip().lower()  # e.g. "khe"

    if not code:
        # No child configured — treat everything as lower_school / unknown
        if "upper school" in a:
            return "upper_school"
        if "lower school" in a:
            return "lower_school"
        if "basis independent fremont" in a:
            return "whole_school"
        return "unknown"

    # ── Derive grade prefix from class code ──────────────────────────────────
    # "KHe" → "k",  "KH" → "k",  "TKO" → "tk",  "1C" → "1",  "2Ar" → "2"
    grade_prefix_match = re.match(r"^(tk|k|[1-5])", code, re.IGNORECASE)
    grade_prefix = grade_prefix_match.group(1).lower() if grade_prefix_match else ""

    # ── 1. Direct class match ────────────────────────────────────────────────
    # The code itself appears as a token in the audience string
    if re.search(rf"\b{re.escape(code)}\b", a, re.IGNORECASE):
        return "mine"

    # ── 2. Upper school → always irrelevant for a lower-school parent ────────
    if _UPPER_SCHOOL_PATTERNS.search(audience):
        return "upper_school"

    # ── 3. Same-grade groupings ──────────────────────────────────────────────
    if grade_prefix == "k":
        # Any combination of KHe, KH, Kindergarten, TK&K
        if re.search(r"\b(khe|kh|kindergarten)", a):
            return "grade"
        # TK&K grouping (both TK and K listed together)
        if "tk" in a and ("k" in a or "kindergarten" in a):
            return "grade"

    elif grade_prefix == "tk":
        if re.search(r"\b(tko|tku|transitional.?kindergarten)", a):
            return "grade"
        # TK&K grouping
        if "tk" in a and ("k" in a or "kindergarten" in a):
            return "grade"

    elif grade_prefix in ("1", "2", "3", "4", "5"):
        # e.g. child is in "1C"; check for other grade-1 classes like "1N"
        if re.search(rf"\b{grade_prefix}[a-z]", a, re.IGNORECASE):
            return "grade"

    # ── 4. Lower school ──────────────────────────────────────────────────────
    if "lower school" in a:
        return "lower_school"

    # ── 5. Whole school ──────────────────────────────────────────────────────
    if "basis independent fremont" in a:
        return "whole_school"

    return "unknown"
