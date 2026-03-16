"""grouping_service.py — Backend port of the frontend union-find deduplication algorithm.

Groups ActionItems that share the same event_date and have similar titles into
EventGroup records. This runs at ingest time (after each scan) and on startup to
backfill existing data.

The algorithm mirrors the frontend logic in PrepTimeline.tsx and HomePage.tsx so
that all clients get consistent, server-authoritative grouping.
"""
import logging
import re
from datetime import date
from collections import defaultdict

from sqlalchemy.orm import Session

from models import ActionItem, EventGroup

logger = logging.getLogger(__name__)

# ─── Text normalisation ───────────────────────────────────────────────────────

STOP_WORDS = frozenset([
    'a', 'an', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of',
    'is', 'are', 'will', 'be', 'with', 'your', 'our', 'this', 'that', 'it',
])

# Action verbs that signal a *task* ("Attend X", "Ensure Y") rather than an event name.
# Titles starting with these should be deprioritised as group display names —
# event nouns like "Science Fair" or "Spring Gala" make better card titles.
_ACTION_VERB_PREFIX = re.compile(
    r'^(attend|ensure|plan\s+for|check|dress|update|bring|sign|pay|submit|'
    r'prepare|register|remind|confirm|rsvp|review|complete|send|buy|get|'
    r'drop\s+off|pick\s+up)\b',
    re.IGNORECASE,
)

CLUSTER_THRESHOLD = 0.35


def canonicalize(text: str) -> str:
    """Normalise a title for comparison — mirrors the JS canonicalize() function."""
    t = text.lower()
    # Strip date patterns like (3/14) or 3/14/2026
    t = re.sub(r'\(\d{1,2}/\d{1,2}(?:/\d{2,4})?\)', '', t)
    t = re.sub(r'\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b', '', t)
    # Strip noise words
    t = re.sub(r'\b(tomorrow|today|this week|next week|reminder|re:|fwd:|fw:)\b', '', t, flags=re.IGNORECASE)
    # Strip newsletter prefixes
    t = re.sub(r'^bif\s+(?:school\s+)?(?:newsletter|update|news)[–\-—]\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(?:newsletter|update)\s*', '', t, flags=re.IGNORECASE)
    # Strip trailing date
    t = re.sub(r'[–\-—]\s*\d{1,2}/\d{1,2}(?:/\d{2,4})?\s*$', '', t)
    # Strip non-word characters
    t = re.sub(r'[^\w\s]', ' ', t)
    # Normalise whitespace
    return re.sub(r'\s+', ' ', t).strip()


def key_tokens(canon: str) -> set:
    """Extract meaningful tokens — mirrors the JS keyTokens() function."""
    return {w for w in canon.split() if len(w) >= 3 and w not in STOP_WORDS}


def token_similarity(a: str, b: str) -> float:
    """Return max(Jaccard, containment) similarity — mirrors JS tokenSimilarity()."""
    ta = key_tokens(a)
    tb = key_tokens(b)
    if not ta and not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jaccard = inter / union if union else 0.0
    smaller = min(len(ta), len(tb))
    containment = inter / smaller if smaller else 0.0
    return max(jaccard, containment)


WITHIN_GROUP_DEDUP_THRESHOLD = 0.5


def deduplicate_cluster(cluster_items: list) -> tuple[list, list]:
    """Within a cluster, remove semantically duplicate auto-generated items.

    Returns (survivors, to_delete).

    Rules:
    - Only items with source_email_id=None (calendar-derived, no user-visible
      source) are candidates for deletion — email-derived items are never deleted.
    - Among duplicates, keep the most informative item (most key tokens, then
      shortest title as tiebreaker).
    - Uses raw token_similarity (not event-stripped) because all items in the
      cluster are already known to be about the same event, so shared event tokens
      are *expected* and should count toward similarity.
    """
    if len(cluster_items) <= 1:
        return cluster_items, []

    canons = [canonicalize(item.title) for item in cluster_items]
    n = len(cluster_items)
    parent = list(range(n))

    for i in range(n):
        for j in range(i + 1, n):
            if _find(parent, i) == _find(parent, j):
                continue
            sim = token_similarity(canons[i], canons[j])
            if sim >= WITHIN_GROUP_DEDUP_THRESHOLD:
                _union(parent, i, j)

    # Group by root
    root_to_indices: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        root_to_indices[_find(parent, i)].append(i)

    survivors: list = []
    to_delete: list = []

    for indices in root_to_indices.values():
        group = [cluster_items[i] for i in indices]
        if len(group) == 1:
            survivors.append(group[0])
            continue

        # Separate email-sourced (never delete) from calendar-only (safe to delete)
        email_items = [it for it in group if it.source_email_id is not None]
        cal_items = [it for it in group if it.source_email_id is None]

        if email_items:
            # Keep all email-sourced items; delete redundant calendar-only ones
            survivors.extend(email_items)
            to_delete.extend(cal_items)
        else:
            # All calendar-derived — keep the most informative, delete the rest
            best = min(cal_items, key=lambda it: (-len(key_tokens(canonicalize(it.title))), len(it.title)))
            survivors.append(best)
            to_delete.extend(it for it in cal_items if it is not best)

    return survivors, to_delete


