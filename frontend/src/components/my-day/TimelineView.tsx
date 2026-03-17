/**
 * Vertical timeline renderer for the kid's My Day view.
 * Lays out DailyPlanItems as height-proportional blocks with time labels.
 * In manage mode:
 *  - Drag the block body to reschedule (move start time)
 *  - Drag the bottom edge handle to extend/shrink duration
 *  - Drag the top edge handle to shift start time while keeping end time fixed
 *  - Click empty track area to create a new item at that time
 */
import { useEffect, useRef, useState } from 'react'
import type { DailyPlanItem, MyDaySettings } from '../../types'
import TimeBlock from './TimeBlock'
import NowMarker from './NowMarker'

const PX_PER_MINUTE = 2     // 1 hour = 120px
const MIN_BLOCK_H = 30      // 30px = 15 min minimum
const MIN_DURATION = 15     // minutes
const TIME_COL_W = 52       // px for the time label column
const HANDLE_H = 10         // px height of resize handle zones

function minutesFromMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Snap a raw pixel top to the nearest 5-minute start time string */
function topToStartTime(topPx: number, dayStartMin: number): string {
  const rawMins = dayStartMin + topPx / PX_PER_MINUTE
  const snapped = Math.round(rawMins / 5) * 5
  const clamped = Math.max(dayStartMin, Math.min(23 * 60 + 55, snapped))
  return minutesToHHMM(clamped)
}

/** Snap raw minutes to nearest 5, enforce min/max */
function snapMins(mins: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(mins / 5) * 5))
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function topForTime(hhmm: string, dayStart: number): number {
  return (minutesFromMidnight(hhmm) - dayStart) * PX_PER_MINUTE
}

// ── Drag state (move) ───────────────────────────────────────────────────────

interface DragState {
  id: number
  originalTop: number
  currentTop: number
  pointerStartY: number
  height: number
}

// ── Resize state ────────────────────────────────────────────────────────────

type ResizeEdge = 'top' | 'bottom'

interface ResizeState {
  id: number
  edge: ResizeEdge
  /** Pixel top of block at resize start */
  originalTop: number
  /** Block height at resize start */
  originalHeight: number
  /** clientY at pointer-down */
  pointerStartY: number
  /** Live values during resize */
  currentTop: number
  currentHeight: number
}

// ── Props ───────────────────────────────────────────────────────────────────

interface TimelineViewProps {
  items: DailyPlanItem[]
  settings: MyDaySettings
  onToggle: (id: number) => void
  manage?: boolean
  onEdit?: (item: DailyPlanItem) => void
  onDelete?: (id: number) => void
  onReschedule?: (id: number, newStartTime: string) => void
  onResize?: (id: number, newStartTime: string, newDurationMinutes: number) => void
  onClickCreate?: (startTime: string) => void
}

