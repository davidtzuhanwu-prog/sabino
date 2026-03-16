import { useEffect, useState, useMemo, useCallback } from 'react'
import api from '../../api/client'
import type { ActionItem, EventGroup } from '../../types'

const COLORS = { RED: '#ef4444', AMBER: '#f59e0b', GREEN: '#22c55e', BLUE: '#3b82f6', GRAY: '#cbd5e1' } as const
const THRESHOLDS = { CRITICAL: 3, URGENT: 7 } as const

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00')
}
function getToday(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
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

interface SectionGroups {
  upcoming: EventGroup[]; recentPast: EventGroup[]; archived: EventGroup[]; completed: EventGroup[]
}
function bucketGroups(groups: EventGroup[], today: Date): SectionGroups {
  const upcoming: EventGroup[] = [], recentPast: EventGroup[] = [], archived: EventGroup[] = [], completed: EventGroup[] = []
  for (const g of groups) {
    if (g.all_completed) { completed.push(g); continue }
    const ev = parseDate(g.event_date)
    if (!ev) continue
    const days = diffDays(today, ev)
    if (days >= 0) upcoming.push(g)
    else if (days >= -14) recentPast.push(g)
    else archived.push(g)
  }
  recentPast.reverse(); archived.reverse(); completed.reverse()
  return { upcoming, recentPast, archived, completed }
}

function CalendarStrip({ group, today }: { group: EventGroup; today: Date }) {
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
    <div className="mt-1">
      <div className="relative h-14 mx-3">
        {/* Line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 rounded" style={{ background: lineColor }} />

        {/* Today bubble */}
        <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]" style={{ background: COLORS.BLUE }}>
          <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 whitespace-nowrap font-medium pointer-events-none">Today</span>
        </div>

        {/* Prep bubble */}
        {prepPct !== null && (
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
            style={{ left: `${prepPct}%`, background: isPrepOverdue ? COLORS.RED : COLORS.AMBER }}>
            <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 whitespace-nowrap font-medium pointer-events-none">{fmtMonthDay(prepDate!)}</span>
            <span className={`absolute bottom-5 left-1/2 -translate-x-1/2 text-[10px] rounded px-1 py-0.5 whitespace-nowrap font-semibold pointer-events-none ${isPrepOverdue ? 'text-red-800 bg-red-100' : 'text-amber-800 bg-amber-100'}`}>
              {isPrepOverdue ? 'Overdue!' : 'Start now!'}
            </span>
          </div>
        )}

        {/* Event bubble */}
        <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]" style={{ background: lineColor }}>
          <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 whitespace-nowrap font-medium pointer-events-none">{fmtMonthDay(eventDate)}</span>
        </div>
      </div>

      <div className="flex justify-end mt-1.5 pr-1">
        <span className="font-semibold text-[12px]" style={{ color: countdownColor }}>{countdown}</span>
      </div>
    </div>
  )
}

interface TimelineRowProps {
  group: EventGroup; today: Date; expanded: boolean
  onExpand: (id: number) => void; onToggle: (id: number, completed: boolean) => void
  onGroupUpdate: (updated: EventGroup) => void
}

