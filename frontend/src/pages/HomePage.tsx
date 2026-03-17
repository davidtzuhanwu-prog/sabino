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

function canonicalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\d{1,2}\/\d{1,2}(\/\d{2,4})?\)/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\b(tomorrow|today|this week|next week|reminder|re:|fwd:|fw:)\b/gi, '')
    .replace(/^bif\s+(school\s+)?(newsletter|update|news)[–\-—]\s*/i, '')
    .replace(/^(newsletter|update)\s*/i, '')
    .replace(/[–\-—]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'is', 'are', 'will', 'be', 'with', 'your', 'our', 'this', 'that', 'it'])

function keyTokens(canon: string): Set<string> {
  return new Set(
    canon.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )
}

// ─── types ────────────────────────────────────────────────────────────────────

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

interface ActionBundle {
  emailId: number | null
  email: Email | null
  kp: EmailKeyPoints | null
  items: DayActionItem[]
  hasShortNotice: boolean
  allCompleted: boolean
  tier: RelevanceTier
}

interface EventCluster {
  type: 'cluster'
  calEvent: DayCalEvent | null
  bundles: ActionBundle[]
  tier: RelevanceTier
  eventTitle: string
}

type DisplayGroup = EventCluster

const GENERIC_SUBJECT_RE = /^(newsletter|update|news|auxiliary|bif school newsletter|bif newsletter|\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*\|)|^friday photos|^weekly (update|recap|photos|highlights)|^(lower|upper) school (update|newsletter|news)/i

// ─── backend-driven grouping ──────────────────────────────────────────────────

const CAL_MATCH_JACCARD = 0.3
const CAL_MATCH_CONTAINMENT = 0.5

