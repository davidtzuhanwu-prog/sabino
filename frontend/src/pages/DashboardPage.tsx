import { useEffect, useState } from 'react'
import api from '../api/client'
import ActionItemChecklist from '../components/dashboard/ActionItemChecklist'
import PrepTimeline from '../components/dashboard/PrepTimeline'
import type { ActionItem } from '../types'

function SummaryCards() {
  const [all, setAll] = useState<ActionItem[]>([])
  const [upcoming, setUpcoming] = useState<ActionItem[]>([])
  const [shortNotice, setShortNotice] = useState<ActionItem[]>([])

  useEffect(() => {
    api.get<ActionItem[]>('/api/action-items', { params: { completed: false, limit: 500 }, silent: true })
      .then(r => setAll(r.data)).catch(() => {})
    api.get<ActionItem[]>('/api/action-items/upcoming', { params: { days: 14 }, silent: true })
      .then(r => setUpcoming(r.data)).catch(() => {})
    api.get<ActionItem[]>('/api/action-items/short-notice', { silent: true })
      .then(r => setShortNotice(r.data)).catch(() => {})
  }, [])

  const cards = [
    { label: 'Pending Actions', value: all.length, color: '#3b82f6', bg: '#eff6ff' },
    { label: 'Due in 14 Days', value: upcoming.length, color: '#d97706', bg: '#fffbeb' },
    { label: 'Short Notice', value: shortNotice.length, color: '#ef4444', bg: '#fef2f2' },
  ]

  return (
    <div style={styles.cards}>
      {cards.map(c => (
        <div key={c.label} style={{ ...styles.card, background: c.bg }}>
          <span style={{ ...styles.cardValue, color: c.color }}>{c.value}</span>
          <span style={styles.cardLabel}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <SummaryCards />
      <PrepTimeline />
      <h2 style={styles.subheading}>All Action Items</h2>
      <ActionItemChecklist />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  subheading: { margin: '0 0 16px', color: '#374151', fontSize: 19 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 },
  card: { borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardValue: { fontSize: 36, fontWeight: 700 },
  cardLabel: { color: '#64748b', fontSize: 14, fontWeight: 500 },
}
