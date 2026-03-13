import { useEffect, useState, useMemo } from 'react'
import api from '../api/client'
import type { ActionItem, CalendarEvent, Email, EmailKeyPoints, UserSettings } from '../types'
import { scoreRelevance, compareTier, isRelevant, TIER_META, type RelevanceTier } from '../utils/relevance'

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

// ─── event name canonicalization for clustering ──────────────────────────────
// Strips noise words so "Reminder: Science Fair Tomorrow" and "Science Fair (3/12)"
// both reduce to "science fair", enabling fuzzy matching.

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

// Returns [0, 1] — max of Jaccard similarity and containment score.
// Containment = |intersection| / |smaller set|: catches cases where one title
// is a subset of another, e.g. "Pi Contest Details" ⊆ "Pi Memorization Contest"
// where they share "contest" (1/2 of the smaller set = 0.5 > threshold).
function tokenSimilarity(a: string, b: string): number {
  const ta = keyTokens(a)
  const tb = keyTokens(b)
  if (ta.size === 0 && tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = new Set([...ta, ...tb]).size
  const jaccard = union === 0 ? 0 : inter / union
  const smaller = Math.min(ta.size, tb.size)
  const containment = smaller === 0 ? 0 : inter / smaller
  return Math.max(jaccard, containment)
}

// Threshold: two items are the "same event" if similarity >= this
const CLUSTER_THRESHOLD = 0.35

// ─── semantic canon from AI summaries / cal descriptions ─────────────────────
// Extracts the first sentence from an AI-generated summary or calendar description,
// then canonicalizes it. This gives a richer signal than the email subject alone:
//   summary: "The Kindergarten Helium class is holding a Science Fair..."
//   → "kindergarten helium class holding science fair"
//   description: "Calling all math lovers! To celebrate Pi Day (3.14)..."
//   → "calling math lovers celebrate day"
// We cap at the first sentence (≤ 200 chars) to avoid noise from long prose.
function extractSemanticCanon(text: string | null | undefined): string {
  if (!text) return ''
  // Take text up to the first sentence-ending punctuation or first 200 chars
  const match = text.match(/^(.{10,200}?[.!?])/)
  const sentence = match ? match[1] : text.slice(0, 200)
  return canonicalize(sentence)
}

// Combined similarity: max of subject-based AND semantic-based signal.
// If either the email subject OR the AI summary indicates two items are about
// the same event, they should cluster together.
function combinedSimilarity(
  subjectCanon: string, semanticCanon: string,
  otherSubjectCanon: string, otherSemanticCanon: string,
): number {
  const scores = [
    subjectCanon && otherSubjectCanon ? tokenSimilarity(subjectCanon, otherSubjectCanon) : 0,
    subjectCanon && otherSemanticCanon ? tokenSimilarity(subjectCanon, otherSemanticCanon) : 0,
    semanticCanon && otherSubjectCanon ? tokenSimilarity(semanticCanon, otherSubjectCanon) : 0,
    semanticCanon && otherSemanticCanon ? tokenSimilarity(semanticCanon, otherSemanticCanon) : 0,
  ]
  return Math.max(...scores)
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
  sourceType: 'email' | 'calendar' | 'combined'
  sourceEmailId: number | null
  completed: boolean
}

type DayItem = DayCalEvent | DayActionItem

// ─── grouped structure for the detail panel ──────────────────────────────────

interface ActionBundle {
  emailId: number | null
  email: Email | null
  kp: EmailKeyPoints | null
  items: DayActionItem[]
  hasShortNotice: boolean
  allCompleted: boolean
  tier: RelevanceTier
  canon: string          // canonical event name from email subject for clustering
  semanticCanon: string  // canonical text from AI-extracted summary (first sentence)
  primaryDate: Date | null  // dominant event date across this bundle's items
}

// An EventCluster groups one or more ActionBundles + optional CalendarEvent
// that all refer to the same real-world event.
interface EventCluster {
  type: 'cluster'
  calEvent: DayCalEvent | null      // matched calendar event (if any)
  bundles: ActionBundle[]           // email bundles about this event
  tier: RelevanceTier               // best (most specific) tier across all bundles
  eventTitle: string                // best human-readable event name
}

type DisplayGroup = EventCluster

// ─── clustering engine ────────────────────────────────────────────────────────

// Generic/newsletter/recap subjects that carry no single-event signal.
// These are digest emails that mention many events — their subjects are useless
// for clustering (we fall back to action item titles instead).
const GENERIC_SUBJECT_RE = /^(newsletter|update|news|auxiliary|bif school newsletter|bif newsletter|\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*\|)|^friday photos|^weekly (update|recap|photos|highlights)|^(lower|upper) school (update|newsletter|news)/i

function buildBundleCanon(email: Email | null, items: DayActionItem[]): string {
  const subject = email?.subject ?? ''
  const subjectCanon = canonicalize(subject)

  // If the subject is a generic container (newsletter, auxiliary digest, etc.)
  // its canon is useless for clustering. Fall back to the most informative
  // action item title — e.g. "Attend Kindergarten Science Fair" → "science fair"
  if (!subjectCanon || GENERIC_SUBJECT_RE.test(subject)) {
    // Pick the action item title with the most tokens after canonicalization
    const itemCanons = items
      .map(i => canonicalize(i.title))
      .filter(c => c.length > 0)
      .sort((a, b) => b.split(' ').length - a.split(' ').length)
    return itemCanons[0] ?? subjectCanon
  }

  return subjectCanon
}

// Return the most-frequent event date among a bundle's items.
// If items have mixed dates (rare: one email mentions two different events),
// we pick the modal date. This becomes the hard clustering gate.
function bundlePrimaryDate(items: DayActionItem[]): Date | null {
  const counts = new Map<string, { date: Date; count: number }>()
  for (const item of items) {
    if (!item.eventDate) continue
    const key = `${item.eventDate.getFullYear()}-${item.eventDate.getMonth()}-${item.eventDate.getDate()}`
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { date: item.eventDate, count: 1 })
  }
  if (counts.size === 0) return null
  // Return the date with the highest count
  let best: { date: Date; count: number } | null = null
  for (const v of counts.values()) {
    if (!best || v.count > best.count) best = v
  }
  return best?.date ?? null
}

