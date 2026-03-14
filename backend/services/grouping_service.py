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


def pick_display_name(items: list) -> str:
    """Choose the most informative title from a group.

    Prefers the item whose canonical form has the most key tokens.
    Breaks ties by shortest original title (more concise = better display name).
    Mirrors the frontend pick_lead_title() logic.
    """
    def score(item):
        tokens = len(key_tokens(canonicalize(item.title)))
        return (-tokens, len(item.title))  # most tokens first, shortest on tie

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
                sim = token_similarity(canons[indices[i]], canons[indices[j]])
                if sim >= CLUSTER_THRESHOLD:
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

    for cluster_items in clusters:
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
            if existing_group.display_name == auto_name:
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
        "recluster_all: %d groups upserted, %d orphans removed",
        groups_upserted,
        len(orphans),
    )
    return groups_upserted
