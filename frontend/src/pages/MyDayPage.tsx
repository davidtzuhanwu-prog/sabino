/**
 * Kid's "My Day" view — read-only timeline with tap-to-complete.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMyDay, useMyDaySettings } from '../hooks/useMyDay'
import TimelineView from '../components/my-day/TimelineView'
import ProgressFooter from '../components/my-day/ProgressFooter'
import type { MyDaySettings } from '../types'

const DEFAULT_SETTINGS: MyDaySettings = {
  id: 0,
  day_start_hour: 7,
  day_end_hour: 20,
  school_start_time: '08:00',
  school_end_time: '15:00',
  show_school_block: true,
  auto_import_action_items: false,
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function MyDayPage() {
  const today = todayStr()
  const [date] = useState(today)
  const { items, progress, loading, fetchDay, toggleComplete } = useMyDay()
  const { settings: rawSettings, fetchSettings } = useMyDaySettings()
  const settings = rawSettings ?? DEFAULT_SETTINGS

  useEffect(() => {
    fetchDay(date)
  }, [date, fetchDay])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const isEmpty = !loading && items.length === 0

  return (
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
          {/* Parent manage mode button */}
          <Link
            to="/my-day/manage"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <span>⚙️</span>
            <span className="hidden sm:inline">Manage</span>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl animate-spin mb-2">⏳</div>
            <p className="text-gray-500">Loading your day…</p>
          </div>
        </div>
      )}

      {!loading && isEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <span className="text-6xl mb-4">🌅</span>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No plans yet!</h2>
          <p className="text-gray-500 text-base">Ask a grown-up to set up your day.</p>
        </div>
      )}

      {!loading && !isEmpty && (
        <>
          <TimelineView
            items={items}
            settings={settings}
            onToggle={toggleComplete}
          />
          <div className="shrink-0 pb-4">
            <ProgressFooter total={progress.total} completed={progress.completed} />
          </div>
        </>
      )}
    </div>
  )
}