function buildCalCanon(ev: DayCalEvent): string {
  return canonicalize(ev.title)
}

// Pick the most informative event title from a cluster.
// Strategy: score every candidate (email subjects + cal title) by how well it
// matches the cluster's representative semantic/subject canon, then return the
// best-scoring one. This prevents digest/recap subjects like "Friday Photos" from
// winning over "Invited to BIF Holi Fest!" even though the former is shorter.
function bestTitle(cluster: EventCluster): string {
  // The representative canon is the merged signal we used for clustering
  const repCanon = cluster.bundles[0]?.semanticCanon || cluster.bundles[0]?.canon || ''

  // Candidate pool: calendar event title + all email subjects
  const candidates: { text: string; score: number }[] = []

  if (cluster.calEvent?.title) {
    const c = canonicalize(cluster.calEvent.title)
    candidates.push({ text: cluster.calEvent.title, score: repCanon ? tokenSimilarity(repCanon, c) + 0.1 : 0.5 })
  }

  for (const b of cluster.bundles) {
    const subj = b.email?.subject ?? ''
    if (!subj) continue
    // Skip generic digest/recap subjects entirely — they never make good titles
    if (GENERIC_SUBJECT_RE.test(subj)) continue
    const c = canonicalize(subj)
    const score = repCanon ? tokenSimilarity(repCanon, c) : 0
    candidates.push({ text: subj, score })
  }

  if (candidates.length > 0) {
    // Return the highest-scoring candidate; break ties by preferring shorter text
    candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    return candidates[0].text
  }

  // Last resort: first action item title across all bundles
  return cluster.bundles[0]?.items[0]?.title ?? 'Event'
}

