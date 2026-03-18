import { useState } from 'react'
import type { DailyPlanItem } from '../../types'
import { CATEGORY_BG, CATEGORY_BORDER } from './categoryColors'

interface TimeBlockProps {
  item: DailyPlanItem
  onToggle: (id: number) => void
  /** Extra controls shown in manage mode */
  manage?: boolean
  onEdit?: (item: DailyPlanItem) => void
  onDelete?: (id: number) => void
}

export default function TimeBlock({ item, onToggle, manage, onEdit, onDelete }: TimeBlockProps) {
  const [justCompleted, setJustCompleted] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

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
      className={`relative w-full h-full rounded-xl border-l-4 px-3 py-1.5 cursor-pointer select-none transition-all duration-300 overflow-hidden ${
        item.completed ? 'opacity-40' : 'opacity-100'
      } ${justCompleted ? 'scale-[0.97]' : 'scale-100'}`}
      style={{
        backgroundColor: bg,
        borderLeftColor: border,
        borderTop: `1px solid ${border}`,
        borderRight: `1px solid ${border}`,
        borderBottom: `1px solid ${border}`,
      }}
      onClick={handleTap}
      onContextMenu={e => { e.preventDefault(); setShowNotes(v => !v) }}
    >
      <div className="flex items-center gap-2 min-w-0 h-full">
        <span className="flex-1 text-[15px] font-bold text-gray-800 leading-tight truncate">
          {item.title}
        </span>

        {/* Kid mode: whole block is tappable; show a small checkmark icon when done */}
        {!manage && item.completed && (
          <svg
            viewBox="0 0 12 10"
            className={`shrink-0 w-4 h-4 text-green-600 ${justCompleted ? 'animate-[bounce_0.3s_ease]' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Completed"
          >
            <polyline points="1,5 4.5,8.5 11,1" />
          </svg>
        )}

        {/* Manage mode: edit/delete buttons */}
        {manage && (
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
          </div>
        )}
      </div>

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