export default function TimelineView({
  items,
  settings,
  onToggle,
  manage = false,
  onEdit,
  onDelete,
  onReschedule,
  onResize,
  onClickCreate,
}: TimelineViewProps) {
  const { day_start_hour, day_end_hour, school_start_time, school_end_time, show_school_block } = settings
  const dayStartMin = day_start_hour * 60
  const dayEndMin   = day_end_hour   * 60
  const totalMinutes = dayEndMin - dayStartMin
  const timelineHeight = totalMinutes * PX_PER_MINUTE

  const [nowMin, setNowMin] = useState(nowMinutes())
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [resizing, setResizing] = useState<ResizeState | null>(null)
  const [hoverTop, setHoverTop] = useState<number | null>(null)
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

  const hourLabels: number[] = []
  for (let h = day_start_hour; h <= day_end_hour; h++) hourLabels.push(h)

  const schoolStartMin = minutesFromMidnight(school_start_time)
  const schoolEndMin   = minutesFromMidnight(school_end_time)

  // ── Move-drag handlers ──────────────────────────────────────────────────────

  function handleDragStart(
    e: React.PointerEvent<HTMLDivElement>,
    item: DailyPlanItem,
    topPx: number,
    height: number,
  ) {
    if (!manage) return
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging({ id: item.id, originalTop: topPx, currentTop: topPx, pointerStartY: e.clientY, height })
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
    if (Math.abs(deltaY) > 5 && onReschedule) {
      const newStartTime = topToStartTime(dragging.currentTop, dayStartMin)
      onReschedule(dragging.id, newStartTime)
    }
    setDragging(null)
  }

  // ── Resize handlers ─────────────────────────────────────────────────────────

  function handleResizeStart(
    e: React.PointerEvent<HTMLDivElement>,
    item: DailyPlanItem,
    edge: ResizeEdge,
    topPx: number,
    height: number,
  ) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizing({
      id: item.id,
      edge,
      originalTop: topPx,
      originalHeight: height,
      pointerStartY: e.clientY,
      currentTop: topPx,
      currentHeight: height,
    })
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    const deltaY = e.clientY - resizing.pointerStartY
    const maxEndPx = timelineHeight

    if (resizing.edge === 'bottom') {
      // Bottom handle: extend/shrink duration; keep top fixed
      const rawH = resizing.originalHeight + deltaY
      const snappedH = Math.round(rawH / (PX_PER_MINUTE * 5)) * (PX_PER_MINUTE * 5)
      const newH = Math.max(MIN_BLOCK_H, Math.min(maxEndPx - resizing.originalTop, snappedH))
      setResizing(r => r ? { ...r, currentHeight: newH } : null)
    } else {
      // Top handle: move start time; keep end time (bottom edge) fixed
      const originalBottom = resizing.originalTop + resizing.originalHeight
      const rawTop = resizing.originalTop + deltaY
      const snappedTop = Math.round(rawTop / (PX_PER_MINUTE * 5)) * (PX_PER_MINUTE * 5)
      const newTop = Math.max(0, Math.min(originalBottom - MIN_BLOCK_H, snappedTop))
      const newH = originalBottom - newTop
      setResizing(r => r ? { ...r, currentTop: newTop, currentHeight: newH } : null)
    }
  }

  function handleResizeEnd(_e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    const moved = Math.abs(_e.clientY - resizing.pointerStartY)
    if (moved > 3 && onResize) {
      const newStartTime = topToStartTime(resizing.currentTop, dayStartMin)
      const newDuration = snapMins(
        resizing.currentHeight / PX_PER_MINUTE,
        MIN_DURATION,
        (dayEndMin - dayStartMin),
      )
      onResize(resizing.id, newStartTime, newDuration)
    }
    setResizing(null)
  }

  // ── Click-to-create handlers ────────────────────────────────────────────────

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!manage || !onClickCreate) return
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = e.clientY - rect.top
    onClickCreate(topToStartTime(relY, dayStartMin))
  }

  function handleTrackMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!manage) return
    if (e.target !== e.currentTarget) { setHoverTop(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = e.clientY - rect.top
    const rawMins = dayStartMin + relY / PX_PER_MINUTE
    const snapped = Math.round(rawMins / 5) * 5
    setHoverTop((snapped - dayStartMin) * PX_PER_MINUTE)
  }

  function handleTrackMouseLeave() { setHoverTop(null) }

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
        <div
          className={`flex-1 relative pr-2 ${manage && onClickCreate ? 'cursor-pointer' : ''}`}
          onClick={handleTrackClick}
          onMouseMove={manage ? handleTrackMouseMove : undefined}
          onMouseLeave={manage ? handleTrackMouseLeave : undefined}
        >
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

          {/* Hover hint line */}
          {manage && hoverTop !== null && !dragging && !resizing && (
            <div
              className="absolute left-0 right-0 pointer-events-none z-[5] flex items-center"
              style={{ top: hoverTop }}
            >
              <div className="flex-1 border-t-2 border-dashed border-orange-300 opacity-80" />
              <span className="text-[10px] font-bold text-orange-500 bg-white/90 px-1.5 py-0.5 rounded-full select-none mr-2 shadow-sm whitespace-nowrap">
                {fmtTime(topToStartTime(hoverTop, dayStartMin))} ＋
              </span>
            </div>
          )}

          {/* Task blocks */}
          {items.map(item => {
            const topPx   = topForTime(item.start_time, dayStartMin)
            const naturalH = Math.max(item.duration_minutes * PX_PER_MINUTE, MIN_BLOCK_H)

            const isMoving  = dragging?.id  === item.id
            const isResizing = resizing?.id === item.id

            const displayTop = isMoving
              ? dragging!.currentTop
              : isResizing
                ? resizing!.currentTop
                : topPx

            const displayH = isResizing ? resizing!.currentHeight : naturalH

            const anyActive = isMoving || isResizing

            return (
              <div key={item.id}>
                {/* Ghost placeholder at original position */}
                {anyActive && (
                  <div
                    className="absolute left-0 right-0 z-10 rounded-xl border-2 border-dashed border-gray-300 bg-gray-200/40"
                    style={{ top: topPx, height: naturalH }}
                  />
                )}

                {/* Live block wrapper — handles move-drag */}
                <div
                  className={`absolute left-0 right-0 z-10 pt-0.5 ${
                    manage
                      ? isMoving
                        ? 'cursor-grabbing'
                        : isResizing
                          ? 'cursor-ns-resize'
                          : 'cursor-grab'
                      : ''
                  } ${anyActive ? 'z-20 shadow-2xl opacity-95' : ''}`}
                  style={{ top: displayTop, height: displayH }}
                  onPointerDown={manage ? e => handleDragStart(e, item, topPx, naturalH) : undefined}
                  onPointerMove={manage ? (isMoving ? handleDragMove : isResizing ? handleResizeMove : undefined) : undefined}
                  onPointerUp={manage ? (isMoving ? handleDragEnd : isResizing ? handleResizeEnd : undefined) : undefined}
                  onPointerCancel={manage ? () => { setDragging(null); setResizing(null) } : undefined}
                >
                  {/* ── Top resize handle ── */}
                  {manage && (
                    <div
                      className="absolute left-0 right-0 z-30 flex items-center justify-center group/top"
                      style={{ top: 0, height: HANDLE_H, cursor: 'ns-resize' }}
                      onPointerDown={e => handleResizeStart(e, item, 'top', topPx, naturalH)}
                      onPointerMove={handleResizeMove}
                      onPointerUp={handleResizeEnd}
                    >
                      {/* Subtle grip bar — visible on hover or during resize */}
                      <div className={`w-8 h-1 rounded-full transition-colors ${
                        isResizing && resizing!.edge === 'top'
                          ? 'bg-orange-400'
                          : 'bg-transparent group-hover/top:bg-gray-400/50'
                      }`} />
                    </div>
                  )}

                  <TimeBlock
                    item={item}
                    onToggle={onToggle}
                    manage={manage}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />

                  {/* ── Bottom resize handle ── */}
                  {manage && (
                    <div
                      className="absolute left-0 right-0 z-30 flex items-center justify-center group/bot"
                      style={{ bottom: 0, height: HANDLE_H, cursor: 'ns-resize' }}
                      onPointerDown={e => handleResizeStart(e, item, 'bottom', topPx, naturalH)}
                      onPointerMove={handleResizeMove}
                      onPointerUp={handleResizeEnd}
                    >
                      <div className={`w-8 h-1 rounded-full transition-colors ${
                        isResizing && resizing!.edge === 'bottom'
                          ? 'bg-orange-400'
                          : 'bg-transparent group-hover/bot:bg-gray-400/50'
                      }`} />
                    </div>
                  )}

                  {/* Live time badge during move */}
                  {isMoving && (
                    <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow pointer-events-none whitespace-nowrap">
                      {fmtTime(topToStartTime(dragging!.currentTop, dayStartMin))}
                    </div>
                  )}

                  {/* Live time badge during resize — shows start → end */}
                  {isResizing && (() => {
                    const startStr = fmtTime(topToStartTime(resizing!.currentTop, dayStartMin))
                    const endMins = snapMins(
                      (resizing!.currentTop + resizing!.currentHeight) / PX_PER_MINUTE + dayStartMin,
                      dayStartMin + MIN_DURATION,
                      dayEndMin,
                    )
                    const endStr = fmtTime(minutesToHHMM(endMins))
                    const durationMins = snapMins(resizing!.currentHeight / PX_PER_MINUTE, MIN_DURATION, dayEndMin - dayStartMin)
                    return (
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 bg-orange-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow pointer-events-none whitespace-nowrap flex items-center gap-1">
                        <span>{startStr}</span>
                        <span className="opacity-70">→</span>
                        <span>{endStr}</span>
                        <span className="opacity-60 text-[10px]">({durationMins}m)</span>
                      </div>
                    )
                  })()}
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