// Best canon to represent a set of bundles for cluster-level similarity checks.
// Picks the most specific (longest token set) non-generic canon from the group.
function bestCanon(bundles: ActionBundle[]): { canon: string; semanticCanon: string } {
  let best: ActionBundle | null = null
  let bestLen = -1
  for (const b of bundles) {
    const len = keyTokens(b.canon).size + keyTokens(b.semanticCanon).size
    if (len > bestLen) { best = b; bestLen = len }
  }
  return { canon: best?.canon ?? '', semanticCanon: best?.semanticCanon ?? '' }
}

function clusterGroups(
  calEvents: DayCalEvent[],
  bundles: ActionBundle[],
): EventCluster[] {
  // Start with one cluster per bundle
  const clusters: EventCluster[] = bundles.map(b => ({
    type: 'cluster',
    calEvent: null,
    bundles: [b],
    tier: b.tier,
    eventTitle: b.email?.subject ?? b.items[0]?.title ?? 'Event',
  }))

  // Union-find with root-level canon tracking.
  // We track the best (most specific) canon for each root so that as clusters
  // grow, merge decisions are made against the cluster's sharpest signal —
  // preventing generic newsletter bundles from transitively bridging unrelated
  // events (e.g. Science Fair and MOEMS both mentioned in one newsletter).
  const parent = clusters.map((_, i) => i)
  // Cache of the best canon for each root index (updated on unite)
  const rootCanon: Array<{ canon: string; semanticCanon: string }> = clusters.map(c => ({
    canon: c.bundles[0].canon,
    semanticCanon: c.bundles[0].semanticCanon,
  }))

  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  function unite(a: number, b: number) {
    const ra = find(a); const rb = find(b)
    if (ra === rb) return
    parent[ra] = rb
    // Merge the best canon: pick whichever root had the most specific tokens
    const ca = rootCanon[ra]; const cb = rootCanon[rb]
    const lenA = keyTokens(ca.canon).size + keyTokens(ca.semanticCanon).size
    const lenB = keyTokens(cb.canon).size + keyTokens(cb.semanticCanon).size
    rootCanon[rb] = lenA >= lenB ? ca : cb
  }

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const bi = clusters[i].bundles[0]
      const bj = clusters[j].bundles[0]

      // Hard gate: if both bundles have a known primary date, they MUST share
      // the same calendar day to be considered the same event.
      // This prevents a "Science Fair 2026" from merging with a future
      // "Science Fair 2027" that happens to appear in the same DB.
      const di = bi.primaryDate
      const dj = bj.primaryDate
      if (di && dj && !isSameDay(di, dj)) continue

      // Compare root-level canons (the sharpest signal for each cluster so far),
      // not just the original bundle pair. This stops transitive false merges:
      // if the Science Fair cluster has already absorbed a newsletter and its
      // root canon is now "science fair", a MOEMS bundle won't match it.
      const ri = find(i); const rj = find(j)
      const ci = rootCanon[ri]; const cj = rootCanon[rj]
      const sim = combinedSimilarity(ci.canon, ci.semanticCanon, cj.canon, cj.semanticCanon)
      if (sim >= CLUSTER_THRESHOLD) {
        unite(i, j)
      }
    }
  }

  // Group by root
  const rootMap = new Map<number, EventCluster>()
  for (let i = 0; i < clusters.length; i++) {
    const root = find(i)
    if (!rootMap.has(root)) {
      rootMap.set(root, { type: 'cluster', calEvent: null, bundles: [], tier: 'unknown', eventTitle: '' })
    }
    const merged = rootMap.get(root)!
    merged.bundles.push(...clusters[i].bundles)
  }

  // Assign calendar events to matching clusters (or create standalone clusters for them)
  const usedCals = new Set<number>()
  for (const cluster of rootMap.values()) {
    const repBundle = cluster.bundles[0]
    if (!repBundle) continue
    const repSubjectCanon = repBundle.canon
    const repSemanticCanon = repBundle.semanticCanon
    for (const cal of calEvents) {
      if (usedCals.has(cal.id)) continue
      const calTitleCanon = buildCalCanon(cal)
      const calDescCanon = extractSemanticCanon(cal.description)
      const sim = combinedSimilarity(repSubjectCanon, repSemanticCanon, calTitleCanon, calDescCanon)
      if (sim >= CLUSTER_THRESHOLD) {
        cluster.calEvent = cal
        usedCals.add(cal.id)
        break
      }
    }
  }
  // Remaining unmatched calendar events get their own cluster
  for (const cal of calEvents) {
    if (!usedCals.has(cal.id)) {
      rootMap.set(-cal.id, {
        type: 'cluster',
        calEvent: cal,
        bundles: [],
        tier: 'lower_school',
        eventTitle: cal.title,
      })
    }
  }

  // Finalize each cluster
  const result: EventCluster[] = []
  for (const cluster of rootMap.values()) {
    // Best tier = lowest priority number across all bundles
    const tiers = cluster.bundles.map(b => b.tier)
    cluster.tier = tiers.reduce((best, t) =>
      TIER_META[t].priority < TIER_META[best].priority ? t : best,
      tiers[0] ?? 'unknown'
    )
    // Sort bundles within the cluster: most specific first, then by date received
    cluster.bundles.sort((a, b) => {
      const ta = TIER_META[a.tier].priority
      const tb = TIER_META[b.tier].priority
      if (ta !== tb) return ta - tb
      // More specific email subjects first (non-newsletter)
      const aNL = /newsletter|update|news/i.test(a.email?.subject ?? '') ? 1 : 0
      const bNL = /newsletter|update|news/i.test(b.email?.subject ?? '') ? 1 : 0
      return aNL - bNL
    })
    cluster.eventTitle = bestTitle(cluster)
    result.push(cluster)
  }

  // Sort clusters: cal events first, then by tier, then unresolved/unknown last
  result.sort((a, b) => {
    const aHasCal = a.calEvent !== null ? 0 : 1
    const bHasCal = b.calEvent !== null ? 0 : 1
    if (aHasCal !== bHasCal) return aHasCal - bHasCal
    return compareTier(a.tier, b.tier)
  })

  return result
}

