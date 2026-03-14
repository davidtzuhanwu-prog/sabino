import { useEffect, useState, useMemo, useCallback } from 'react'
import api from '../../api/client'
import type { ActionItem, EventGroup } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  RED:    '#ef4444',
  AMBER:  '#f59e0b',
  GREEN:  '#22c55e',
  BLUE:   '#3b82f6',
  GRAY:   '#cbd5e1',
} as const

const THRESHOLDS = { CRITICAL: 3, URGENT: 7 } as const

// ─── Pure helpers ────────────────────────────────────────────────────────────

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00')
}

function getToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function countdownText(eventDate: Date, today: Date): string {
  const days = diffDays(today, eventDate)
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  if (days === 0) return 'TODAY!'
  if (days === 1) return '1 day to go'
  return `${days} days to go`
}

function urgencyColor(daysToEvent: number): string {
  if (daysToEvent <= THRESHOLDS.CRITICAL) return COLORS.RED
  if (daysToEvent <= THRESHOLDS.URGENT)   return COLORS.AMBER
  return COLORS.GREEN
}

function bubblePosition(targetDate: Date, windowStart: Date, windowEnd: Date): number {
  const total = diffDays(windowStart, windowEnd)
  if (total <= 0) return 100
  const offset = diffDays(windowStart, targetDate)
  return Math.min(100, Math.max(0, (offset / total) * 100))
}

// ─── Time-bucket grouping (no dedup — handled by backend) ────────────────────

interface SectionGroups {
  upcoming:   EventGroup[]   // event_date today or in the next 14 days
  recentPast: EventGroup[]   // event_date 1–14 days ago
  archived:   EventGroup[]   // event_date >14 days ago
  completed:  EventGroup[]   // all items completed
}

function bucketGroups(groups: EventGroup[], today: Date): SectionGroups {
  const upcoming:   EventGroup[] = []
  const recentPast: EventGroup[] = []
  const archived:   EventGroup[] = []
  const completed:  EventGroup[] = []

  for (const g of groups) {
    if (g.all_completed) { completed.push(g); continue }
    const ev = parseDate(g.event_date)
    if (!ev) continue
    const days = diffDays(today, ev)
    if (days >= 0)        upcoming.push(g)
    else if (days >= -14) recentPast.push(g)
    else                  archived.push(g)
  }

  // Past buckets: most-recent first
  recentPast.reverse()
  archived.reverse()
  completed.reverse()

  return { upcoming, recentPast, archived, completed }
}

// ─── CalendarStrip ────────────────────────────────────────────────────────────

interface CalendarStripProps {
  group: EventGroup
  today: Date
}

function CalendarStrip({ group, today }: CalendarStripProps) {
  const eventDate = parseDate(group.event_date)
  if (!eventDate) return null

  const prepDate    = parseDate(group.earliest_prep_start_date)
  const daysToEvent = diffDays(today, eventDate)
  const lineColor   = group.all_completed ? COLORS.GRAY : urgencyColor(daysToEvent)

  const isPrepOverdue = prepDate !== null && prepDate < today
  const prepPct       = prepDate !== null ? bubblePosition(prepDate, today, eventDate) : null

  const countdown      = countdownText(eventDate, today)
  const countdownColor = group.all_completed ? '#94a3b8' : urgencyColor(Math.max(daysToEvent, 0))

  return (
    <div style={styles.stripWrapper}>
      <div style={styles.stripTrack}>
        {/* Connecting line */}
        <div style={{ ...styles.stripLine, background: lineColor }} />

        {/* Today bubble */}
        <div style={styles.bubble}>
          <span style={styles.bubbleLabel}>Today</span>
        </div>

        {/* Prep bubble */}
        {prepPct !== null && (
          <div style={{
            ...styles.bubble,
            left: `${prepPct}%`,
            background: isPrepOverdue ? COLORS.RED : COLORS.AMBER,
          }}>
            <span style={styles.bubbleLabel}>{fmtMonthDay(prepDate!)}</span>
            <span style={isPrepOverdue ? styles.prepOverdueTag : styles.prepCueTag}>
              {isPrepOverdue ? 'Overdue!' : 'Start now!'}
            </span>
          </div>
        )}

        {/* Event bubble */}
        <div style={{ ...styles.bubble, right: 0, left: 'auto', transform: 'translate(50%, -50%)', background: lineColor }}>
          <span style={styles.bubbleLabel}>{fmtMonthDay(eventDate)}</span>
        </div>
      </div>

      <div style={styles.countdownRow}>
        <span style={{ color: countdownColor, fontWeight: 600, fontSize: 12 }}>{countdown}</span>
      </div>
    </div>
  )
}

// ─── TimelineRow ──────────────────────────────────────────────────────────────

interface TimelineRowProps {
  group: EventGroup
  today: Date
  expanded: boolean
  onExpand: (id: number) => void
  onToggle: (id: number, completed: boolean) => void
  onGroupUpdate: (updated: EventGroup) => void
}

