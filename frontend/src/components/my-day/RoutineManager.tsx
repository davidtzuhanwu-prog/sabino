/**
 * Manage repeating routines that auto-populate the daily timeline.
 * Used inside the Settings page (My Day section).
 */
import { useEffect, useState } from 'react'
import { useRoutines } from '../../hooks/useMyDay'
import type { DailyRoutine, PlanCategory } from '../../types'
import { CATEGORY_OPTIONS, CATEGORY_BG, CATEGORY_BORDER } from './categoryColors'

const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90]

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  weekends: 'Weekends (Sat–Sun)',
  custom: 'Custom days',
}

// Spec DOW: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function formatCustomDays(customDays: string | null): string {
  if (!customDays) return 'Custom'
  try {
    const days: number[] = JSON.parse(customDays)
    return days.sort((a, b) => a - b).map(d => DOW_LABELS[d]).join(', ')
  } catch {
    return 'Custom'
  }
}

interface RoutineFormProps {
  initial?: Partial<DailyRoutine>
  onSave: (data: Omit<DailyRoutine, 'id'>) => void
  onCancel: () => void
}

function RoutineForm({ initial, onSave, onCancel }: RoutineFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '📋')
  const [startTime, setStartTime] = useState(initial?.start_time ?? '08:00')
  const [duration, setDuration] = useState(initial?.duration_minutes ?? 15)
  const [category, setCategory] = useState<PlanCategory>(initial?.category ?? 'morning_routine')
  const [recurrence, setRecurrence] = useState<DailyRoutine['recurrence']>(initial?.recurrence ?? 'daily')
  const [customDays, setCustomDays] = useState<number[]>(() => {
    if (initial?.custom_days) {
      try { return JSON.parse(initial.custom_days) } catch { return [] }
    }
    return []
  })
  const [active, setActive] = useState(initial?.active ?? true)

  function toggleDay(day: number) {
    setCustomDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function handleSave() {
    if (!title.trim()) return
    if (recurrence === 'custom' && customDays.length === 0) return
    onSave({
      title: title.trim(),
      emoji,
      start_time: startTime,
      duration_minutes: duration,
      category,
      notes: null,
      recurrence,
      custom_days: recurrence === 'custom' ? JSON.stringify(customDays) : null,
      active,
    })
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-gray-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={emoji}
          onChange={e => setEmoji(e.target.value.slice(-2))}
          className="w-12 h-10 text-2xl text-center border border-gray-200 rounded-lg bg-white"
          placeholder="📋"
        />
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Routine name"
          className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm font-medium bg-white"
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Start Time</label>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="w-full h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Duration</label>
          <select
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            className="w-full h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as PlanCategory)}
            className="w-full h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Repeats</label>
          <select
            value={recurrence}
            onChange={e => setRecurrence(e.target.value as DailyRoutine['recurrence'])}
            className="w-full h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays (Mon–Fri)</option>
            <option value="weekends">Weekends (Sat–Sun)</option>
            <option value="custom">Custom days…</option>
          </select>
        </div>
      </div>

      {recurrence === 'custom' && (
        <div>
          <label className="text-xs text-gray-500 mb-2 block">Pick days</label>
          <div className="flex gap-1.5">
            {DOW_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  customDays.includes(day)
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {customDays.length === 0 && (
            <p className="text-xs text-red-400 mt-1">Select at least one day.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="routine-active"
          checked={active}
          onChange={e => setActive(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <label htmlFor="routine-active" className="text-sm text-gray-700">Active (generates items daily)</label>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!title.trim()}
          className="flex-1 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  )
}

export default function RoutineManager() {
  const { routines, fetchRoutines, createRoutine, updateRoutine, deleteRoutine } = useRoutines()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  useEffect(() => { fetchRoutines() }, [fetchRoutines])

  async function handleCreate(data: Omit<DailyRoutine, 'id'>) {
    await createRoutine(data)
    setShowForm(false)
  }

  async function handleUpdate(id: number, data: Omit<DailyRoutine, 'id'>) {
    await updateRoutine(id, data)
    setEditingId(null)
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this routine? Already-generated items for today will remain.')) return
    await deleteRoutine(id)
  }

  return (
    <div className="space-y-3">
      {routines.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 italic">No routines yet. Add one to auto-populate your child's daily plan.</p>
      )}

      {routines.map(r => (
        editingId === r.id ? (
          <RoutineForm
            key={r.id}
            initial={r}
            onSave={data => handleUpdate(r.id, data)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={r.id}
            className="flex items-center gap-3 p-3 rounded-xl border"
            style={{ background: CATEGORY_BG[r.category] ?? '#f9f9f9', borderColor: CATEGORY_BORDER[r.category] ?? '#e5e7eb' }}
          >
            <span className="text-xl shrink-0">{r.emoji ?? '📋'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{r.title}</p>
              <p className="text-xs text-gray-500">
                {r.start_time} · {r.duration_minutes} min · {r.recurrence === 'custom' ? formatCustomDays(r.custom_days) : (RECURRENCE_LABELS[r.recurrence] ?? r.recurrence)}
                {!r.active && <span className="ml-1 text-gray-400">(paused)</span>}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => setEditingId(r.id)}
                className="p-1.5 rounded-lg hover:bg-black/10 text-gray-500 text-sm"
              >✏️</button>
              <button
                onClick={() => handleDelete(r.id)}
                className="p-1.5 rounded-lg hover:bg-red-100 text-gray-400 text-sm"
              >🗑️</button>
            </div>
          </div>
        )
      ))}

      {showForm && (
        <RoutineForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {!showForm && editingId === null && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-medium hover:border-orange-300 hover:text-orange-600 transition-colors"
        >
          ＋ Add Routine
        </button>
      )}
    </div>
  )
}