def pick_display_name(items: list) -> str:
    """Choose the most descriptive *event name* title from a group.

    Scoring (lower = better display name candidate):
      1. Action-verb prefix penalty (+100) — "Attend X", "Ensure Y", "Plan for Z"
         are *tasks*, not event names; deprioritise them so a proper noun phrase wins.
      2. Most key tokens (negated) — richer title beats sparse one.
      3. Shortest original title — concise titles beat verbose ones on ties.

    Example: given ["Ensure child has good breakfast", "Attend Science Fair",
    "Science Fair preparation (Lower)", "Attend Kindergarten Science Fair"]
    → "Science Fair preparation (Lower)" wins (no action verb, most tokens).
    """
    def score(item):
        is_action = 1 if _ACTION_VERB_PREFIX.match(item.title.strip()) else 0
        tokens = len(key_tokens(canonicalize(item.title)))
        return (is_action, -tokens, len(item.title))

    return min(items, key=score).title


# ─── Union-find helpers ───────────────────────────────────────────────────────

def _find(parent: list, i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]  # path compression
        i = parent[i]
    return i


def _union(parent: list, i: int, j: int) -> None:
    parent[_find(parent, i)] = _find(parent, j)


# ─── Main clustering logic ────────────────────────────────────────────────────

def recluster_all(db: Session) -> int:
    """Recompute EventGroup assignments for all ActionItems with an event_date.

    Algorithm:
    1. Load all ActionItems that have event_date set
    2. Hard-gate: group by exact event_date
    3. Within each date bucket, union-find items whose title similarity >= 0.35
    4. For each resulting cluster, upsert an EventGroup row:
       - If a matching group already exists (same event_date, items overlap),
         keep its display_name if the user edited it; otherwise update to new lead title
       - Link all items in cluster to the group via event_group_id
    5. Delete EventGroup rows that no longer have any items
    6. Commit and return the total number of groups upserted

    This function is idempotent — running it multiple times converges to the same result.
    """
    # Load all items that have an event_date
    items: list[ActionItem] = (
        db.query(ActionItem)
        .filter(ActionItem.event_date.isnot(None))
        .all()
    )

    if not items:
        return 0

    # Pre-compute canonicalised titles
    canons = [canonicalize(item.title) for item in items]

    # Group by event_date (hard gate: only cluster within same date)
    date_buckets: dict[date, list[int]] = defaultdict(list)
    for idx, item in enumerate(items):
        date_buckets[item.event_date].append(idx)

    # For each date bucket run union-find clustering
    clusters: list[list[ActionItem]] = []

    for event_date, indices in date_buckets.items():
        if len(indices) == 1:
            clusters.append([items[indices[0]]])
            continue

        parent = list(range(len(indices)))

        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                if _find(parent, i) == _find(parent, j):
                    continue
                item_i = items[indices[i]]
                item_j = items[indices[j]]
                # Same source email → always group together (they describe the same event)
                same_email = (
                    item_i.source_email_id is not None
                    and item_i.source_email_id == item_j.source_email_id
                )
                sim = token_similarity(canons[indices[i]], canons[indices[j]])
                if same_email or sim >= CLUSTER_THRESHOLD:
                    _union(parent, i, j)

        # Collect into groups by root
        root_to_group: dict[int, list[ActionItem]] = defaultdict(list)
        for i, global_idx in enumerate(indices):
            root_to_group[_find(parent, i)].append(items[global_idx])

        clusters.extend(root_to_group.values())

    # Pre-load all existing EventGroup rows into a dict for O(1) lookup,
    # avoiding an N+1 pattern (one SELECT per cluster).
    existing_groups: dict[int, EventGroup] = {
        g.id: g for g in db.query(EventGroup).all()
    }

    # Upsert EventGroup rows
    groups_upserted = 0
    items_deleted = 0

    for cluster_items in clusters:
        # Remove within-cluster semantic duplicates before persisting
        cluster_items, redundant = deduplicate_cluster(cluster_items)
        for item in redundant:
            db.delete(item)
        items_deleted += len(redundant)

        event_date = cluster_items[0].event_date
        computed_name = pick_display_name(cluster_items)

        # Try to find an existing group that owns at least one of these items
        existing_group: EventGroup | None = None
        for item in cluster_items:
            if item.event_group_id is not None:
                existing_group = existing_groups.get(item.event_group_id)
                if existing_group:
                    break

        if existing_group is None:
            # Create a new EventGroup
            existing_group = EventGroup(
                display_name=computed_name,
                event_date=event_date,
            )
            db.add(existing_group)
            db.flush()  # get the id
            existing_groups[existing_group.id] = existing_group  # keep dict in sync
        else:
            # Preserve user-edited display_name: only update if it still matches
            # what we would have auto-generated from the old cluster membership.
            # We detect "auto-generated" by checking if the current name equals
            # what pick_display_name would produce for the items currently in the group.
            current_items_in_group = [i for i in items if i.event_group_id == existing_group.id]
            auto_name = pick_display_name(current_items_in_group) if current_items_in_group else computed_name
            # Update if: (a) name is blank/unset, (b) name still matches what
            # pick_display_name would have produced from the old membership
            # (meaning it was never manually edited).
            if not existing_group.display_name or existing_group.display_name == auto_name:
                # Not user-edited — update to new computed name
                existing_group.display_name = computed_name
            # else: user has customised the name — keep it
            existing_group.event_date = event_date

        # Link all cluster items to this group
        for item in cluster_items:
            item.event_group_id = existing_group.id

        groups_upserted += 1

    # Delete orphaned EventGroup rows (no items point to them any more)
    all_group_ids_in_use = {
        item.event_group_id for item in items if item.event_group_id is not None
    }
    orphans = (
        db.query(EventGroup)
        .filter(EventGroup.id.notin_(all_group_ids_in_use))
        .all()
    )
    for orphan in orphans:
        db.delete(orphan)

    db.commit()

    logger.info(
        "recluster_all: %d groups upserted, %d orphans removed, %d duplicate items deleted",
        groups_upserted,
        len(orphans),
        items_deleted,
    )
    return groups_upserted
