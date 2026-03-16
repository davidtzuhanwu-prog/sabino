import { useEffect, useState } from 'react'
import api from '../api/client'
import type { CalendarEvent } from '../types'

function formatDateTime(dt: string | null) {
  if (!dt) return 'TBD'
  return new Date(dt).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<CalendarEvent[]>('/api/calendar', { params: { days_ahead: 90 }, silent: true })
      .then(r => setEvents(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      {loading && <p className="text-slate-400 text-center py-10">Loading...</p>}
      {!loading && events.length === 0 && (
        <div className="text-center py-16 text-slate-600">
          <p>No upcoming events found.</p>
          <p className="text-slate-400 text-sm mt-1">Go to Settings → Scan Now to sync your Google Calendar.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map(event => (
          <div key={event.id} className="bg-white border border-slate-200 rounded-xl px-5 py-4">
            <h3 className="m-0 mb-2.5 text-[#1e2a3a] text-base font-semibold">{event.title || '(untitled)'}</h3>
            <p className="text-blue-500 text-sm m-0 mb-1.5 font-medium">📅 {formatDateTime(event.start_datetime)}</p>
            {event.location && <p className="text-slate-500 text-[13px] m-0 mb-2">📍 {event.location}</p>}
            {event.description && (
              <p className="text-slate-600 text-[13px] m-0 leading-relaxed">{event.description.slice(0, 200)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
