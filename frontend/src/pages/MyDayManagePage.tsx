/**
 * Parent's "My Day" manage view — add, edit, delete, and reset items.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMyDay, useMyDaySettings } from '../hooks/useMyDay'
import TimelineView from '../components/my-day/TimelineView'
import ProgressFooter from '../components/my-day/ProgressFooter'
import ItemEditor from '../components/my-day/ItemEditor'
import ImportFromSabino from '../components/my-day/ImportFromSabino'
import RoutineManager from '../components/my-day/RoutineManager'
import type { DailyPlanItem, MyDaySettings } from '../types'
import api from '../api/client'

function RoutineManagerModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Daily Routines</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="px-5 py-4">
          <p className="text-slate-400 text-[13px] mb-4">
            Routines auto-populate your child's plan each day.
          </p>
          <RoutineManager />
        </div>
      </div>
    </div>
  )
}

const DEFAULT_SETTINGS: MyDaySettings = {
  id: 0,
  day_start_hour: 7,
  day_end_hour: 20,
  school_start_time: '08:00',
  school_end_time: '15:00',
  show_school_block: true,
  auto_import_action_items: false,
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function MyDayManagePage() {
  const today = todayStr()
  const [date] = useState(today)
  const { items, progress, loading, fetchDay, toggleComplete, createItem, updateItem, deleteItem } = useMyDay()
  const { settings: rawSettings, fetchSettings } = useMyDaySettings()
  const settings = rawSettings ?? DEFAULT_SETTINGS

  const [editingItem, setEditingItem] = useState<Partial<DailyPlanItem> | null>(null)
  const [isNewItem, setIsNewItem] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)

  useEffect(() => {
    fetchDay(date)
    fetchSettings()
  }, [date, fetchDay, fetchSettings])

  async function handleSave(data: Partial<DailyPlanItem> & { recurrence?: string }) {
    const { recurrence, ...itemData } = data

    if (recurrence && recurrence !== 'none') {
      // Create a routine + generate for today
      await api.post('/api/my-day/routines', {
        title: itemData.title,
        emoji: itemData.emoji,
        start_time: itemData.start_time,
        duration_minutes: itemData.duration_minutes,
        category: itemData.category,
        notes: itemData.notes,
        recurrence,
      })
      await api.post(`/api/my-day/routines/generate?date=${date}`)
      await fetchDay(date)
    } else if (isNewItem) {
      await createItem(itemData as any)
    } else if (editingItem?.id) {
      await updateItem(editingItem.id, itemData)
    }
    setEditingItem(null)
  }

  async function handleDelete() {
    if (editingItem?.id) {
      await deleteItem(editingItem.id)
      setEditingItem(null)
    }
  }

  function openNewItem() {
    setIsNewItem(true)
    setEditingItem({ scheduled_date: date, start_time: '15:00', duration_minutes: 15, category: 'morning_routine' })
  }

  function openEdit(item: DailyPlanItem) {
    setIsNewItem(false)
    setEditingItem(item)
  }

  async function handleImportDone() {
    setShowImport(false)
    await fetchDay(date)
  }

  async function handleReschedule(id: number, newStartTime: string) {
    await updateItem(id, { start_time: newStartTime })
  }

  async function handleResetDay() {
    if (!confirm('Reset today\'s plan from routines? This will add any missing routine items.')) return
    await api.post(`/api/my-day/routines/generate?date=${date}`)
    await fetchDay(date)
  }

  const isEmpty = !loading && items.length === 0

  return (
    <>
      <div className="flex flex-col h-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">☀️</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">My Day</h1>
              <p className="text-sm text-gray-500 leading-none">{formatDate(date)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/my-day"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors"
            >
              <span>👶</span>
              <span>Kid View</span>
            </Link>
          </div>
        </div>

        {/* Manage toolbar */}
        <div className="flex gap-2 mb-3 shrink-0 flex-wrap">
          <button
            onClick={openNewItem}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors"
          >
            <span>＋</span> Add Item
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 border border-blue-200 transition-colors"
          >
            📚 Add from School
          </button>
          <button
            onClick={handleResetDay}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            🔄 Reset from Routines
          </button>
          <button
            onClick={() => setShowRoutines(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            ⚙ Routines
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-4xl animate-spin">⏳</div>
          </div>
        )}

        {!loading && isEmpty && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <span className="text-6xl mb-4">🌅</span>
            <h2 className="text-xl font-bold text-gray-800 mb-2">No items yet</h2>
            <p className="text-gray-500 text-base mb-4">Tap "＋ Add Item" to get started.</p>
          </div>
        )}

        {!loading && !isEmpty && (
          <>
            <TimelineView
              items={items}
              settings={settings}
              onToggle={toggleComplete}
              manage={true}
              onEdit={openEdit}
              onReschedule={handleReschedule}
              onDelete={async id => {
                if (confirm('Delete this item?')) await deleteItem(id)
              }}
            />
            <div className="shrink-0 pb-4">
              <ProgressFooter total={progress.total} completed={progress.completed} />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {editingItem !== null && (
        <ItemEditor
          item={editingItem}
          date={date}
          onSave={handleSave}
          onCancel={() => setEditingItem(null)}
          onDelete={!isNewItem ? handleDelete : undefined}
        />
      )}

      {showImport && (
        <ImportFromSabino
          date={date}
          onImport={handleImportDone}
          onCancel={() => setShowImport(false)}
        />
      )}

      {showRoutines && (
        <RoutineManagerModal onClose={() => setShowRoutines(false)} />
      )}
    </>
  )
}
