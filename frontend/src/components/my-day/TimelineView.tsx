/**
 * Vertical timeline renderer for the kid's My Day view.
 * Lays out DailyPlanItems as height-proportional blocks with time labels.
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

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function topForTime(hhmm: string, dayStart: number): number {
  return (minutesFromMidnight(hhmm) - dayStart) * PX_PER_MINUTE
}

interface TimelineViewProps {
  items: DailyPlanItem[]
  settings: MyDaySettings
  onToggle: (id: number) => void
  manage?: boolean
  onEdit?: (item: DailyPlanItem) => void
  onDelete?: (id: number) => void
  renderDragHandle?: (item: DailyPlanItem) => React.ReactNode
}

export default function TimelineView({
  items,
  settings,
  onToggle,
  manage = false,
  onEdit,
  onDelete,
  renderDragHandle,
}: TimelineViewProps) {
  const { day_start_hour, day_end_hour, school_start_time, school_end_time, show_school_block } = settings
  const dayStartMin = day_start_hour * 60
  const dayEndMin   = day_end_hour   * 60
  const totalMinutes = dayEndMin - dayStartMin
  const timelineHeight = totalMinutes * PX_PER_MINUTE

  const [nowMin, setNowMin] = useState(nowMinutes())
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowRef = useRef<HTMLDivElement>(null)

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
            return (
              <div
                key={item.id}
                className="absolute left-0 right-0 z-10"
                style={{ top: topPx, height }}
              >
                <TimeBlock
                  item={item}
                  onToggle={onToggle}
                  manage={manage}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  dragHandle={renderDragHandle?.(item)}
                />
              </div>
            )
          })}

          {/* NOW marker */}
          {nowMin >= dayStartMin && nowMin <= dayEndMin && (
            <div ref={nowRef}>
              <NowMarker topPx={nowTopPx} />
            </div>
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