function makeBundle(
  key: number | null,
  email: Email | null,
  kp: ReturnType<typeof parseKeyPoints>,
  bundleItems: DayActionItem[],
  childClassCode: string,
  canon: string,
  semanticCanon: string,
): ActionBundle {
  return {
    emailId: key,
    email,
    kp,
    items: bundleItems,
    hasShortNotice: bundleItems.some(i => i.isShortNotice),
    allCompleted: bundleItems.every(i => i.completed),
    tier: scoreRelevance(email?.audience, childClassCode),
    canon,
    semanticCanon,
    primaryDate: bundlePrimaryDate(bundleItems),
  }
}

function groupDayItems(
  items: DayItem[],
  emailMap: Map<number, Email>,
  childClassCode: string,
): DisplayGroup[] {
  const calEventsRaw = items.filter((i): i is DayCalEvent => i.kind === 'calendar')
  const actionItems = items.filter((i): i is DayActionItem => i.kind === 'action')

  // Group action items by sourceEmailId first
  const emailItemsMap = new Map<number | null, DayActionItem[]>()
  for (const ai of actionItems) {
    const key = ai.sourceEmailId ?? null
    const list = emailItemsMap.get(key) ?? []
    list.push(ai)
    emailItemsMap.set(key, list)
  }

  const bundles: ActionBundle[] = []

  for (const [key, emailItems] of emailItemsMap) {
    const email = key != null ? (emailMap.get(key) ?? null) : null
    const kp = email ? parseKeyPoints(email.key_points) : null
    const isGenericEmail = !email || GENERIC_SUBJECT_RE.test(email.subject ?? '')

    if (!isGenericEmail) {
      // Focused single-event email: keep all items as one bundle.
      // The email subject + summary reliably describe one event.
      const canon = buildBundleCanon(email, emailItems)
      const semanticCanon = extractSemanticCanon(kp?.summary)
      bundles.push(makeBundle(key, email, kp, emailItems, childClassCode, canon, semanticCanon))
    } else {
      // Generic/newsletter email: it may mention multiple unrelated events on
      // the same day. Split into one sub-bundle per action item so each item
      // can independently cluster with its true event group.
      // Each item's own title is its most reliable event signal.
      for (const ai of emailItems) {
        const itemCanon = canonicalize(ai.title)
        // Semantic canon from the summary is a whole-email description, so it's
        // too broad for newsletters; leave it empty to avoid cross-event bridges.
        bundles.push(makeBundle(key, email, kp, [ai], childClassCode, itemCanon, ''))
      }
    }
  }

  return clusterGroups(calEventsRaw, bundles)
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

function EventClusterCard({ cluster, defaultCollapsed }: { cluster: EventCluster; defaultCollapsed?: boolean }) {
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
  let sourceLabel = ''
  if (hasCalEvent && emailCount > 0) {
    sourceLabel = `📅 Calendar + ${emailCount} email${emailCount > 1 ? 's' : ''}`
  } else if (hasCalEvent) {
    sourceLabel = '📅 Calendar'
  } else {
    sourceLabel = `📬 ${emailCount} email${emailCount > 1 ? 's' : ''}`
  }
  const sourceBg = hasCalEvent ? '#dbeafe' : '#fff7ed'
  const sourceColor = hasCalEvent ? '#1d4ed8' : '#c2410c'

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

      {/* Per-email source accordion — so user can drill into each email.
          Multiple bundles from the same source email (split from a newsletter)
          are re-grouped here so each email shows as one accordion row. */}
      {bundles.length > 0 && (() => {
        // Re-group bundles by emailId so one newsletter → one accordion row
        const emailGroups = new Map<number | null, ActionBundle[]>()
        for (const b of bundles) {
          const eid = b.emailId
          const grp = emailGroups.get(eid) ?? []
          grp.push(b)
          emailGroups.set(eid, grp)
        }
        const emailGroupList = [...emailGroups.entries()]
          // Sort: most specific (non-newsletter) first, then by received date
          .sort(([, ga], [, gb]) => {
            const aNL = GENERIC_SUBJECT_RE.test(ga[0].email?.subject ?? '') ? 1 : 0
            const bNL = GENERIC_SUBJECT_RE.test(gb[0].email?.subject ?? '') ? 1 : 0
            if (aNL !== bNL) return aNL - bNL
            const da = ga[0].email?.received_at ? new Date(ga[0].email.received_at).getTime() : 0
            const db = gb[0].email?.received_at ? new Date(gb[0].email.received_at).getTime() : 0
            return da - db
          })

        // Earliest received_at across all source emails
        const receivedDates = emailGroupList
          .map(([, grp]) => grp[0].email?.received_at)
          .filter(Boolean)
          .map(s => new Date(s!))
        receivedDates.sort((a, b) => a.getTime() - b.getTime())
        const earliestReceived = receivedDates[0] ?? null

        return (
        <div style={gs.sourcesSection}>
          <div style={{ ...gs.sectionLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{emailGroupList.length === 1 ? 'Source email' : `${emailGroupList.length} source emails`}</span>
            {earliestReceived && (
              <span style={{ fontWeight: 400, color: '#9a7060', fontSize: 11 }}>
                · received {earliestReceived.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
          {emailGroupList.map(([emailId, grpBundles], idx) => {
            const isOpen = expandedBundleIdx === idx
            const repBundle = grpBundles[0]
            const subjectLabel = repBundle.email?.subject ?? repBundle.items[0]?.title ?? 'Email'
            const tierMeta = TIER_META[repBundle.tier]
            // Merge all items from bundles of this email that belong to this cluster
            const bundleReqs = grpBundles.flatMap(b => b.items.map(i => i.title))
            const bundleDates = repBundle.kp?.dates ?? []
            const nonNewsletterEmail = !GENERIC_SUBJECT_RE.test(repBundle.email?.subject ?? '')
            const bundleReceived = repBundle.email?.received_at
              ? new Date(repBundle.email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : null
            const allBundleItems = grpBundles.flatMap(b => b.items)
            return (
              <div key={idx} style={gs.sourceItem}>
                <button
                  style={{
                    ...gs.sourceItemHeader,
                    background: isOpen ? '#fde8d8' : '#fdeee6',
                  }}
                  onClick={() => setExpandedBundleIdx(isOpen ? null : idx)}
                >
                  <span style={{
                    ...gs.sourceDot,
                    background: nonNewsletterEmail ? '#e07b39' : '#9b6bbf',
                  }} />
                  <span style={gs.sourceSubject}>
                    {subjectLabel.length > 55 ? subjectLabel.slice(0, 53) + '…' : subjectLabel}
                  </span>
                  {bundleReceived && (
                    <span style={{ fontSize: 11, color: '#9a7060', flexShrink: 0 }}>
                      {bundleReceived}
                    </span>
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
                    {/* Only show summary for focused (non-newsletter) emails */}
                    {repBundle.kp?.summary && !isNewsletter(repBundle) && (
                      <div style={gs.sourceBodySummary}>{repBundle.kp.summary}</div>
                    )}
                    {/* Action items from this email scoped to this cluster/day */}
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
  const [childClassCode, setChildClassCode] = useState('')
  const [loading, setLoading] = useState(true)

  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  useEffect(() => {
    const p1 = api.get<CalendarEvent[]>('/api/calendar', { params: { days_ahead: 365 }, silent: true })
      .then(r => setCalEvents(r.data)).catch(() => {})
    const p2 = api.get<ActionItem[]>('/api/action-items', { params: { limit: 500 }, silent: true })
      .then(r => setActionItems(r.data)).catch(() => {})
    const p3 = api.get<Email[]>('/api/emails', { params: { limit: 200 }, silent: true })
      .then(r => setEmails(r.data)).catch(() => {})
    const p4 = api.get<UserSettings>('/api/settings', { silent: true } as any)
      .then(r => setChildClassCode(r.data.child_class_code || '')).catch(() => {})
    Promise.all([p1, p2, p3, p4]).finally(() => setLoading(false))
  }, [])

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
        completed: ai.completed,
      })
      m.set(key, list)
    })
    return m
  }, [actionItems])

  // Pre-compute clusters for every day that has any data, so cell previews
  // show one entry per merged event (not one per source email).
  const clustersByDay = useMemo(() => {
    const m = new Map<string, DisplayGroup[]>()
    const allKeys = new Set([
      ...calEventsByDay.keys(),
      ...actionsByDay.keys(),
    ])
    for (const key of allKeys) {
      const cals: DayItem[] = calEventsByDay.get(key) ?? []
      const acts: DayItem[] = actionsByDay.get(key) ?? []
      m.set(key, groupDayItems([...cals, ...acts], emailMap, childClassCode))
    }
    return m
  }, [calEventsByDay, actionsByDay, emailMap, childClassCode])

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
                {selectedGroups.map((group, i) => (
                  <EventClusterCard
                    key={`cluster-${i}`}
                    cluster={group}
                    defaultCollapsed={!isRelevant(group.tier)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
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

  // Sources accordion
  sourcesSection: { marginTop: 14 },
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
}
