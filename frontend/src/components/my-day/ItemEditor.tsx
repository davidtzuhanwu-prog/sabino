/**
 * Bottom-sheet / modal editor for creating or editing a DailyPlanItem.
 */
import { useState } from 'react'
import type { DailyPlanItem, PlanCategory } from '../../types'
import { CATEGORY_OPTIONS } from './categoryColors'

const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90]

const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'Just this day' },
  { value: 'daily',    label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekends', label: 'Weekends' },
]

interface ItemEditorProps {
  item?: Partial<DailyPlanItem>   // undefined = create mode
  date: string                     // YYYY-MM-DD
  onSave: (data: Partial<DailyPlanItem> & { recurrence?: string }) => void
  onCancel: () => void
  onDelete?: () => void
}

export default function ItemEditor({ item, date, onSave, onCancel, onDelete }: ItemEditorProps) {
  const isNew = !item?.id

  const [title, setTitle]           = useState(item?.title ?? '')
  const [emoji, setEmoji]           = useState(item?.emoji ?? '📋')
  const [startTime, setStartTime]   = useState(item?.start_time ?? '08:00')
  const [duration, setDuration]     = useState(item?.duration_minutes ?? 15)
  const [category, setCategory]     = useState<PlanCategory>(item?.category ?? 'morning_routine')
  const [notes, setNotes]           = useState(item?.notes ?? '')
  const [recurrence, setRecurrence] = useState('none')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleSave() {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      emoji,
      start_time: startTime,
      duration_minutes: duration,
      category,
      notes: notes.trim() || null,
      scheduled_date: date,
      recurrence: recurrence !== 'none' ? recurrence : undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{isNew ? 'Add Item' : 'Edit Item'}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Emoji + Title */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={emoji}
              onChange={e => setEmoji(e.target.value.slice(-2))}
              className="w-14 h-12 text-2xl text-center border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:border-orange-400"
              placeholder="📋"
            />
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What do you need to do?"
              className="flex-1 h-12 px-3 border border-gray-200 rounded-xl text-base font-medium text-gray-900 focus:outline-none focus:border-orange-400 bg-gray-50"
            />
          </div>

          {/* Time + Duration */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full h-11 px-3 border border-gray-200 rounded-xl text-base text-gray-900 focus:outline-none focus:border-orange-400 bg-gray-50"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Duration</label>
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full h-11 px-3 border border-gray-200 rounded-xl text-base text-gray-900 focus:outline-none focus:border-orange-400 bg-gray-50"
              >
                {DURATION_OPTIONS.map(d => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as PlanCategory)}
              className="w-full h-11 px-3 border border-gray-200 rounded-xl text-base text-gray-900 focus:outline-none focus:border-orange-400 bg-gray-50"
            >
              {CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any details for your child…"
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-orange-400 bg-gray-50 resize-none"
            />
          </div>

          {/* Repeat — only for new items */}
          {isNew && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Repeat</label>
              <div className="flex flex-wrap gap-2">
                {RECURRENCE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setRecurrence(o.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      recurrence === o.value
                        ? 'bg-orange-100 text-orange-700 border border-orange-300'
                        : 'bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Source badge */}
          {item?.source_action_item_id && (
            <p className="text-xs text-gray-400 italic">← Linked to a Sabino action item</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center gap-2">
          {!isNew && onDelete && (
            <>
              {confirmDelete ? (
                <>
                  <button
                    onClick={onDelete}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-semibold text-sm"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2.5 rounded-xl bg-red-50 text-red-500 font-semibold text-sm hover:bg-red-100 transition-colors"
                >
                  🗑️
                </button>
              )}
            </>
          )}
          {!confirmDelete && (
            <>
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!title.trim()}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold text-sm hover:bg-orange-600 transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