function TimelineRow({ group, today, expanded, onExpand, onToggle, onGroupUpdate }: TimelineRowProps) {
  const extraCount = group.items.length - 1

  return (
    <div style={{ ...styles.card, ...(group.all_completed ? styles.cardCompleted : {}) }}>
      <div style={styles.cardHeader}>
        <input
          type="checkbox"
          checked={group.all_completed}
          onChange={e => {
            group.items.forEach(item => onToggle(item.id, e.target.checked))
          }}
          onClick={e => e.stopPropagation()}
          style={styles.checkbox}
        />
        <span
          style={{ ...styles.itemTitle, ...(group.all_completed ? styles.titleCompleted : {}) }}
          onClick={() => onExpand(group.id)}
        >
          {group.display_name}
        </span>
        {extraCount > 0 && (
          <span style={styles.extraBadge} title={group.items.map(i => i.title).join('\n')}>
            +{extraCount} more
          </span>
        )}
        {group.has_short_notice && !group.all_completed && (
          <span style={styles.shortNoticeBadge}>⚠️ Short notice</span>
        )}
        {group.all_completed && (
          <span style={styles.completedBadge}>✓ Done</span>
        )}
        <button
          style={styles.expandChevron}
          onClick={() => onExpand(group.id)}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      <CalendarStrip group={group} today={today} />

      {expanded && (
        <div style={styles.expandedBody}>
          {/* Sub-item checklist when group has more than one action */}
          {group.items.length > 1 && (
            <ul style={styles.subItemList}>
              {group.items.map(item => (
                <li key={item.id} style={{ ...styles.subItem, ...(item.completed ? styles.subItemCompleted : {}) }}>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={e => onToggle(item.id, e.target.checked)}
                    style={{ ...styles.checkbox, width: 13, height: 13 }}
                  />
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Description of the representative item */}
          {group.items[0]?.description && (
            <p style={styles.description}>{group.items[0].description}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

interface CollapsibleSectionProps {
  label: string
  color: string
  bgColor: string
  groups: EventGroup[]
  today: Date
  expandedIds: Set<number>
  defaultOpen: boolean
  onExpand: (id: number) => void
  onToggle: (id: number, completed: boolean) => void
  onGroupUpdate: (updated: EventGroup) => void
}

function CollapsibleSection({
  label, color, bgColor, groups, today, expandedIds, defaultOpen, onExpand, onToggle, onGroupUpdate,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (groups.length === 0) return null

  return (
    <div style={styles.groupSection}>
      <button style={styles.sectionToggle} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.groupLabel, color, background: bgColor }}>{label}</span>
        <div style={styles.groupDivider} />
        <span style={styles.groupCount}>{groups.length} event{groups.length !== 1 ? 's' : ''}</span>
        <span style={{ ...styles.sectionChevron, color }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && groups.map(group => (
        <TimelineRow
          key={group.id}
          group={group}
          today={today}
          expanded={expandedIds.has(group.id)}
          onExpand={onExpand}
          onToggle={onToggle}
          onGroupUpdate={onGroupUpdate}
        />
      ))}
    </div>
  )
}

// ─── PrepTimeline (main) ──────────────────────────────────────────────────────

export default function PrepTimeline() {
  const [groups, setGroups] = useState<EventGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const today = useMemo(() => getToday(), [])

  useEffect(() => {
    // Fetch all event groups across a wide date window (14 days ago → 60 days out)
    // including completed groups, so all four sections can be populated.
    const from = new Date(today)
    from.setDate(from.getDate() - 14)
    const to = new Date(today)
    to.setDate(to.getDate() + 60)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    api.get<EventGroup[]>('/api/event-groups', {
      params: {
        event_date_from: fmt(from),
        event_date_to: fmt(to),
        include_completed: true,
      },
      silent: true,
    })
      .then(res => setGroups(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [today])

  // Toggle a single ActionItem's completed state, then update the local group
  const handleToggle = useCallback(async (id: number, completed: boolean) => {
    try {
      const { data: updatedItem } = await api.patch<ActionItem>(`/api/action-items/${id}`, { completed })
      setGroups(prev => prev.map(g => {
        const hasItem = g.items.some(i => i.id === id)
        if (!hasItem) return g
        const newItems = g.items.map(i => i.id === id ? updatedItem : i)
        const allCompleted = newItems.every(i => i.completed)
        // has_short_notice is determined by is_short_notice flags set at analysis time;
        // toggling completion never changes it, so preserve the existing value.
        return { ...g, items: newItems, all_completed: allCompleted }
      }))
    } catch {
      // error toast handled by API interceptor
    }
  }, [])

  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleGroupUpdate = useCallback((updated: EventGroup) => {
    setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))
  }, [])

  const sections = useMemo(() => bucketGroups(groups, today), [groups, today])

  const hasAnything =
    sections.upcoming.length > 0 ||
    sections.recentPast.length > 0 ||
    sections.archived.length > 0 ||
    sections.completed.length > 0

  if (!loading && !hasAnything) return null

  const sharedProps = {
    today,
    expandedIds,
    onExpand: handleExpand,
    onToggle: handleToggle,
    onGroupUpdate: handleGroupUpdate,
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Prep Timeline</h3>

      {loading && <p style={styles.loadingMsg}>Loading…</p>}

      {!loading && (
        <>
          <CollapsibleSection
            label="Upcoming — next 14 days"
            color={COLORS.BLUE}
            bgColor="#dbeafe"
            groups={sections.upcoming}
            defaultOpen={true}
            {...sharedProps}
          />
          <CollapsibleSection
            label="Recent past — last 14 days"
            color="#7c3aed"
            bgColor="#ede9fe"
            groups={sections.recentPast}
            defaultOpen={false}
            {...sharedProps}
          />
          <CollapsibleSection
            label="Archived"
            color="#64748b"
            bgColor="#f1f5f9"
            groups={sections.archived}
            defaultOpen={false}
            {...sharedProps}
          />
          <CollapsibleSection
            label="Completed"
            color="#065f46"
            bgColor="#d1fae5"
            groups={sections.completed}
            defaultOpen={false}
            {...sharedProps}
          />
        </>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const prepTagBase: React.CSSProperties = {
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 10,
  borderRadius: 4,
  padding: '1px 5px',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  pointerEvents: 'none',
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 24,
  },
  heading:    { margin: '0 0 20px', color: '#1e2a3a', fontSize: 17, fontWeight: 600 },
  loadingMsg: { color: '#94a3b8', textAlign: 'center', padding: '20px 0', fontSize: 14, margin: 0 },

  sectionToggle: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', background: 'none', border: 'none',
    cursor: 'pointer', padding: '0 0 12px', textAlign: 'left',
  },
  groupSection:   { marginBottom: 16 },
  groupLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', padding: '3px 10px',
    borderRadius: 20, flexShrink: 0,
  },
  groupDivider:   { flex: 1, height: 1, background: '#e2e8f0' },
  groupCount:     { color: '#94a3b8', fontSize: 12, flexShrink: 0 },
  sectionChevron: { fontSize: 13, flexShrink: 0 },

  card: {
    border: '1px solid #e2e8f0', borderRadius: 10,
    padding: '14px 16px', marginBottom: 10,
    background: '#fff', transition: 'box-shadow 0.15s',
  },
  cardCompleted:  { opacity: 0.5 },
  cardHeader:     { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  checkbox:       { width: 16, height: 16, cursor: 'pointer', accentColor: COLORS.BLUE, flexShrink: 0 },
  itemTitle:      { flex: 1, fontSize: 14, fontWeight: 600, color: '#1e2a3a', cursor: 'pointer' },
  titleCompleted: { textDecoration: 'line-through', color: '#94a3b8' },
  shortNoticeBadge: {
    fontSize: 11, background: '#fef3c7', color: '#92400e',
    borderRadius: 4, padding: '2px 6px', fontWeight: 600, flexShrink: 0,
  },
  completedBadge: {
    fontSize: 11, background: '#d1fae5', color: '#065f46',
    borderRadius: 4, padding: '2px 6px', fontWeight: 600, flexShrink: 0,
  },
  expandChevron: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#94a3b8', fontSize: 13, padding: '0 2px', flexShrink: 0, lineHeight: 1,
  },
  extraBadge: {
    fontSize: 11, background: '#f1f5f9', color: '#475569',
    borderRadius: 4, padding: '2px 6px', fontWeight: 600, flexShrink: 0, cursor: 'help',
  },
  expandedBody:   { marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' },
  subItemList:    { margin: '0 0 8px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 },
  subItem:        { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' },
  subItemCompleted: { opacity: 0.5, textDecoration: 'line-through', color: '#94a3b8' },
  description:    { fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '6px 0 0' },

  stripWrapper: { marginTop: 4 },
  stripTrack: { position: 'relative', height: 56, marginLeft: 12, marginRight: 12 },
  stripLine: {
    position: 'absolute', top: '50%', left: 0, right: 0,
    height: 2, transform: 'translateY(-50%)', borderRadius: 1,
  },
  bubble: {
    position: 'absolute', top: '50%', left: 0,
    transform: 'translate(-50%, -50%)',
    width: 18, height: 18, borderRadius: '50%',
    border: '2px solid #fff', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.12)',
    background: COLORS.BLUE,
  },
  bubbleLabel: {
    position: 'absolute', top: 20, left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 10, color: '#64748b', whiteSpace: 'nowrap',
    fontWeight: 500, pointerEvents: 'none',
  },
  prepCueTag:     { ...prepTagBase, color: '#92400e', background: '#fef3c7' },
  prepOverdueTag: { ...prepTagBase, color: '#991b1b', background: '#fee2e2' },
  countdownRow:   { display: 'flex', justifyContent: 'flex-end', marginTop: 6, paddingRight: 4 },
}
