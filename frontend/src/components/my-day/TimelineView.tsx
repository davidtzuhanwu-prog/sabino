/**
 * Vertical timeline renderer for the kid's My Day view.
 * Lays out DailyPlanItems as height-proportional blocks with time labels.
 * In manage mode, blocks can be dragged up/down to reschedule.
 */
import { useEffect, useRef, useState } from 'react'
import type { DailyPlanItem, MyDaySettings } from '../../types'
import TimeBlock from './TimeBlock'
import NowMarker from './NowMarker'

const PX_PER_MINUTE = 2     // 1 hour = 120px, matches TimeBlock
const MIN_BLOCK_H = 60
const TIME_COL_W = 52       // px for the time label column

function minutesFromMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function topToStartTime(topPx: number, dayStartMin: number): string {
  const rawMins = dayStartMin + topPx / PX_PER_MINUTE
  const snapped = Math.round(rawMins / 5) * 5
  const clamped = Math.max(dayStartMin, Math.min(23 * 60 + 55, snapped))
  return minutesToHHMM(clamped)
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function topForTime(hhmm: string, dayStart: number): number {
  return (minutesFromMidnight(hhmm) - dayStart) * PX_PER_MINUTE
}

interface DragState {
  id: number
  originalTop: number
  currentTop: number
  pointerStartY: number
  height: number
}

interface TimelineViewProps {
  items: DailyPlanItem[]
  settings: MyDaySettings
  onToggle: (id: number) => void
  manage?: boolean
  onEdit?: (item: DailyPlanItem) => void
  onDelete?: (id: number) => void
  onReschedule?: (id: number, newStartTime: string) => void
}

export default function TimelineView({
  items,
  settings,
  onToggle,
  manage = false,
  onEdit,
  onDelete,
  onReschedule,
}: TimelineViewProps) {
  const { day_start_hour, day_end_hour, school_start_time, school_end_time, show_school_block } = settings
  const dayStartMin = day_start_hour * 60
  const dayEndMin   = day_end_hour   * 60
  const totalMinutes = dayEndMin - dayStartMin
  const timelineHeight = totalMinutes * PX_PER_MINUTE

  const [nowMin, setNowMin] = useState(nowMinutes())
  const [dragging, setDragging] = useState<DragState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Update NOW marker every minute
  useEffect(() => {
    const id = setInterval(() => setNowMin(nowMinutes()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll so NOW is roughly in upper third of viewport on first load
  useEffect(() => {
    if (!scrollRef.current) return
    const nowTop = (nowMin - dayStartMin) * PX_PER_MINUTE
    const vpH = scrollRef.current.clientHeight
    scrollRef.current.scrollTop = Math.max(0, nowTop - vpH * 0.25)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const nowTopPx = (nowMin - dayStartMin) * PX_PER_MINUTE

  // Hour labels
  const hourLabels: number[] = []
  for (let h = day_start_hour; h <= day_end_hour; h++) hourLabels.push(h)

  const schoolStartMin = minutesFromMidnight(school_start_time)
  const schoolEndMin   = minutesFromMidnight(school_end_time)

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(
    e: React.PointerEvent<HTMLDivElement>,
    item: DailyPlanItem,
    topPx: number,
    height: number,
  ) {
    if (!manage) return
    // Don't start a drag if the pointer landed on a button (edit/delete)
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging({
      id: item.id,
      originalTop: topPx,
      currentTop: topPx,
      pointerStartY: e.clientY,
      height,
    })
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const deltaY = e.clientY - dragging.pointerStartY
    const rawTop = dragging.originalTop + deltaY
    const clamped = Math.max(0, Math.min(timelineHeight - dragging.height, rawTop))
    setDragging(d => d ? { ...d, currentTop: clamped } : null)
  }

  function handleDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const deltaY = e.clientY - dragging.pointerStartY
    // Only reschedule if actually dragged more than 5px (not just a click)
    if (Math.abs(deltaY) > 5 && onReschedule) {
      const newStartTime = topToStartTime(dragging.currentTop, dayStartMin)
      onReschedule(dragging.id, newStartTime)
    }
    setDragging(null)
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="relative flex" style={{ height: timelineHeight, minHeight: timelineHeight }}>
        {/* ── Time labels column ── */}
        <div className="shrink-0 relative" style={{ width: TIME_COL_W }}>
          {hourLabels.map(h => {
            const topPx = (h * 60 - dayStartMin) * PX_PER_MINUTE
            return (
              <div
                key={h}
                className="absolute text-[12px] text-gray-400 font-medium leading-none select-none"
                style={{ top: topPx - 6, right: 6 }}
              >
                {h > 12 ? `${h - 12}PM` : h === 12 ? '12PM' : `${h}AM`}
              </div>
            )
          })}
        </div>

        {/* ── Main track ── */}
        <div className="flex-1 relative pr-2">
          {/* Hour grid lines */}
          {hourLabels.map(h => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: (h * 60 - dayStartMin) * PX_PER_MINUTE }}
            />
          ))}

          {/* School block */}
          {show_school_block && (
            <div
              className="absolute left-0 right-0 flex flex-col items-center justify-center rounded-xl border border-blue-200 bg-[#D0EBFF]/60 z-0"
              style={{
                top:    topForTime(school_start_time, dayStartMin),
                height: (schoolEndMin - schoolStartMin) * PX_PER_MINUTE,
              }}
            >
              <span className="text-2xl">🏫</span>
              <span className="text-xs font-bold text-blue-500 tracking-wide mt-1">SCHOOL</span>
              <span className="text-[11px] text-blue-400 mt-0.5">
                {fmtTime(school_start_time)} — {fmtTime(school_end_time)}
              </span>
            </div>
          )}

          {/* Task blocks */}
          {items.map(item => {
            const topPx = topForTime(item.start_time, dayStartMin)
            const height = Math.max(item.duration_minutes * PX_PER_MINUTE, MIN_BLOCK_H)
            const isDragging = dragging?.id === item.id
            const displayTop = isDragging ? dragging!.currentTop : topPx

            return (
              <div key={item.id}>
                {/* Ghost at original position while dragging */}
                {isDragging && (
                  <div
                    className="absolute left-0 right-0 z-10 rounded-xl border-2 border-dashed border-gray-300 bg-gray-200/40"
                    style={{ top: topPx, height }}
                  />
                )}

                {/* Live block */}
                <div
                  className={`absolute left-0 right-0 z-10 transition-shadow ${
                    manage ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
                  } ${isDragging ? 'z-20 shadow-2xl ring-2 ring-orange-400 opacity-95' : ''}`}
                  style={{ top: displayTop, height }}
                  onPointerDown={manage ? e => handleDragStart(e, item, topPx, height) : undefined}
                  onPointerMove={manage ? handleDragMove : undefined}
                  onPointerUp={manage ? handleDragEnd : undefined}
                  onPointerCancel={manage ? () => setDragging(null) : undefined}
                >
                  <TimeBlock
                    item={item}
                    onToggle={onToggle}
                    manage={manage}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </div>
              </div>
            )
          })}

          {/* NOW marker */}
          {nowMin >= dayStartMin && nowMin <= dayEndMin && (
            <NowMarker topPx={nowTopPx} />
          )}
        </div>
      </div>
    </div>
  )
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
