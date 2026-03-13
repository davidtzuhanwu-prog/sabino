import { useEffect, useState } from 'react'
import api from '../../api/client'
import type { ActionItem } from '../../types'

function formatDate(dateStr: string | null) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PrepTimeline() {
  const [items, setItems] = useState<ActionItem[]>([])

  useEffect(() => {
    api.get<ActionItem[]>('/api/action-items/upcoming', { params: { days: 60 }, silent: true })
      .then(r => setItems(r.data.filter(i => !i.completed && i.event_date)))
      .catch(() => {})
  }, [])

  if (items.length === 0) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Prep Timeline — Next 60 Days</h3>
      <div style={styles.timeline}>
        {items.map(item => {
          const eventDate = new Date(item.event_date! + 'T00:00:00')
          const prepDate = item.prep_start_date ? new Date(item.prep_start_date + 'T00:00:00') : eventDate
          const totalDays = Math.max(1, (eventDate.getTime() - today.getTime()) / 86400000)
          const prepDays = Math.max(0, (eventDate.getTime() - prepDate.getTime()) / 86400000)
          const prepPct = Math.min(100, (prepDays / totalDays) * 100)

          const isPrepOverdue = prepDate < today
          const isEventSoon = totalDays <= 7

          return (
            <div key={item.id} style={styles.row}>
              <div style={styles.label}>
                <span style={{ ...styles.title, ...(isEventSoon ? styles.urgent : {}) }}>{item.title}</span>
                {item.is_short_notice && <span style={styles.badge}>⚠️</span>}
              </div>
              <div style={styles.barContainer}>
                <div
                  style={{
                    ...styles.prepBar,
                    width: `${prepPct}%`,
                    background: isPrepOverdue ? '#ef4444' : '#fbbf24',
                  }}
                />
                <div style={{ ...styles.eventMarker, right: 0 }} title={`Event: ${formatDate(item.event_date)}`} />
              </div>
              <div style={styles.dates}>
                <span style={{ color: isPrepOverdue ? '#ef4444' : '#065f46', fontSize: 12 }}>
                  Prep: {formatDate(item.prep_start_date)}
                </span>
                <span style={{ color: isEventSoon ? '#dc2626' : '#475569', fontSize: 12, fontWeight: 600 }}>
                  Event: {formatDate(item.event_date)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px', marginBottom: 24 },
  heading: { margin: '0 0 20px', color: '#1e2a3a', fontSize: 17 },
  timeline: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: 600, color: '#374151' },
  urgent: { color: '#dc2626' },
  badge: { fontSize: 13 },
  barContainer: { height: 10, background: '#e2e8f0', borderRadius: 6, position: 'relative', overflow: 'visible' },
  prepBar: { height: '100%', borderRadius: 6, position: 'absolute', right: 0, transition: 'width 0.3s' },
  eventMarker: {
    position: 'absolute', top: -4, width: 4, height: 18,
    background: '#ef4444', borderRadius: 2,
  },
  dates: { display: 'flex', justifyContent: 'space-between' },
}