function groupDayItems(
  calEvents: DayCalEvent[],
  actionItems: DayActionItem[],
  groupById: Map<number, EventGroup>,
  emailMap: Map<number, Email>,
  childClassCode: string,
): DisplayGroup[] {
  const result: EventCluster[] = []

  const grouped = new Map<number | null, DayActionItem[]>()
  for (const ai of actionItems) {
    const gid = ai.eventGroupId
    const list = grouped.get(gid) ?? []
    list.push(ai)
    grouped.set(gid, list)
  }

  const usedCalIds = new Set<number>()

  for (const [gid, items] of grouped) {
    const backendGroup = gid != null ? groupById.get(gid) : null
    const eventTitle = backendGroup?.display_name ?? items[0]?.title ?? 'Event'

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

    bundles.sort((a, b) => {
      const aNL = GENERIC_SUBJECT_RE.test(a.email?.subject ?? '') ? 1 : 0
      const bNL = GENERIC_SUBJECT_RE.test(b.email?.subject ?? '') ? 1 : 0
      if (aNL !== bNL) return aNL - bNL
      const da = a.email?.received_at ? new Date(a.email.received_at).getTime() : 0
      const db = b.email?.received_at ? new Date(b.email.received_at).getTime() : 0
      return da - db
    })

    const tier = bundles.reduce<RelevanceTier>((best, b) =>
      TIER_META[b.tier].priority < TIER_META[best].priority ? b.tier : best,
      bundles[0]?.tier ?? 'unknown'
    )

    let calEvent: DayCalEvent | null = null
    const titleTokens = keyTokens(canonicalize(eventTitle))
    for (const cal of calEvents) {
      if (usedCalIds.has(cal.id)) continue
      const calTokens = keyTokens(canonicalize(cal.title))
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

  result.sort((a, b) => {
    const aHasCal = a.calEvent !== null ? 0 : 1
    const bHasCal = b.calEvent !== null ? 0 : 1
    if (aHasCal !== bHasCal) return aHasCal - bHasCal
    return compareTier(a.tier, b.tier)
  })

  return result
}

// ─── mini components ──────────────────────────────────────────────────────────

function Dot({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <span
      className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
      style={{ background: color, opacity }}
    />
  )
}

function TierBadge({ tier }: { tier: RelevanceTier }) {
  const meta = TIER_META[tier]
  if (!meta.label) return null
  return (
    <span
      className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0"
      style={{ background: meta.badgeBg, color: meta.badgeColor }}
    >
      {meta.label}
    </span>
  )
}

// ─── Event cluster card ───────────────────────────────────────────────────────

interface EventClusterCardProps {
  cluster: EventCluster
  defaultCollapsed?: boolean
  backendGroup?: EventGroup | null
  onAddAction?: (group: EventGroup) => void
  onEditItem?: (item: ActionItem) => void
  onDeleteItem?: (itemId: number) => void
}

function EventClusterCard({ cluster, defaultCollapsed, backendGroup, onAddAction, onEditItem, onDeleteItem }: EventClusterCardProps) {
  const [showAnyway, setShowAnyway] = useState(!defaultCollapsed)
  const [expandedBundleIdx, setExpandedBundleIdx] = useState<number | null>(null)

  const { calEvent, bundles, tier, eventTitle } = cluster

  const allItems = bundles.flatMap(b => b.items)
  const hasShortNotice = bundles.some(b => b.hasShortNotice)
  const allCompleted = allItems.length > 0 && allItems.every(i => i.completed)

  const eventDates = [
    calEvent?.start ?? null,
    ...allItems.map(i => i.eventDate),
  ].filter(Boolean) as Date[]
  eventDates.sort((a, b) => a.getTime() - b.getTime())
  const primaryDate = eventDates[0] ?? null

  const prepDates = allItems.map(i => i.prepStartDate).filter(Boolean) as Date[]
  prepDates.sort((a, b) => a.getTime() - b.getTime())
  const earliestPrep = prepDates[0] ?? null

  const exactDeduped: string[] = []
  const seenExact = new Set<string>()
  for (const b of bundles) {
    for (const item of b.items) {
      if (item.sourceType === 'manual') continue
      const norm = item.title.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!seenExact.has(norm)) {
        seenExact.add(norm)
        exactDeduped.push(item.title)
      }
    }
  }

  const eventTokens = keyTokens(canonicalize(eventTitle))
  const QUALIFIER_WORDS = new Set(['day', 'morning', 'evening', 'night', 'time', 'date', 'event', 'now', 'soon', 'asap', 'today', 'tomorrow', 'reminder'])
  function actionOnlyTokens(title: string): Set<string> {
    const all = keyTokens(canonicalize(title))
    const filtered = new Set<string>()
    for (const t of all) if (!eventTokens.has(t)) filtered.add(t)
    const meaningful = new Set<string>()
    for (const t of filtered) if (!QUALIFIER_WORDS.has(t)) meaningful.add(t)
    return meaningful
  }
  function actionSimilarity(a: string, b: string): number {
    const ta = actionOnlyTokens(a)
    const tb = actionOnlyTokens(b)
    if (ta.size === 0 && tb.size === 0) return 1
    if (ta.size === 0 || tb.size === 0) return 0
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    const union = new Set([...ta, ...tb]).size
    const jaccard = union === 0 ? 0 : inter / union
    const smaller = Math.min(ta.size, tb.size)
    const containment = smaller >= 2 ? inter / smaller : 0
    return Math.max(jaccard, containment)
  }

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
  const reqGroups = new Map<number, string[]>()
  for (let i = 0; i < exactDeduped.length; i++) {
    const root = reqFind(i)
    const grp = reqGroups.get(root) ?? []
    grp.push(exactDeduped[i])
    reqGroups.set(root, grp)
  }
  const allReqs: string[] = []
  for (const grp of reqGroups.values()) {
    const best = grp.reduce((a, b) => {
      const la = keyTokens(canonicalize(a)).size
      const lb = keyTokens(canonicalize(b)).size
      if (la !== lb) return la > lb ? a : b
      return a.length <= b.length ? a : b
    })
    allReqs.push(best)
  }

  const isNewsletter = (b: ActionBundle) =>
    GENERIC_SUBJECT_RE.test(b.email?.subject ?? '')
  const bestSummary = bundles.find(b => !isNewsletter(b))?.kp?.summary ?? null

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
      <div className="flex items-center gap-2 flex-wrap bg-gray-100 border border-dashed border-gray-300 rounded-xl px-3 py-2">
        <TierBadge tier={tier} />
        <span className="flex-1 text-[13px] text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">{eventTitle}</span>
        <button
          className="bg-transparent border border-gray-300 rounded-md px-2 py-0.5 cursor-pointer text-[11px] text-gray-500 shrink-0 min-h-[32px]"
          onClick={() => setShowAnyway(true)}
        >
          Show anyway ▾
        </button>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border px-4 py-3.5 ${allCompleted ? 'opacity-65' : ''} ${tier === 'upper_school' ? 'bg-gray-50 border-gray-200 opacity-80' : 'bg-[#fce4d4] border-[#c9845e]'}`}>
      {/* Event title — always on top */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-bold text-[15px] text-[#5a2010] leading-tight">{eventTitle}</div>
        {tier === 'upper_school' && (
          <button
            className="bg-transparent border border-gray-300 rounded-md px-2 py-0.5 cursor-pointer text-[11px] text-gray-500 shrink-0 min-h-[32px]"
            onClick={() => setShowAnyway(false)}
          >Hide ▲</button>
        )}
      </div>

      {/* Due date — own line */}
      {primaryDate && (
        <div className="mb-1.5">
          <span className="bg-blue-100 text-blue-700 rounded-md px-2.5 py-0.5 text-xs font-medium">
            📅 {fmtDate(primaryDate)}
            <em className="not-italic font-normal"> {daysUntil(primaryDate)}</em>
          </span>
        </div>
      )}

      {/* Meta pills: tier · location · flags */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        <TierBadge tier={tier} />
        {calEvent?.location && (
          <span className="bg-[#fdeee6] text-[#7a4a2a] rounded-md px-2.5 py-0.5 text-xs font-medium shrink-0">📍 {calEvent.location}</span>
        )}
        {hasShortNotice && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 shrink-0">⚠️ Short notice</span>}
        {allCompleted && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-green-100 text-green-800 shrink-0">✓ All done</span>}
      </div>

      {/* AI summary */}
      {bestSummary && (
        <div className="flex gap-1.5 items-start bg-gradient-to-br from-[#f0f7ff] to-[#faf5ff] border border-[#c7d9f5] rounded-lg px-3 py-2.5 mb-2.5">
          <span className="text-indigo-500 text-xs shrink-0 mt-0.5">✦</span>
          <span className="text-[13px] text-slate-800 leading-relaxed">{bestSummary}</span>
        </div>
      )}

      {/* Combined requirements checklist */}
      {allReqs.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[11px] font-bold text-[#7a3318] uppercase tracking-widest mb-1.5">What you need to do</div>
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {allReqs.map((req, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-[#3d2010] leading-tight">
                <span className="text-[#c87a5c] text-sm shrink-0 mt-0.5">○</span>
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Calendar event description */}
      {calEvent?.description && (
        <div className="mt-2.5">
          <div className="text-[11px] font-bold text-[#7a3318] uppercase tracking-widest mb-1.5">Calendar details</div>
          <div className="text-[13px] text-[#6b4c2a] leading-relaxed mt-1.5">{calEvent.description.slice(0, 400)}</div>
        </div>
      )}

      {/* Short-notice note */}
      {hasShortNotice && (
        <div className="mt-2.5 text-[13px] text-amber-700 italic leading-relaxed">
          {bundles.flatMap(b => b.items)
            .find(i => i.isShortNotice && i.shortNoticeNote)?.shortNoticeNote}
        </div>
      )}

      {/* Manual item edit/delete controls */}
      {hasManual && (onEditItem || onDeleteItem) && (() => {
        const manualItems = allItems.filter(i => i.sourceType === 'manual')
        if (manualItems.length === 0) return null
        return (
          <div className="mt-2.5">
            <div className="text-[11px] font-bold text-[#7a3318] uppercase tracking-widest mb-1.5">Manually added</div>
            {manualItems.map((item, mi) => (
              <div key={mi} className="flex items-start gap-2 py-1.5 border-b border-dashed border-[#d9aa88]">
                <span className="text-[#c87a5c] text-sm shrink-0 mt-0.5">{item.completed ? '✓' : '○'}</span>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-[#3d2010]">{item.title}</div>
                  {item.description && <div className="text-xs text-[#7a4a2a] mt-0.5 leading-snug">{item.description}</div>}
                </div>
                <div className="flex gap-1 shrink-0 items-center">
                  {onEditItem && (
                    <button
                      className="text-[11px] px-2 py-0.5 rounded-md cursor-pointer border border-slate-200 bg-slate-50 text-slate-600 min-h-[32px]"
                      onClick={() => {
                        onEditItem({ ...item, source_type: item.sourceType, event_date: item.eventDate?.toISOString().slice(0, 10) ?? null, prep_start_date: item.prepStartDate?.toISOString().slice(0, 10) ?? null, source_email_id: item.sourceEmailId, source_event_id: null, event_group_id: item.eventGroupId, is_short_notice: item.isShortNotice, short_notice_note: item.shortNoticeNote, lead_time_days: null, item_type: item.itemType, created_at: '' } as ActionItem)
                      }}
                    >Edit</button>
                  )}
                  {onDeleteItem && (
                    <button
                      className="text-[11px] px-2 py-0.5 rounded-md cursor-pointer border border-red-200 bg-red-50 text-red-600 min-h-[32px]"
                      onClick={() => onDeleteItem(item.id)}
                    >Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* + Add action button */}
      {onAddAction && backendGroup && (
        <button
          className="mt-3 w-full py-1.5 rounded-lg cursor-pointer border border-dashed border-[#c87a5c] bg-transparent text-[#7a3318] text-[13px] font-semibold text-center min-h-[44px]"
          onClick={() => onAddAction(backendGroup)}
        >
          + Add action
        </button>
      )}

      {/* Sources section */}
      {(() => {
        const emailBundles = bundles.filter(b => b.emailId != null)
        const hasEmailSources = emailBundles.length > 0
        const hasCalSource = calEvent !== null

        if (!hasEmailSources && !hasCalSource) return null

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

        const parts: string[] = []
        if (hasCalSource) parts.push('Calendar')
        if (emailGroupList.length > 0) parts.push(`${emailGroupList.length} email${emailGroupList.length > 1 ? 's' : ''}`)
        if (hasManual) parts.push('Manual')
        const sourceCountLabel = parts.join(' · ')

        return (
          <div className="mt-3.5">
            <div className="text-[11px] font-bold text-[#7a3318] uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <span>Sources</span>
              <span className="font-normal text-[#9a7060]">{sourceCountLabel}</span>
              {earliestReceived && (
                <span className="font-normal text-[#9a7060]">
                  · received {earliestReceived.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>

            {/* Calendar source pill */}
            {hasCalSource && (
              <div className="flex items-center gap-2 px-3 py-1.5 mb-1.5 bg-[#eef4ff] border border-[#bdd4f5] rounded-lg text-[13px] text-[#1e3a6e]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#6a9fd8' }} />
                <span className="flex-1 font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                  📅 {calEvent!.title}
                  {calEvent!.start && (
                    <span className="font-normal text-[#9a7060]"> · {fmtDate(calEvent!.start)}</span>
                  )}
                </span>
              </div>
            )}

            {/* Email source accordions */}
            {emailGroupList.map(([, grpBundles], idx) => {
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
                <div key={idx} className="rounded-lg overflow-hidden border border-[#d9aa88] mb-1.5">
                  <button
                    className={`flex items-center gap-2 w-full px-3 py-2 border-none cursor-pointer text-left text-[13px] text-[#3d2010] min-h-[44px] ${isOpen ? 'bg-[#fde8d8]' : 'bg-[#fdeee6]'}`}
                    onClick={() => setExpandedBundleIdx(isOpen ? null : idx)}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: nonNewsletterEmail ? '#e07b39' : '#9b6bbf' }} />
                    <span className="flex-1 font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                      {subjectLabel.length > 55 ? subjectLabel.slice(0, 53) + '…' : subjectLabel}
                    </span>
                    {bundleReceived && (
                      <span className="text-[11px] text-[#9a7060] shrink-0">{bundleReceived}</span>
                    )}
                    {tierMeta.label && (
                      <span
                        className="text-[10px] rounded-full px-1.5 py-0.5 shrink-0 font-semibold"
                        style={{ background: tierMeta.badgeBg, color: tierMeta.badgeColor }}
                      >
                        {tierMeta.label}
                      </span>
                    )}
                    <span className="text-[10px] text-[#c87a5c] shrink-0">{isOpen ? '▲' : '▾'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3.5 py-2.5 bg-[#fff8f4] border-t border-[#d9aa88]">
                      {repBundle.kp?.summary && !isNewsletter(repBundle) && (
                        <div className="text-xs text-[#5a3020] leading-relaxed mb-1">{repBundle.kp.summary}</div>
                      )}
                      {allBundleItems.length > 0 && (
                        <div className="mt-1 flex flex-col gap-1">
                          {allBundleItems.map((item, ii) => (
                            <div key={ii} className={`flex gap-2 items-start py-1 border-b border-dashed border-[#d9aa88] ${item.completed ? 'opacity-50' : ''}`}>
                              <span className="text-[#c87a5c] text-sm shrink-0 mt-0.5">{item.completed ? '✓' : '○'}</span>
                              <div>
                                <div className="text-[13px] font-medium text-[#3d2010]">{item.title}</div>
                                {item.description && <div className="text-xs text-[#7a4a2a] mt-0.5 leading-snug">{item.description}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {bundleDates.length > 0 && (
                        <>
                          <div className="text-[11px] font-bold text-[#7a3318] uppercase tracking-widest mt-2 mb-1.5">Key dates</div>
                          <div className="flex flex-col">
                            {bundleDates.map((d, di) => (
                              <div key={di} className="flex justify-between items-baseline gap-2 text-xs text-slate-700 py-1 border-b border-dashed border-[#d9aa88]">
                                <span className="font-medium text-[#5a2010]">{d.label}</span>
                                {d.date && <span className="text-blue-600 font-semibold whitespace-nowrap">{d.date}</span>}
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
    <div className="flex gap-4 items-center flex-wrap">
      <span className="flex items-center gap-1 text-xs text-[#7a3318]"><Dot color="#6a9fd8" /> Calendar event</span>
      <span className="flex items-center gap-1 text-xs text-[#7a3318]"><Dot color="#e07b39" /> Email action</span>
      {childClassCode && (
        <span className="flex items-center gap-1 text-xs text-[#7a3318] opacity-45"><Dot color="#e07b39" opacity={0.45} /> Other grade</span>
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

  type ModalState =
    | { type: 'new_event'; date: string | null }
    | { type: 'add_action'; group: EventGroup }
    | { type: 'edit_action'; item: ActionItem }
    | null
  const [modalState, setModalState] = useState<ModalState>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useRef(new Date()).current
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const toISODate = useCallback((d: Date) => d.toISOString().slice(0, 10), [])

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
    <div className="overflow-x-hidden">
      <div className="hidden md:flex justify-end mb-3">
        <Legend childClassCode={childClassCode} />
      </div>

      {loading && <p className="text-center text-[#b89a7a] py-10">Loading…</p>}

      {!loading && (
        <div className="flex flex-col md:flex-row gap-5 md:items-start min-w-0">
          {/* ── Calendar panel ── */}
          <div className={`w-full md:flex-1 min-w-0 bg-[#fdeee6] rounded-2xl border-[3px] border-[#b94f1a] overflow-hidden shadow-[0_4px_20px_rgba(180,80,30,0.22)] ${selectedDate ? 'hidden md:block' : ''}`}>
            <div className="flex items-center gap-2.5 px-5 py-4 border-b-2 border-[#c87a5c] bg-gradient-to-br from-[#f5c4a8] to-[#f7d4bc]">
              <button
                className="bg-[#fce8d8] border border-[#c87a5c] rounded-lg w-8 h-8 cursor-pointer text-lg text-[#7a3318] flex items-center justify-center shrink-0 min-h-[44px] min-w-[44px]"
                onClick={prevMonth}
              >‹</button>
              <span className="flex-1 text-center font-bold text-base text-[#5a2010]">{fmtMonthYear(monthStart)}</span>
              <button
                className="bg-[#fce8d8] border border-[#c87a5c] rounded-lg w-8 h-8 cursor-pointer text-lg text-[#7a3318] flex items-center justify-center shrink-0 min-h-[44px] min-w-[44px]"
                onClick={nextMonth}
              >›</button>
              <button
                className="hidden md:flex bg-[#fce8d8] border border-[#c87a5c] rounded-lg px-3 py-1 cursor-pointer text-[13px] text-[#7a3318] font-semibold shrink-0 min-h-[44px] items-center"
                onClick={goToday}
              >Today</button>
              <button
                className="bg-[#b94f1a] border-none rounded-lg cursor-pointer text-white font-semibold shrink-0 ml-1 min-h-[44px] min-w-[44px] flex items-center justify-center px-3 py-1"
                onClick={() => setModalState({
                  type: 'new_event',
                  date: selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}-${String(selectedDate.getDate()).padStart(2,'0')}` : null,
                })}
              >
                <span className="md:hidden text-xl leading-none">+</span>
                <span className="hidden md:inline text-[13px]">+ Add event</span>
              </button>
            </div>

            <div className="grid grid-cols-7 w-full border-b-2 border-[#c87a5c] bg-[#f5c4a8]">
              {DOW.map(d => (
                <div key={d} className="text-center py-2 text-[10px] md:text-xs font-bold text-[#7a3318] tracking-widest min-w-0">{d.slice(0, 1)}<span className="hidden md:inline">{d.slice(1)}</span></div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 w-full border-b border-[#c9845e]" style={{ gridAutoRows: 'clamp(60px, 13vw, 100px)' }}>
                {week.map((cell, ci) => {
                  if (!cell) {
                    return <div key={ci} className={`bg-[#f7d9c8] ${ci < 6 ? 'border-r border-[#c9845e]' : ''}`} />
                  }
                  const key = dayKey(cell)
                  const dayClusters = clustersByDay.get(key) ?? []
                  const isToday = isSameDay(cell, today)
                  const isSelected = selectedDate ? isSameDay(cell, selectedDate) : false

                  return (
                    <div
                      key={ci}
                      onClick={() => setSelectedDate(isSelected ? null : cell)}
                      className={`p-1 pb-0.5 md:p-1.5 md:pb-1 cursor-pointer bg-[#fdeee6] relative overflow-hidden min-w-0 box-border transition-colors ${ci < 6 ? 'border-r border-[#c9845e]' : ''} ${isSelected ? 'bg-[#f9b98a] outline outline-2 outline-[#b94f1a] -outline-offset-2 z-10' : ''}`}
                    >
                      <span className={`inline-flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full text-[11px] md:text-[13px] font-medium text-[#5a2010] mb-0.5 shrink-0 ${isToday ? 'bg-[#b94f1a] text-white font-bold' : ''} ${isSelected ? 'text-[#7a1a00] font-bold' : ''}`}>
                        {cell.getDate()}
                      </span>

                      <div className="flex gap-0.5 flex-wrap mb-0.5">
                        {dayClusters.slice(0, 4).map((cluster, i) => {
                          const hasCal = cluster.calEvent !== null
                          const color = hasCal ? '#6a9fd8' : '#e07b39'
                          const opacity = TIER_META[cluster.tier].dotOpacity
                          return <Dot key={i} color={color} opacity={opacity} />
                        })}
                      </div>

                      <div className="hidden md:flex flex-col gap-0.5 overflow-hidden">
                        {dayClusters.slice(0, 2).map((cluster, i) => {
                          const hasCal = cluster.calEvent !== null
                          const isIrrelevant = !isRelevant(cluster.tier)
                          const label = cluster.eventTitle
                          return (
                            <div
                              key={i}
                              className="text-[10px] font-medium rounded px-1 py-0.5 overflow-hidden text-ellipsis whitespace-nowrap leading-tight block"
                              style={{
                                background: isIrrelevant ? '#f3f4f6' : hasCal ? '#dceeff' : '#fdecd8',
                                color: isIrrelevant ? '#9ca3af' : hasCal ? '#2e6fad' : '#a3480f',
                                opacity: isIrrelevant ? 0.6 : 1,
                              }}
                            >
                              {label.length > 18 ? label.slice(0, 16) + '…' : label}
                            </div>
                          )
                        })}
                        {dayClusters.length > 2 && (
                          <div className="text-[10px] text-[#a05030] px-0.5 whitespace-nowrap">+{dayClusters.length - 2} more</div>
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
            <div className="w-full md:flex-1 min-w-0 bg-[#fdeee6] rounded-2xl border-[3px] border-[#b94f1a] shadow-[0_4px_12px_rgba(180,80,30,0.18)] overflow-hidden md:max-h-[calc(100vh-140px)] flex flex-col">
              <div className="flex items-start justify-between px-5 py-4 border-b-2 border-[#c87a5c] bg-gradient-to-br from-[#f5c4a8] to-[#f7d4bc] shrink-0 z-20">
                <div className="flex items-start gap-2 min-w-0">
                  <button
                    className="md:hidden shrink-0 mt-0.5 text-[#7a3318] text-xl font-bold leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
                    onClick={() => setSelectedDate(null)}
                  >‹</button>
                  <div>
                  <div className="font-bold text-[15px] text-[#5a2010]">{fmtFull(selectedDate)}</div>
                  {selectedGroups.length > 0 && (
                    <div className="text-xs text-[#92714a] mt-0.5">
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
                </div>
              </div>

              <div className="overflow-y-auto flex-1">
                {selectedGroups.length === 0 && (
                  <div className="px-5 py-8 text-center">
                    <p className="m-0 text-slate-400 text-sm">No events or action items on this day.</p>
                  </div>
                )}

                <div className="px-4 py-3 flex flex-col gap-3">
                  {selectedGroups.map((group, i) => {
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
