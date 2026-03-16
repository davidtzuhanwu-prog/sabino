import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import api from '../api/client'
import type { ActionItem, CalendarEvent, Email, EmailKeyPoints, EventGroup, UserSettings } from '../types'
import { scoreRelevance, compareTier, isRelevant, TIER_META, type RelevanceTier } from '../utils/relevance'
import ManualEventModal from '../components/ManualEventModal'

// ─── helpers ────────────────────────────────────────────────────────────────

function parseKeyPoints(raw: string | null): EmailKeyPoints | null {
  if (!raw) return null
  try { return JSON.parse(raw) as EmailKeyPoints } catch { return null }
}

function toLocalDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = iso.includes('T') ? iso.slice(0, 10) : iso
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function fmtFull(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMonthYear(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function daysUntil(d: Date | null): string | null {
  if (!d) return null
  const diff = Math.ceil((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff === 0) return 'today'
  return `in ${diff}d`
}

function fmtDate(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Backend-driven clustering ───────────────────────────────────────────────
// ActionItems now carry event_group_id from the backend, so we no longer need
// client-side union-find / token-similarity clustering.
// groupDayItems() builds EventCluster objects by grouping ActionItems using the
// backend-assigned event_group_id, then matches each group to a CalendarEvent
// by date + title proximity.
//
// canonicalize / keyTokens are still used WITHIN EventClusterCard for per-card
// action deduplication (collapsing "Attend Science Fair" and
// "Attend Kindergarten Science Fair" into one checklist row).

function canonicalize(text: string): string {
  return text
    .toLowerCase()
    // strip date patterns like "(3/12)", "3/12/2026", "tomorrow", "today"
    .replace(/\(\d{1,2}\/\d{1,2}(\/\d{2,4})?\)/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\b(tomorrow|today|this week|next week|reminder|re:|fwd:|fw:)\b/gi, '')
    // strip school name prefix patterns
    .replace(/^bif\s+(school\s+)?(newsletter|update|news)[–\-—]\s*/i, '')
    .replace(/^(newsletter|update)\s*/i, '')
    // strip trailing date suffixes like "– 3/9/2026"
    .replace(/[–\-—]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, '')
    // collapse whitespace
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Tokenize a canonical string into meaningful words (ignore short stop words)
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'is', 'are', 'will', 'be', 'with', 'your', 'our', 'this', 'that', 'it'])

function keyTokens(canon: string): Set<string> {
  return new Set(
    canon.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )
}

// ─── types for merged day events ────────────────────────────────────────────

interface DayCalEvent {
  kind: 'calendar'
  id: number
  title: string
  start: Date
  end: Date | null
  location: string | null
  description: string | null
}

interface DayActionItem {
  kind: 'action'
  id: number
  title: string
  description: string | null
  eventDate: Date | null
  prepStartDate: Date | null
  isShortNotice: boolean
  shortNoticeNote: string | null
  sourceType: 'email' | 'calendar' | 'combined' | 'manual'
  sourceEmailId: number | null
  eventGroupId: number | null
  completed: boolean
  itemType: string | null
}

// ─── grouped structure for the detail panel ──────────────────────────────────

interface ActionBundle {
  emailId: number | null
  email: Email | null
  kp: EmailKeyPoints | null
  items: DayActionItem[]
  hasShortNotice: boolean
  allCompleted: boolean
  tier: RelevanceTier
}

// An EventCluster corresponds to one backend EventGroup + optional matched
// CalendarEvent for display enrichment.
interface EventCluster {
  type: 'cluster'
  calEvent: DayCalEvent | null      // matched calendar event (if any)
  bundles: ActionBundle[]           // per-email groups of action items
  tier: RelevanceTier               // best (most specific) tier across all bundles
  eventTitle: string                // backend display_name (user-editable)
}

type DisplayGroup = EventCluster

// Generic/newsletter subjects regex — still used in EventClusterCard for
// display decisions (sorting, summary filtering, etc.).
const GENERIC_SUBJECT_RE = /^(newsletter|update|news|auxiliary|bif school newsletter|bif newsletter|\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*\|)|^friday photos|^weekly (update|recap|photos|highlights)|^(lower|upper) school (update|newsletter|news)/i

// ─── backend-driven grouping ──────────────────────────────────────────────────
//
// groupDayItems() uses pre-fetched EventGroup objects from the backend.
// Each group's items are already correctly deduplicated and assigned by Python.
// We just need to build ActionBundles (for per-email detail display) and match
// a CalendarEvent by date + title token similarity.

// Thresholds for matching a CalendarEvent to an EventGroup by title similarity.
// Deliberately lower than the clustering CLUSTER_THRESHOLD (0.35) because calendar
// titles are often abbreviated (e.g. "Science Fair" vs "Attend Kindergarten Science Fair").
const CAL_MATCH_JACCARD = 0.3
const CAL_MATCH_CONTAINMENT = 0.5

function groupDayItems(
  calEvents: DayCalEvent[],
  actionItems: DayActionItem[],
  groupById: Map<number, EventGroup>,  // pre-built once in clustersByDay useMemo
  emailMap: Map<number, Email>,
  childClassCode: string,
): DisplayGroup[] {
  const result: EventCluster[] = []

  // Partition action items by their event_group_id.
  // Items with no group_id (ungrouped) get their own synthetic group.
  const grouped = new Map<number | null, DayActionItem[]>()
  for (const ai of actionItems) {
    const gid = ai.eventGroupId
    const list = grouped.get(gid) ?? []
    list.push(ai)
    grouped.set(gid, list)
  }

  // Remaining cal events that haven't been claimed by any group
  const usedCalIds = new Set<number>()

  for (const [gid, items] of grouped) {
    const backendGroup = gid != null ? groupById.get(gid) : null
    const eventTitle = backendGroup?.display_name ?? items[0]?.title ?? 'Event'

    // Build per-email bundles for the detail accordion
    const emailItemsMap = new Map<number | null, DayActionItem[]>()
    for (const ai of items) {
      const key = ai.sourceEmailId
      const list = emailItemsMap.get(key) ?? []
      list.push(ai)
      emailItemsMap.set(key, list)
    }
    const bundles: ActionBundle[] = []
    for (const [emailId, bundleItems] of emailItemsMap) {
      const email = emailId != null ? (emailMap.get(emailId) ?? null) : null
      bundles.push({
        emailId,
        email,
        kp: email ? parseKeyPoints(email.key_points) : null,
        items: bundleItems,
        hasShortNotice: bundleItems.some(i => i.isShortNotice),
        allCompleted: bundleItems.every(i => i.completed),
        tier: scoreRelevance(email?.audience, childClassCode),
      })
    }

    // Sort bundles: most specific (non-newsletter) first, then by received date
    bundles.sort((a, b) => {
      const aNL = GENERIC_SUBJECT_RE.test(a.email?.subject ?? '') ? 1 : 0
      const bNL = GENERIC_SUBJECT_RE.test(b.email?.subject ?? '') ? 1 : 0
      if (aNL !== bNL) return aNL - bNL
      const da = a.email?.received_at ? new Date(a.email.received_at).getTime() : 0
      const db = b.email?.received_at ? new Date(b.email.received_at).getTime() : 0
      return da - db
    })

    // Best tier across all bundles
    const tier = bundles.reduce<RelevanceTier>((best, b) =>
      TIER_META[b.tier].priority < TIER_META[best].priority ? b.tier : best,
      bundles[0]?.tier ?? 'unknown'
    )

    // Match a calendar event by date + title token proximity
    let calEvent: DayCalEvent | null = null
    const titleTokens = keyTokens(canonicalize(eventTitle))
    for (const cal of calEvents) {
      if (usedCalIds.has(cal.id)) continue
      const calTokens = keyTokens(canonicalize(cal.title))
      // Jaccard similarity between event title and cal title
      let inter = 0
      for (const t of titleTokens) if (calTokens.has(t)) inter++
      const union = new Set([...titleTokens, ...calTokens]).size
      const sim = union === 0 ? 0 : inter / union
      if (sim >= CAL_MATCH_JACCARD || (titleTokens.size > 0 && inter / titleTokens.size >= CAL_MATCH_CONTAINMENT)) {
        calEvent = cal
        usedCalIds.add(cal.id)
        break
      }
    }

    result.push({ type: 'cluster', calEvent, bundles, tier, eventTitle })
  }

  // Standalone calendar events that didn't match any action group
  for (const cal of calEvents) {
    if (!usedCalIds.has(cal.id)) {
      result.push({
        type: 'cluster',
        calEvent: cal,
        bundles: [],
        tier: 'lower_school',
        eventTitle: cal.title,
      })
    }
  }

  // Sort: cal events first, then by tier
  result.sort((a, b) => {
    const aHasCal = a.calEvent !== null ? 0 : 1
    const bHasCal = b.calEvent !== null ? 0 : 1
    if (aHasCal !== bHasCal) return aHasCal - bHasCal
    return compareTier(a.tier, b.tier)
  })

  return result
}

// ─── mini badge ─────────────────────────────────────────────────────────────

function Dot({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7,
      borderRadius: '50%', background: color, flexShrink: 0, opacity,
    }} />
  )
}

// ─── Relevance badge ─────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: RelevanceTier }) {
  const meta = TIER_META[tier]
  if (!meta.label) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, borderRadius: 20,
      padding: '1px 7px', flexShrink: 0,
      background: meta.badgeBg, color: meta.badgeColor,
    }}>
      {meta.label}
    </span>
  )
}