function TimelineRow({ group, today, expanded, onExpand, onToggle }: TimelineRowProps) {
  const extraCount = group.items.length - 1
  return (
    <div className={`border border-slate-200 rounded-xl px-4 py-3.5 mb-2.5 bg-white transition-shadow ${group.all_completed ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <input
          type="checkbox" checked={group.all_completed}
          onChange={e => { group.items.forEach(item => onToggle(item.id, e.target.checked)) }}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 cursor-pointer accent-blue-500 shrink-0"
        />
        <span
          className={`flex-1 text-sm font-semibold cursor-pointer ${group.all_completed ? 'line-through text-slate-400' : 'text-[#1e2a3a]'}`}
          onClick={() => onExpand(group.id)}
        >
          {group.display_name}
        </span>
        {extraCount > 0 && (
          <span className="text-[11px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-semibold shrink-0 cursor-help" title={group.items.map(i => i.title).join('\n')}>
            +{extraCount} more
          </span>
        )}
        {group.has_short_notice && !group.all_completed && (
          <span className="text-[11px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 font-semibold shrink-0">⚠️ Short notice</span>
        )}
        {group.all_completed && (
          <span className="text-[11px] bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5 font-semibold shrink-0">✓ Done</span>
        )}
        <button
          className="bg-none border-none cursor-pointer text-slate-400 text-[13px] px-0.5 shrink-0 leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
          onClick={() => onExpand(group.id)} title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      <CalendarStrip group={group} today={today} />

      {expanded && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-50">
          {group.items.length > 1 && (
            <ul className="m-0 mb-2 p-0 list-none flex flex-col gap-1.5">
              {group.items.map(item => (
                <li key={item.id} className={`flex items-center gap-2 text-[13px] text-gray-700 ${item.completed ? 'opacity-50 line-through text-slate-400' : ''}`}>
                  <input type="checkbox" checked={item.completed} onChange={e => onToggle(item.id, e.target.checked)} className="w-[13px] h-[13px] accent-blue-500 shrink-0" />
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          )}
          {group.items[0]?.description && (
            <p className="text-[13px] text-slate-600 leading-relaxed m-0 mt-1.5">{group.items[0].description}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface CollapsibleSectionProps {
  label: string; color: string; bgColor: string; groups: EventGroup[]; today: Date
  expandedIds: Set<number>; defaultOpen: boolean
  onExpand: (id: number) => void; onToggle: (id: number, completed: boolean) => void
  onGroupUpdate: (updated: EventGroup) => void
}

function CollapsibleSection({ label, color, bgColor, groups, today, expandedIds, defaultOpen, onExpand, onToggle, onGroupUpdate }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (groups.length === 0) return null
  return (
    <div className="mb-4">
      <button className="flex items-center gap-2.5 w-full bg-none border-none cursor-pointer pb-3 text-left" onClick={() => setOpen(o => !o)}>
        <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full shrink-0" style={{ color, background: bgColor }}>{label}</span>
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-slate-400 text-[12px] shrink-0">{groups.length} event{groups.length !== 1 ? 's' : ''}</span>
        <span className="text-[13px] shrink-0" style={{ color }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && groups.map(group => (
        <TimelineRow
          key={group.id} group={group} today={today}
          expanded={expandedIds.has(group.id)} onExpand={onExpand}
          onToggle={onToggle} onGroupUpdate={onGroupUpdate}
        />
      ))}
    </div>
  )
}

export default function PrepTimeline() {
  const [groups, setGroups] = useState<EventGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const today = useMemo(() => getToday(), [])

  useEffect(() => {
    const from = new Date(today); from.setDate(from.getDate() - 14)
    const to = new Date(today); to.setDate(to.getDate() + 60)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    api.get<EventGroup[]>('/api/event-groups', {
      params: { event_date_from: fmt(from), event_date_to: fmt(to), include_completed: true },
      silent: true,
    }).then(res => setGroups(res.data)).catch(() => {}).finally(() => setLoading(false))
  }, [today])

  const handleToggle = useCallback(async (id: number, completed: boolean) => {
    try {
      const { data: updatedItem } = await api.patch<ActionItem>(`/api/action-items/${id}`, { completed })
      setGroups(prev => prev.map(g => {
        const hasItem = g.items.some(i => i.id === id)
        if (!hasItem) return g
        const newItems = g.items.map(i => i.id === id ? updatedItem : i)
        return { ...g, items: newItems, all_completed: newItems.every(i => i.completed) }
      }))
    } catch {}
  }, [])

  const handleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const handleGroupUpdate = useCallback((updated: EventGroup) => {
    setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))
  }, [])

  const sections = useMemo(() => bucketGroups(groups, today), [groups, today])
  const hasAnything = sections.upcoming.length > 0 || sections.recentPast.length > 0 || sections.archived.length > 0 || sections.completed.length > 0

  if (!loading && !hasAnything) return null

  const sharedProps = { today, expandedIds, onExpand: handleExpand, onToggle: handleToggle, onGroupUpdate: handleGroupUpdate }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 md:px-6 py-5 mb-6">
      <h3 className="m-0 mb-5 text-[#1e2a3a] text-[17px] font-semibold">Prep Timeline</h3>
      {loading && <p className="text-slate-400 text-center py-5 text-sm m-0">Loading…</p>}
      {!loading && (
        <>
          <CollapsibleSection label="Upcoming — next 14 days" color={COLORS.BLUE} bgColor="#dbeafe" groups={sections.upcoming} defaultOpen={true} {...sharedProps} />
          <CollapsibleSection label="Recent past — last 14 days" color="#7c3aed" bgColor="#ede9fe" groups={sections.recentPast} defaultOpen={false} {...sharedProps} />
          <CollapsibleSection label="Archived" color="#64748b" bgColor="#f1f5f9" groups={sections.archived} defaultOpen={false} {...sharedProps} />
          <CollapsibleSection label="Completed" color="#065f46" bgColor="#d1fae5" groups={sections.completed} defaultOpen={false} {...sharedProps} />
        </>
      )}
    </div>
  )
}
