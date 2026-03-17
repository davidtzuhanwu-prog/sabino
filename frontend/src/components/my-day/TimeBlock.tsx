import { useState } from 'react'
import type { DailyPlanItem } from '../../types'
import { CATEGORY_BG, CATEGORY_BORDER } from './categoryColors'

const PX_PER_MINUTE = 2   // 1 hour = 120px
const MIN_HEIGHT = 60

interface TimeBlockProps {
  item: DailyPlanItem
  onToggle: (id: number) => void
  /** Extra controls shown in manage mode */
  manage?: boolean
  onEdit?: (item: DailyPlanItem) => void
  onDelete?: (id: number) => void
  dragHandle?: React.ReactNode
}

export default function TimeBlock({ item, onToggle, manage, onEdit, onDelete, dragHandle }: TimeBlockProps) {
  const [justCompleted, setJustCompleted] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const height = Math.max(item.duration_minutes * PX_PER_MINUTE, MIN_HEIGHT)
  const bg = CATEGORY_BG[item.category] ?? '#F8F9FA'
  const border = CATEGORY_BORDER[item.category] ?? '#DEE2E6'

  function handleTap() {
    if (manage) return
    if (!item.completed) setJustCompleted(true)
    setTimeout(() => setJustCompleted(false), 600)
    onToggle(item.id)
  }

  return (
    <div
      className={`relative rounded-xl border-l-4 px-3 py-2 cursor-pointer select-none transition-all duration-300 ${
        item.completed ? 'opacity-50' : 'opacity-100'
      } ${justCompleted ? 'scale-[0.97]' : 'scale-100'}`}
      style={{
        height,
        backgroundColor: bg,
        borderLeftColor: border,
        minHeight: MIN_HEIGHT,
      }}
      onClick={handleTap}
      onContextMenu={e => { e.preventDefault(); setShowNotes(v => !v) }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none mt-0.5 shrink-0">{item.emoji ?? '📋'}</span>
        <span className="flex-1 font-bold text-gray-800 text-[17px] leading-snug break-words">
          {item.title}
        </span>

        {/* Completed checkmark */}
        {item.completed && (
          <span className="text-green-500 text-xl shrink-0 animate-[bounce_0.3s_ease]">✅</span>
        )}

        {/* Manage mode buttons */}
        {manage && !item.completed && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button
              className="p-1 rounded hover:bg-black/10 text-gray-500 hover:text-gray-800 transition-colors"
              onClick={() => onEdit?.(item)}
              title="Edit"
            >✏️</button>
            <button
              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
              onClick={() => onDelete?.(item.id)}
              title="Delete"
            >🗑️</button>
            {dragHandle}
          </div>
        )}
      </div>

      {/* Duration label */}
      {height >= 70 && (
        <div className="text-xs text-gray-500 mt-1 pl-7">
          {item.duration_minutes} min
        </div>
      )}

      {/* Notes popover (long-press / right-click) */}
      {showNotes && item.notes && (
        <div
          className="absolute bottom-full left-0 mb-2 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-3 max-w-xs text-sm text-gray-700"
          onClick={e => { e.stopPropagation(); setShowNotes(false) }}
        >
          {item.notes}
        </div>
      )}
    </div>
  )
}