// ─── Merged cluster card ──────────────────────────────────────────────────────

interface EventClusterCardProps {
  cluster: EventCluster
  defaultCollapsed?: boolean
  backendGroup?: EventGroup | null  // full backend group object, for manual ops
  onAddAction?: (group: EventGroup) => void
  onEditItem?: (item: ActionItem) => void
  onDeleteItem?: (itemId: number) => void
}

function EventClusterCard({ cluster, defaultCollapsed, backendGroup, onAddAction, onEditItem, onDeleteItem }: EventClusterCardProps) {
  const [showAnyway, setShowAnyway] = useState(!defaultCollapsed)
  // Which bundle's detail section is expanded (null = none)
  const [expandedBundleIdx, setExpandedBundleIdx] = useState<number | null>(null)

  const { calEvent, bundles, tier, eventTitle } = cluster

  // Aggregate across all bundles for the merged view
  const allItems = bundles.flatMap(b => b.items)
  const hasShortNotice = bundles.some(b => b.hasShortNotice)
  const allCompleted = allItems.length > 0 && allItems.every(i => i.completed)

  // Primary event date: earliest event_date across all action items or cal start
  const eventDates = [
    calEvent?.start ?? null,
    ...allItems.map(i => i.eventDate),
  ].filter(Boolean) as Date[]
  eventDates.sort((a, b) => a.getTime() - b.getTime())
  const primaryDate = eventDates[0] ?? null

  // Prep date
  const prepDates = allItems.map(i => i.prepStartDate).filter(Boolean) as Date[]
  prepDates.sort((a, b) => a.getTime() - b.getTime())
  const earliestPrep = prepDates[0] ?? null

  // Deduplicated action item titles across all bundles, scoped to this day's items only.
  // Step 1: exact dedup (case-insensitive).
  // Step 2: semantic dedup — collapse items that describe the same *action* regardless of wording.
  //
  // Key insight: all items on this card already refer to the same event, so the event name
  // tokens (e.g. "science fair") appear in nearly every item and are useless for distinguishing
  // actions from each other. We strip the cluster's own event canon from each item before
  // comparing, so only the action-specific tokens remain:
  //   "Attend Science Fair in Room 129"       → action tokens: {attend, room, 129}
  //   "Attend Kindergarten Science Fair"       → action tokens: {attend, kindergarten}
  //   "Plan for parking at the Science Fair"   → action tokens: {plan, parking}
  //   "Dress child in formal attire for Fair"  → action tokens: {dress, child, formal, attire}
  // Now the Attend-* items cluster together (share {attend}) but "Plan for parking" and
  // "Dress child" remain separate — which is exactly right.
  const exactDeduped: string[] = []
  const seenExact = new Set<string>()
  for (const b of bundles) {
    for (const item of b.items) {
      // Manual items are shown in the dedicated "Manually added" section with edit/delete —
      // skip them here so they don't create a duplicate in the "What you need to do" checklist.
      if (item.sourceType === 'manual') continue
      const norm = item.title.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!seenExact.has(norm)) {
        seenExact.add(norm)
        exactDeduped.push(item.title)
      }
    }
  }

  // Build a set of event-name tokens to strip before within-card comparison.
  // Use the cluster's best title canon + semanticCanon of the first non-newsletter bundle.
  const eventTokens = keyTokens(canonicalize(eventTitle))
  // Generic qualifier words that add nothing meaningful when appended to an event name.
  // "Update PikMyKid for MOEMS #5 Exam Day" → after stripping event tokens, only "day"
  // remains — that's a pure qualifier, not a distinct action.
  const QUALIFIER_WORDS = new Set(['day', 'morning', 'evening', 'night', 'time', 'date', 'event', 'now', 'soon', 'asap', 'today', 'tomorrow', 'reminder'])
  function actionOnlyTokens(title: string): Set<string> {
    const all = keyTokens(canonicalize(title))
    const filtered = new Set<string>()
    for (const t of all) if (!eventTokens.has(t)) filtered.add(t)
    // Return empty set if stripping leaves nothing (item IS the event name itself)
    // or only generic qualifier words — caller handles this case specially.
    const meaningful = new Set<string>()
    for (const t of filtered) if (!QUALIFIER_WORDS.has(t)) meaningful.add(t)
    return meaningful
  }
  function actionSimilarity(a: string, b: string): number {
    const ta = actionOnlyTokens(a)
    const tb = actionOnlyTokens(b)
    // Both empty (or only qualifiers) after stripping → both are just "do the event" → same
    if (ta.size === 0 && tb.size === 0) return 1
    // One is empty (pure event-name item), the other has meaningful action tokens → different
    if (ta.size === 0 || tb.size === 0) return 0
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    const union = new Set([...ta, ...tb]).size
    const jaccard = union === 0 ? 0 : inter / union
    const smaller = Math.min(ta.size, tb.size)
    // Containment only counts when the smaller set has ≥2 tokens, to avoid
    // single-token coincidences from over-merging
    const containment = smaller >= 2 ? inter / smaller : 0
    return Math.max(jaccard, containment)
  }

  // Union-find semantic dedup using action-only similarity
  const SEMANTIC_DEDUP_THRESHOLD = 0.5
  const reqParent = exactDeduped.map((_, i) => i)
  function reqFind(i: number): number {
    while (reqParent[i] !== i) { reqParent[i] = reqParent[reqParent[i]]; i = reqParent[i] }
    return i
  }
  for (let i = 0; i < exactDeduped.length; i++) {
    for (let j = i + 1; j < exactDeduped.length; j++) {
      if (reqFind(i) === reqFind(j)) continue
      const sim = actionSimilarity(exactDeduped[i], exactDeduped[j])
      if (sim >= SEMANTIC_DEDUP_THRESHOLD) {
        reqParent[reqFind(i)] = reqFind(j)
      }
    }
  }
  // For each group, pick the most informative representative:
  // most unique key tokens wins; break ties by shortest title (most concise)
  const reqGroups = new Map<number, string[]>()
  for (let i = 0; i < exactDeduped.length; i++) {
    const root = reqFind(i)
    const grp = reqGroups.get(root) ?? []
    grp.push(exactDeduped[i])
    reqGroups.set(root, grp)
  }
  const allReqs: string[] = []
  for (const grp of reqGroups.values()) {
    // Pick the item with the most key tokens; if tied, prefer the shortest title
    const best = grp.reduce((a, b) => {
      const la = keyTokens(canonicalize(a)).size
      const lb = keyTokens(canonicalize(b)).size
      if (la !== lb) return la > lb ? a : b
      return a.length <= b.length ? a : b
    })
    allReqs.push(best)
  }

  // Best summary: only use summaries from focused (non-newsletter) emails.
  // Newsletter summaries cover many unrelated topics and are misleading on a per-event card.
  const isNewsletter = (b: ActionBundle) =>
    GENERIC_SUBJECT_RE.test(b.email?.subject ?? '')
  const bestSummary = bundles.find(b => !isNewsletter(b))?.kp?.summary ?? null

  // Source label — count unique source emails, not sub-bundles
  // (newsletters are split into one sub-bundle per action item but still one email)
  const hasCalEvent = calEvent !== null
  const uniqueEmailIds = new Set(bundles.map(b => b.emailId).filter(id => id !== null))
  const emailCount = uniqueEmailIds.size
  const allManual = allItems.length > 0 && allItems.every(i => i.sourceType === 'manual')
  const hasManual = allItems.some(i => i.sourceType === 'manual')
  let sourceLabel = ''
  if (allManual) {
    sourceLabel = '✏️ Added manually'
  } else if (hasCalEvent && emailCount > 0) {
    sourceLabel = `📅 Calendar + ${emailCount} email${emailCount > 1 ? 's' : ''}`
  } else if (hasCalEvent) {
    sourceLabel = '📅 Calendar'
  } else {
    sourceLabel = `📬 ${emailCount} email${emailCount > 1 ? 's' : ''}`
  }
  if (!allManual && hasManual) sourceLabel += ' + ✏️ manual'
  const sourceBg = allManual ? '#f0fdf4' : hasCalEvent ? '#dbeafe' : '#fff7ed'
  const sourceColor = allManual ? '#166534' : hasCalEvent ? '#1d4ed8' : '#c2410c'

  if (!showAnyway) {
    return (
      <div style={gs.irrelevantStub}>
        <TierBadge tier={tier} />
        <span style={gs.irrelevantTitle}>{eventTitle}</span>
        <button style={gs.showAnywayBtn} onClick={() => setShowAnyway(true)}>
          Show anyway ▾
        </button>
      </div>
    )
  }

  return (
    <div style={{
      ...gs.card,
      ...(allCompleted ? gs.cardDone : {}),
      ...(tier === 'upper_school' ? gs.cardIrrelevant : {}),
    }}>
      {/* Top bar */}
      <div style={gs.cardTopBar}>
        <span style={{ ...gs.sourceTag, background: sourceBg, color: sourceColor }}>
          {sourceLabel}
        </span>
        <TierBadge tier={tier} />
        {hasShortNotice && <span style={gs.shortNoticeTag}>⚠️ Short notice</span>}
        {allCompleted && <span style={gs.doneTag}>✓ All done</span>}
        {tier === 'upper_school' && (
          <button style={gs.collapseBtn} onClick={() => setShowAnyway(false)}>Hide ▲</button>
        )}
      </div>

      {/* Event title */}
      <div style={gs.cardTitle}>{eventTitle}</div>

      {/* Date pills */}
      {(primaryDate || earliestPrep) && (
        <div style={gs.pillRow}>
          {primaryDate && (
            <span style={gs.datePill}>
              📅 {fmtDate(primaryDate)}
              <em style={gs.daysAway}> {daysUntil(primaryDate)}</em>
            </span>
          )}
          {calEvent?.location && (
            <span style={gs.locationPill}>📍 {calEvent.location}</span>
          )}
          {earliestPrep && (
            <span style={gs.prepPill}>🗓 Prep starts {fmtDate(earliestPrep)}</span>
          )}
        </div>
      )}

      {/* AI summary — best across all emails */}
      {bestSummary && (
        <div style={gs.summaryBox}>
          <span style={gs.summaryIcon}>✦</span>
          <span style={gs.summaryText}>{bestSummary}</span>
        </div>
      )}

      {/* Combined requirements checklist (deduplicated) */}
      {allReqs.length > 0 && (
        <div style={gs.section}>
          <div style={gs.sectionLabel}>What you need to do</div>
          <ul style={gs.checklist}>
            {allReqs.map((req, i) => (
              <li key={i} style={gs.checkItem}>
                <span style={gs.checkIcon}>○</span>
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Calendar event description */}
      {calEvent?.description && (
        <div style={gs.section}>
          <div style={gs.sectionLabel}>Calendar details</div>
          <div style={gs.cardDesc}>{calEvent.description.slice(0, 400)}</div>
        </div>
      )}

      {/* Short-notice note */}
      {hasShortNotice && (
        <div style={gs.urgentNote}>
          {bundles.flatMap(b => b.items)
            .find(i => i.isShortNotice && i.shortNoticeNote)?.shortNoticeNote}
        </div>
      )}

      {/* Manual item edit/delete controls — shown inline per-item */}
      {hasManual && (onEditItem || onDeleteItem) && (() => {
        const manualItems = allItems.filter(i => i.sourceType === 'manual')
        if (manualItems.length === 0) return null
        return (
          <div style={gs.section}>
            <div style={gs.sectionLabel}>Manually added</div>
            {manualItems.map((item, mi) => (
              <div key={mi} style={gs.manualItemRow}>
                <span style={gs.checkIcon}>{item.completed ? '✓' : '○'}</span>
                <div style={{ flex: 1 }}>
                  <div style={gs.expandedTitle}>{item.title}</div>
                  {item.description && <div style={gs.expandedDesc}>{item.description}</div>}
                </div>
                <div style={gs.manualItemActions}>
                  {onEditItem && (
                    <button
                      style={gs.manualBtn}
                      onClick={() => {
                        // Find the full ActionItem from the backend type — we need it for edit
                        onEditItem({ ...item, source_type: item.sourceType, event_date: item.eventDate?.toISOString().slice(0, 10) ?? null, prep_start_date: item.prepStartDate?.toISOString().slice(0, 10) ?? null, source_email_id: item.sourceEmailId, source_event_id: null, event_group_id: item.eventGroupId, is_short_notice: item.isShortNotice, short_notice_note: item.shortNoticeNote, lead_time_days: null, item_type: item.itemType, created_at: '' } as ActionItem)
                      }}
                    >Edit</button>
                  )}
                  {onDeleteItem && (
                    <button
                      style={{ ...gs.manualBtn, ...gs.manualBtnDelete }}
                      onClick={() => onDeleteItem(item.id)}
                    >Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* + Add action button — visible on every card if callback provided */}
      {onAddAction && backendGroup && (
        <button
          style={gs.addActionBtn}
          onClick={() => onAddAction(backendGroup)}
        >
          + Add action
        </button>
      )}

      {/* ── Sources section ── covers emails, calendar, and manual entries */}
      {(() => {
        // Separate bundles into email-sourced vs manual (emailId=null, source=manual)
        const emailBundles = bundles.filter(b => b.emailId != null)
        const hasEmailSources = emailBundles.length > 0
        const hasCalSource = calEvent !== null
        // Manual is already shown in "Manually added" section above — just show a
        // compact "Added by you" pill in the sources bar, not a full accordion row.

        if (!hasEmailSources && !hasCalSource) return null

        // Re-group email bundles by emailId so one newsletter → one accordion row
        const emailGroups = new Map<number, ActionBundle[]>()
        for (const b of emailBundles) {
          const eid = b.emailId!
          const grp = emailGroups.get(eid) ?? []
          grp.push(b)
          emailGroups.set(eid, grp)
        }
        const emailGroupList = [...emailGroups.entries()]
          .sort(([, ga], [, gb]) => {
            const aNL = GENERIC_SUBJECT_RE.test(ga[0].email?.subject ?? '') ? 1 : 0
            const bNL = GENERIC_SUBJECT_RE.test(gb[0].email?.subject ?? '') ? 1 : 0
            if (aNL !== bNL) return aNL - bNL
            const da = ga[0].email?.received_at ? new Date(ga[0].email.received_at).getTime() : 0
            const db = gb[0].email?.received_at ? new Date(gb[0].email.received_at).getTime() : 0
            return da - db
          })

        const receivedDates = emailGroupList
          .map(([, grp]) => grp[0].email?.received_at)
          .filter(Boolean)
          .map(s => new Date(s!))
        receivedDates.sort((a, b) => a.getTime() - b.getTime())
        const earliestReceived = receivedDates[0] ?? null

        // Build a human-readable source count label
        const parts: string[] = []
        if (hasCalSource) parts.push('Calendar')
        if (emailGroupList.length > 0) parts.push(`${emailGroupList.length} email${emailGroupList.length > 1 ? 's' : ''}`)
        if (hasManual) parts.push('Manual')
        const sourceCountLabel = parts.join(' · ')

        return (
          <div style={gs.sourcesSection}>
            <div style={{ ...gs.sectionLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Sources</span>
              <span style={{ fontWeight: 400, color: '#9a7060', fontSize: 11 }}>
                {sourceCountLabel}
              </span>
              {earliestReceived && (
                <span style={{ fontWeight: 400, color: '#9a7060', fontSize: 11 }}>
                  · received {earliestReceived.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>

            {/* Calendar source pill (non-expandable) */}
            {hasCalSource && (
              <div style={gs.sourceCalPill}>
                <span style={{ ...gs.sourceDot, background: '#6a9fd8' }} />
                <span style={gs.sourceSubject}>
                  📅 {calEvent!.title}
                  {calEvent!.start && (
                    <span style={{ fontWeight: 400, color: '#9a7060' }}>
                      {' '}· {fmtDate(calEvent!.start)}
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* Email source accordions */}
            {emailGroupList.map(([emailId, grpBundles], idx) => {
              const isOpen = expandedBundleIdx === idx
              const repBundle = grpBundles[0]
              const subjectLabel = repBundle.email?.subject ?? 'Email'
              const tierMeta = TIER_META[repBundle.tier]
              const bundleDates = repBundle.kp?.dates ?? []
              const nonNewsletterEmail = !GENERIC_SUBJECT_RE.test(repBundle.email?.subject ?? '')
              const bundleReceived = repBundle.email?.received_at
                ? new Date(repBundle.email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null
              const allBundleItems = grpBundles.flatMap(b => b.items)
              return (
                <div key={idx} style={gs.sourceItem}>
                  <button
                    style={{ ...gs.sourceItemHeader, background: isOpen ? '#fde8d8' : '#fdeee6' }}
                    onClick={() => setExpandedBundleIdx(isOpen ? null : idx)}
                  >
                    <span style={{ ...gs.sourceDot, background: nonNewsletterEmail ? '#e07b39' : '#9b6bbf' }} />
                    <span style={gs.sourceSubject}>
                      {subjectLabel.length > 55 ? subjectLabel.slice(0, 53) + '…' : subjectLabel}
                    </span>
                    {bundleReceived && (
                      <span style={{ fontSize: 11, color: '#9a7060', flexShrink: 0 }}>{bundleReceived}</span>
                    )}
                    {tierMeta.label && (
                      <span style={{
                        fontSize: 10, borderRadius: 20, padding: '1px 6px', flexShrink: 0,
                        background: tierMeta.badgeBg, color: tierMeta.badgeColor, fontWeight: 600,
                      }}>
                        {tierMeta.label}
                      </span>
                    )}
                    <span style={gs.sourceChevron}>{isOpen ? '▲' : '▾'}</span>
                  </button>
                  {isOpen && (
                    <div style={gs.sourceBody}>
                      {repBundle.kp?.summary && !isNewsletter(repBundle) && (
                        <div style={gs.sourceBodySummary}>{repBundle.kp.summary}</div>
                      )}
                      {allBundleItems.length > 0 && (
                        <div style={gs.expandedList}>
                          {allBundleItems.map((item, ii) => (
                            <div key={ii} style={{ ...gs.expandedItem, ...(item.completed ? gs.expandedItemDone : {}) }}>
                              <span style={gs.checkIcon}>{item.completed ? '✓' : '○'}</span>
                              <div>
                                <div style={gs.expandedTitle}>{item.title}</div>
                                {item.description && <div style={gs.expandedDesc}>{item.description}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {bundleDates.length > 0 && (
                        <>
                          <div style={{ ...gs.sectionLabel, marginTop: 8 }}>Key dates</div>
                          <div style={gs.dateGrid}>
                            {bundleDates.map((d, di) => (
                              <div key={di} style={gs.dateRow}>
                                <span style={gs.dateLabel}>{d.label}</span>
                                {d.date && <span style={gs.dateVal}>{d.date}</span>}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}

// ─── legend ──────────────────────────────────────────────────────────────────

function Legend({ childClassCode }: { childClassCode: string }) {
  return (
    <div style={styles.legend}>
      <span style={styles.legendItem}><Dot color="#6a9fd8" /> Calendar event</span>
      <span style={styles.legendItem}><Dot color="#e07b39" /> Email action</span>
      {childClassCode && (
        <>
          <span style={{ ...styles.legendItem, opacity: 0.45 }}><Dot color="#e07b39" opacity={0.45} /> Other grade</span>
        </>
      )}
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [emails, setEmails] = useState<Email[]>([])
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([])
  const [childClassCode, setChildClassCode] = useState('')
  const [loading, setLoading] = useState(true)

  // Manual event modal state
  type ModalState =
    | { type: 'new_event'; date: string | null }
    | { type: 'add_action'; group: EventGroup }
    | { type: 'edit_action'; item: ActionItem }
    | null
  const [modalState, setModalState] = useState<ModalState>(null)

  // Use a stable ref so the fetch useEffect never re-fires due to a new Date() object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useRef(new Date()).current
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const toISODate = useCallback((d: Date) => d.toISOString().slice(0, 10), [])

  // Refresh just action items + event groups (called after manual save/delete)
  const refreshActionData = useCallback(() => {
    const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 90)
    const toDate   = new Date(today); toDate.setDate(toDate.getDate() + 90)
    api.get<ActionItem[]>('/api/action-items', { params: { limit: 500 }, silent: true } as any)
      .then(r => setActionItems(r.data)).catch(() => {})
    api.get<EventGroup[]>('/api/event-groups', {
      params: { event_date_from: toISODate(fromDate), event_date_to: toISODate(toDate), include_completed: true },
      silent: true,
    } as any).then(r => setEventGroups(r.data)).catch(() => {})
  }, [today, toISODate])

  useEffect(() => {
    // Fetch ±90 days for event groups — covers roughly 3 months of navigation either side.
    // The calendar fetches a full year ahead for dots/chips; event group detail cards only
    // need the near-term window that the user is likely to view.
    const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 90)
    const toDate   = new Date(today); toDate.setDate(toDate.getDate() + 90)

    const p1 = api.get<CalendarEvent[]>('/api/calendar', { params: { days_ahead: 365 }, silent: true })
      .then(r => setCalEvents(r.data)).catch(() => {})
    const p2 = api.get<ActionItem[]>('/api/action-items', { params: { limit: 500 }, silent: true })
      .then(r => setActionItems(r.data)).catch(() => {})
    const p3 = api.get<Email[]>('/api/emails', { params: { limit: 200 }, silent: true })
      .then(r => setEmails(r.data)).catch(() => {})
    const p4 = api.get<UserSettings>('/api/settings', { silent: true } as any)
      .then(r => setChildClassCode(r.data.child_class_code || '')).catch(() => {})
    const p5 = api.get<EventGroup[]>('/api/event-groups', {
      params: { event_date_from: toISODate(fromDate), event_date_to: toISODate(toDate), include_completed: true },
      silent: true,
    } as any).then(r => setEventGroups(r.data)).catch(() => {})
    Promise.all([p1, p2, p3, p4, p5]).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const emailMap = useMemo(() => {
    const m = new Map<number, Email>()
    emails.forEach(e => m.set(e.id, e))
    return m
  }, [emails])

  const calEventsByDay = useMemo(() => {
    const m = new Map<string, DayCalEvent[]>()
    calEvents.forEach(ev => {
      const d = toLocalDate(ev.start_datetime)
      if (!d) return
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const list = m.get(key) ?? []
      list.push({
        kind: 'calendar',
        id: ev.id,
        title: ev.title ?? '(untitled)',
        start: d,
        end: toLocalDate(ev.end_datetime),
        location: ev.location,
        description: ev.description,
      })
      m.set(key, list)
    })
    return m
  }, [calEvents])

  const actionsByDay = useMemo(() => {
    const m = new Map<string, DayActionItem[]>()
    actionItems.forEach(ai => {
      const d = toLocalDate(ai.event_date)
      if (!d) return
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const list = m.get(key) ?? []
      list.push({
        kind: 'action',
        id: ai.id,
        title: ai.title,
        description: ai.description,
        eventDate: d,
        prepStartDate: toLocalDate(ai.prep_start_date),
        isShortNotice: ai.is_short_notice,
        shortNoticeNote: ai.short_notice_note,
        sourceType: ai.source_type,
        sourceEmailId: ai.source_email_id,
        eventGroupId: ai.event_group_id,
        completed: ai.completed,
        itemType: ai.item_type,
      })
      m.set(key, list)
    })
    return m
  }, [actionItems])

  // Pre-compute clusters for every day that has any data, so cell previews
  // show one entry per merged event (not one per source email).
  // Uses backend EventGroup assignments — no JS union-find needed here.
  // groupById is built once here and passed into groupDayItems to avoid
  // rebuilding the same Map on every per-day-key call.
  const clustersByDay = useMemo(() => {
    const m = new Map<string, DisplayGroup[]>()
    const groupById = new Map<number, EventGroup>()
    for (const g of eventGroups) groupById.set(g.id, g)

    const allKeys = new Set([
      ...calEventsByDay.keys(),
      ...actionsByDay.keys(),
    ])
    for (const key of allKeys) {
      const cals = calEventsByDay.get(key) ?? []
      const acts = actionsByDay.get(key) ?? []
      m.set(key, groupDayItems(cals, acts, groupById, emailMap, childClassCode))
    }
    return m
  }, [calEventsByDay, actionsByDay, eventGroups, emailMap, childClassCode])

  const { weeks, monthStart } = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startOffset = first.getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d))
    while (cells.length % 7 !== 0) cells.push(null)
    const w: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7))
    return { weeks: w, monthStart: first }
  }, [viewYear, viewMonth])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedDate(null)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedDate(null)
  }
  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    setSelectedDate(today)
  }

  function dayKey(d: Date) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  }

  const selectedGroups = useMemo((): DisplayGroup[] => {
    if (!selectedDate) return []
    return clustersByDay.get(dayKey(selectedDate)) ?? []
  }, [selectedDate, clustersByDay])

  // Summary counts for detail panel header
  const groupSummary = useMemo(() => {
    const total = selectedGroups.length
    const mineCount = selectedGroups.filter(g => g.tier === 'mine').length
    const gradeCount = selectedGroups.filter(g => g.tier === 'grade').length
    const schoolCount = selectedGroups.filter(g => g.tier === 'lower_school' || g.tier === 'whole_school').length
    const hiddenCount = selectedGroups.filter(g => !isRelevant(g.tier)).length
    const hasCalEvent = selectedGroups.some(g => g.calEvent !== null)
    return { total, mineCount, gradeCount, schoolCount, hiddenCount, hasCalEvent }
  }, [selectedGroups])

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div style={styles.page}>
      <div style={styles.legendRow}>
        <Legend childClassCode={childClassCode} />
      </div>

      {loading && <p style={styles.loadMsg}>Loading…</p>}

      {!loading && (
        <div style={styles.layout}>
          {/* ── Calendar panel ── */}
          <div style={styles.calPanel}>
            <div style={styles.monthNav}>
              <button style={styles.navBtn} onClick={prevMonth}>‹</button>
              <span style={styles.monthLabel}>{fmtMonthYear(monthStart)}</span>
              <button style={styles.navBtn} onClick={nextMonth}>›</button>
              <button style={styles.todayBtn} onClick={goToday}>Today</button>
              <button
                style={styles.addEventBtn}
                onClick={() => setModalState({
                  type: 'new_event',
                  date: selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}-${String(selectedDate.getDate()).padStart(2,'0')}` : null,
                })}
              >
                + Add event
              </button>
            </div>

            <div style={styles.dowRow}>
              {DOW.map(d => (
                <div key={d} style={styles.dowCell}>{d}</div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} style={styles.weekRow}>
                {week.map((cell, ci) => {
                  if (!cell) {
                    return <div key={ci} style={{ ...styles.emptyCell, ...(ci === 6 ? { borderRight: 'none' } : { borderRight: '1px solid #c9845e' }) }} />
                  }
                  const key = dayKey(cell)
                  // Use pre-computed clusters — one entry per merged event
                  const dayClusters = clustersByDay.get(key) ?? []

                  const isToday = isSameDay(cell, today)
                  const isSelected = selectedDate ? isSameDay(cell, selectedDate) : false

                  return (
                    <div
                      key={ci}
                      onClick={() => setSelectedDate(isSelected ? null : cell)}
                      style={{
                        ...styles.dayCell,
                        ...(ci === 6 ? { borderRight: 'none' } : {}),
                        ...(isToday ? styles.todayCell : {}),
                        ...(isSelected ? styles.selectedCell : {}),
                      }}
                    >
                      <span style={{
                        ...styles.dayNum,
                        ...(isToday ? styles.todayNum : {}),
                        ...(isSelected ? styles.selectedNum : {}),
                      }}>
                        {cell.getDate()}
                      </span>

                      {/* One dot per cluster — color by source type, opacity by tier */}
                      <div style={styles.dotsRow}>
                        {dayClusters.slice(0, 4).map((cluster, i) => {
                          const hasCal = cluster.calEvent !== null
                          const hasEmail = cluster.bundles.length > 0
                          const color = hasCal && hasEmail ? '#6a9fd8'  // combined: blue
                            : hasCal ? '#6a9fd8'                         // cal only: blue
                            : '#e07b39'                                  // email only: orange
                          const opacity = TIER_META[cluster.tier].dotOpacity
                          return <Dot key={i} color={color} opacity={opacity} />
                        })}
                      </div>

                      {/* One chip per cluster, using the merged event title */}
                      <div style={styles.previewList}>
                        {dayClusters.slice(0, 2).map((cluster, i) => {
                          const hasCal = cluster.calEvent !== null
                          const isIrrelevant = !isRelevant(cluster.tier)
                          const label = cluster.eventTitle
                          return (
                            <div key={i} style={{
                              ...styles.previewChip,
                              background: isIrrelevant ? '#f3f4f6'
                                : hasCal ? '#dceeff'
                                : '#fdecd8',
                              color: isIrrelevant ? '#9ca3af'
                                : hasCal ? '#2e6fad'
                                : '#a3480f',
                              opacity: isIrrelevant ? 0.6 : 1,
                            }}>
                              {label.length > 18 ? label.slice(0, 16) + '…' : label}
                            </div>
                          )
                        })}
                        {dayClusters.length > 2 && (
                          <div style={styles.moreChip}>+{dayClusters.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* ── Detail panel ── */}
          {selectedDate && (
            <div style={styles.detailPanel}>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.detailDate}>{fmtFull(selectedDate)}</div>
                  {selectedGroups.length > 0 && (
                    <div style={styles.detailSummary}>
                      {[
                        groupSummary.total > 0 && `${groupSummary.total} event${groupSummary.total > 1 ? 's' : ''}`,
                        groupSummary.mineCount > 0 && `${groupSummary.mineCount} your class`,
                        groupSummary.gradeCount > 0 && `${groupSummary.gradeCount} grade-wide`,
                        groupSummary.schoolCount > 0 && `${groupSummary.schoolCount} school-wide`,
                        groupSummary.hiddenCount > 0 && `${groupSummary.hiddenCount} other grade (collapsed)`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <button style={styles.closeBtn} onClick={() => setSelectedDate(null)}>✕</button>
              </div>

              {selectedGroups.length === 0 && (
                <div style={styles.noItems}>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>
                    No events or action items on this day.
                  </p>
                </div>
              )}

              <div style={styles.detailList}>
                {selectedGroups.map((group, i) => {
                  // Find the backend EventGroup for this cluster (by matching display_name + date,
                  // or by checking if any item has a matching event_group_id)
                  const firstGroupId = group.bundles.flatMap(b => b.items).find(ai => ai.eventGroupId != null)?.eventGroupId ?? null
                  const backendGroup = firstGroupId != null ? eventGroups.find(g => g.id === firstGroupId) ?? null : null
                  return (
                    <EventClusterCard
                      key={`cluster-${i}`}
                      cluster={group}
                      defaultCollapsed={!isRelevant(group.tier)}
                      backendGroup={backendGroup}
                      onAddAction={backendGroup ? (g) => setModalState({ type: 'add_action', group: g }) : undefined}
                      onEditItem={(item) => setModalState({ type: 'edit_action', item })}
                      onDeleteItem={async (itemId) => {
                        if (!window.confirm('Delete this manually added action?')) return
                        await api.delete(`/api/action-items/${itemId}`)
                        refreshActionData()
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Manual event modal ── */}
      {modalState?.type === 'new_event' && (
        <ManualEventModal
          mode="new_event"
          initialDate={modalState.date}
          onSaved={(group) => {
            setModalState(null)
            refreshActionData()
            // Auto-select the event's date on the calendar if set
            if (group.event_date) {
              const [y, m, d] = group.event_date.split('-').map(Number)
              setSelectedDate(new Date(y, m - 1, d))
              setViewYear(y); setViewMonth(m - 1)
            }
          }}
          onClose={() => setModalState(null)}
        />
      )}
      {modalState?.type === 'add_action' && (
        <ManualEventModal
          mode="add_action"
          targetGroup={modalState.group}
          onSaved={() => { setModalState(null); refreshActionData() }}
          onClose={() => setModalState(null)}
        />
      )}
      {modalState?.type === 'edit_action' && (
        <ManualEventModal
          mode="edit_action"
          item={modalState.item}
          onSaved={() => { setModalState(null); refreshActionData() }}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  )
}

// ─── page & calendar styles ───────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 0 },

  legendRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 },
  legend: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#7a3318' },

  loadMsg: { textAlign: 'center', color: '#b89a7a', padding: 40 },

  layout: { display: 'flex', gap: 20, alignItems: 'flex-start', minWidth: 0 },

  calPanel: {
    flex: '1 1 0', minWidth: 0,
    background: '#fdeee6', borderRadius: 16,
    border: '3px solid #b94f1a', overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(180,80,30,0.22)',
  },

  monthNav: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 20px', borderBottom: '2px solid #c87a5c',
    background: 'linear-gradient(135deg, #f5c4a8 0%, #f7d4bc 100%)',
  },
  navBtn: {
    background: '#fce8d8', border: '1px solid #c87a5c', borderRadius: 8,
    width: 32, height: 32, cursor: 'pointer', fontSize: 18, color: '#7a3318',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  monthLabel: { flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 16, color: '#5a2010' },
  todayBtn: {
    background: '#fce8d8', border: '1px solid #c87a5c', borderRadius: 8,
    padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#7a3318', fontWeight: 600,
    flexShrink: 0,
  },
  addEventBtn: {
    background: '#b94f1a', border: 'none', borderRadius: 8,
    padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600,
    flexShrink: 0, marginLeft: 4,
  },

  dowRow: {
    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    borderBottom: '2px solid #c87a5c', background: '#f5c4a8',
  },
  dowCell: {
    textAlign: 'center', padding: '8px 0', fontSize: 12,
    fontWeight: 700, color: '#7a3318', letterSpacing: '0.06em', minWidth: 0,
  },

  weekRow: {
    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gridAutoRows: '100px', borderBottom: '1px solid #c9845e',
  },

  emptyCell: { background: '#f7d9c8' },
  dayCell: {
    padding: '6px 6px 4px', cursor: 'pointer',
    borderRight: '1px solid #c9845e', transition: 'background 0.12s',
    background: '#fdeee6', position: 'relative', overflow: 'hidden',
    minWidth: 0, boxSizing: 'border-box',
  },
  todayCell: {},
  selectedCell: { background: '#f9b98a', outline: '2px solid #b94f1a', outlineOffset: -2, zIndex: 1 },

  dayNum: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: '50%', fontSize: 13,
    fontWeight: 500, color: '#5a2010', marginBottom: 2, flexShrink: 0,
  },
  todayNum: { background: '#b94f1a', color: '#fff', fontWeight: 700 },
  selectedNum: { color: '#7a1a00', fontWeight: 700 },

  dotsRow: { display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 3 },

  previewList: { display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  previewChip: {
    fontSize: 10, fontWeight: 500, borderRadius: 4, padding: '1px 4px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    lineHeight: 1.5, display: 'block',
  },
  moreChip: { fontSize: 10, color: '#a05030', padding: '1px 2px', whiteSpace: 'nowrap' },

  detailPanel: {
    flex: 1, minWidth: 0, background: '#fdeee6', borderRadius: 16,
    border: '3px solid #b94f1a', boxShadow: '0 4px 20px rgba(180,80,30,0.22)',
    overflow: 'hidden', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto',
  },
  detailHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '2px solid #c87a5c',
    background: 'linear-gradient(135deg, #f5c4a8 0%, #f7d4bc 100%)',
    position: 'sticky', top: 0, zIndex: 2,
  },
  detailDate: { fontWeight: 700, fontSize: 15, color: '#5a2010' },
  detailSummary: { fontSize: 12, color: '#92714a', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, color: '#c87a5c', padding: '0 4px', flexShrink: 0,
  },
  noItems: { padding: '32px 20px', textAlign: 'center' },
  detailList: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
}

// ─── event cluster card styles ────────────────────────────────────────────────

const gs: Record<string, React.CSSProperties> = {
  card: {
    background: '#fce4d4', borderRadius: 12,
    border: '1px solid #c9845e', padding: '14px 16px',
  },
  cardDone: { opacity: 0.65 },
  cardIrrelevant: {
    background: '#f9f9f9', border: '1px solid #e5e7eb', opacity: 0.8,
  },

  irrelevantStub: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: '#f3f4f6', border: '1px dashed #d1d5db', borderRadius: 10,
    padding: '8px 12px',
  },
  irrelevantTitle: {
    flex: 1, fontSize: 13, color: '#6b7280',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  showAnywayBtn: {
    background: 'none', border: '1px solid #d1d5db', borderRadius: 6,
    padding: '2px 8px', cursor: 'pointer', fontSize: 11, color: '#6b7280',
    flexShrink: 0,
  },
  collapseBtn: {
    marginLeft: 'auto', background: 'none', border: '1px solid #d1d5db',
    borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
    fontSize: 11, color: '#6b7280', flexShrink: 0,
  },

  cardTopBar: {
    display: 'flex', alignItems: 'center', gap: 6,
    flexWrap: 'wrap', marginBottom: 6,
  },
  sourceTag: {
    fontSize: 11, fontWeight: 600, borderRadius: 20,
    padding: '2px 8px', flexShrink: 0,
  },
  shortNoticeTag: {
    fontSize: 11, fontWeight: 600, borderRadius: 20,
    padding: '2px 8px', background: '#fef3c7', color: '#92400e', flexShrink: 0,
  },
  doneTag: {
    fontSize: 11, fontWeight: 600, borderRadius: 20,
    padding: '2px 8px', background: '#d1fae5', color: '#065f46', flexShrink: 0,
  },

  cardTitle: { fontWeight: 700, fontSize: 15, color: '#5a2010', marginBottom: 8, lineHeight: 1.3 },
  cardDesc: { fontSize: 13, color: '#6b4c2a', lineHeight: 1.55, marginTop: 6 },

  pillRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  datePill: {
    background: '#dbeafe', color: '#1d4ed8', borderRadius: 6,
    padding: '3px 10px', fontSize: 12, fontWeight: 500,
  },
  daysAway: { fontStyle: 'italic', fontWeight: 400 },
  locationPill: {
    background: '#fdeee6', color: '#7a4a2a', borderRadius: 6,
    padding: '3px 10px', fontSize: 12, fontWeight: 500,
  },
  prepPill: {
    background: '#d1fae5', color: '#065f46', borderRadius: 6,
    padding: '3px 10px', fontSize: 12, fontWeight: 500,
  },

  summaryBox: {
    display: 'flex', gap: 6, alignItems: 'flex-start',
    background: 'linear-gradient(135deg, #f0f7ff 0%, #faf5ff 100%)',
    border: '1px solid #c7d9f5', borderRadius: 8,
    padding: '10px 12px', marginBottom: 10,
  },
  summaryIcon: { color: '#6366f1', fontSize: 12, flexShrink: 0, marginTop: 2 },
  summaryText: { fontSize: 13, color: '#1e293b', lineHeight: 1.55 },

  section: { marginTop: 10 },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: '#7a3318', textTransform: 'uppercase' as const,
    letterSpacing: '0.07em', marginBottom: 6,
  },
  checklist: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 },
  checkItem: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    fontSize: 13, color: '#3d2010', lineHeight: 1.45,
  },
  checkIcon: { color: '#c87a5c', fontSize: 14, flexShrink: 0, marginTop: 1 },

  dateGrid: { display: 'flex', flexDirection: 'column', gap: 0 },
  dateRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    gap: 8, fontSize: 12, color: '#334155', padding: '4px 0',
    borderBottom: '1px dashed #d9aa88',
  },
  dateLabel: { fontWeight: 500, color: '#5a2010' },
  dateVal: { color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap' as const },

  urgentNote: {
    marginTop: 10, fontSize: 13, color: '#b45309',
    fontStyle: 'italic', lineHeight: 1.5,
  },

  // Sources section
  sourcesSection: { marginTop: 14 },
  sourceCalPill: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 12px', marginBottom: 6,
    background: '#eef4ff', border: '1px solid #bdd4f5', borderRadius: 8,
    fontSize: 13, color: '#1e3a6e',
  },
  sourceItem: {
    borderRadius: 8, overflow: 'hidden',
    border: '1px solid #d9aa88', marginBottom: 6,
  },
  sourceItemHeader: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left' as const,
    fontSize: 13, color: '#3d2010',
  },
  sourceDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  sourceSubject: {
    flex: 1, fontWeight: 500, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  sourceChevron: { fontSize: 10, color: '#c87a5c', flexShrink: 0 },
  sourceBody: {
    padding: '10px 14px', background: '#fff8f4',
    borderTop: '1px solid #d9aa88',
  },
  sourceBodySummary: {
    fontSize: 12, color: '#5a3020', lineHeight: 1.55, marginBottom: 4,
  },

  expandedList: {
    marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4,
  },
  expandedItem: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '4px 0', borderBottom: '1px dashed #d9aa88',
  },
  expandedItemDone: { opacity: 0.5 },
  expandedTitle: { fontSize: 13, fontWeight: 500, color: '#3d2010' },
  expandedDesc: { fontSize: 12, color: '#7a4a2a', marginTop: 2, lineHeight: 1.4 },

  // Manual item rows (edit/delete)
  manualItemRow: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '6px 0', borderBottom: '1px dashed #d9aa88',
  },
  manualItemActions: { display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' },
  manualBtn: {
    fontSize: 11, padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569',
  },
  manualBtnDelete: { color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' },

  // + Add action button at bottom of card
  addActionBtn: {
    marginTop: 12, width: '100%', padding: '7px', borderRadius: 8, cursor: 'pointer',
    border: '1px dashed #c87a5c', background: 'transparent', color: '#7a3318',
    fontSize: 13, fontWeight: 600, textAlign: 'center' as const,
  },
}
