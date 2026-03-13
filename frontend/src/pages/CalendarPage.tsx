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
      {loading && <p style={styles.loadMsg}>Loading...</p>}
      {!loading && events.length === 0 && (
        <div style={styles.empty}>
          <p>No upcoming events found.</p>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Go to Settings → Scan Now to sync your Google Calendar.</p>
        </div>
      )}

      <div style={styles.grid}>
        {events.map(event => (
          <div key={event.id} style={styles.card}>
            <h3 style={styles.title}>{event.title || '(untitled)'}</h3>
            <p style={styles.date}>📅 {formatDateTime(event.start_datetime)}</p>
            {event.location && <p style={styles.location}>📍 {event.location}</p>}
            {event.description && (
              <p style={styles.description}>{event.description.slice(0, 200)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loadMsg: { color: '#94a3b8', textAlign: 'center', padding: 40 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#475569' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' },
  title: { margin: '0 0 10px', color: '#1e2a3a', fontSize: 16 },
  date: { color: '#3b82f6', fontSize: 14, margin: '0 0 6px', fontWeight: 500 },
  location: { color: '#64748b', fontSize: 13, margin: '0 0 8px' },
  description: { color: '#475569', fontSize: 13, margin: 0, lineHeight: 1.5 },
}
