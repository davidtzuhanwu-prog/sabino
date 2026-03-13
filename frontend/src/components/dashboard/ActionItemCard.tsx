import type { ActionItem } from '../../types'

interface Props {
  item: ActionItem
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export default function ActionItemCard({ item, onToggle, onDelete }: Props) {
  const eventDays = daysUntil(item.event_date)
  const prepDays = daysUntil(item.prep_start_date)

  const urgencyColor = eventDays !== null
    ? eventDays <= 3 ? '#fee2e2' : eventDays <= 7 ? '#fef9c3' : '#f0fdf4'
    : '#f8fafc'

  return (
    <div style={{ ...styles.card, ...(item.completed ? styles.completedCard : {}), background: item.completed ? '#f8fafc' : urgencyColor }}>
      <div style={styles.topRow}>
        <input
          type="checkbox"
          checked={item.completed}
          onChange={e => onToggle(item.id, e.target.checked)}
          style={styles.checkbox}
        />
        <div style={styles.content}>
          <span style={{ ...styles.title, ...(item.completed ? styles.strikethrough : {}) }}>
            {item.title}
          </span>

          <div style={styles.pills}>
            {item.event_date && (
              <span style={styles.datePill}>
                📅 {formatDate(item.event_date)}
                {eventDays !== null && eventDays >= 0 && (
                  <span style={styles.daysAway}> ({eventDays}d)</span>
                )}
              </span>
            )}
            {item.prep_start_date && !item.completed && (
              <span style={{ ...styles.prepPill, ...(prepDays !== null && prepDays <= 0 ? styles.prepOverdue : {}) }}>
                🗓 Start prep: {formatDate(item.prep_start_date)}
                {prepDays !== null && prepDays <= 0 && <span> (overdue!)</span>}
              </span>
            )}
            {item.is_short_notice && (
              <span style={styles.shortNoticePill}>⚠️ Short notice</span>
            )}
            <span style={styles.sourcePill}>{item.source_type}</span>
          </div>

          {item.description && !item.completed && (
            <p style={styles.description}>{item.description}</p>
          )}

          {item.is_short_notice && item.short_notice_note && (
            <p style={styles.shortNoticeNote}>⚠️ {item.short_notice_note}</p>
          )}
        </div>
        <button style={styles.deleteBtn} onClick={() => onDelete(item.id)} title="Delete">✕</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px',
    marginBottom: 12, transition: 'all 0.2s',
  },
  completedCard: { opacity: 0.6 },
  topRow: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  checkbox: { marginTop: 4, width: 18, height: 18, cursor: 'pointer', accentColor: '#3b82f6' },
  content: { flex: 1 },
  title: { fontWeight: 600, fontSize: 16, color: '#1e2a3a', display: 'block', marginBottom: 8 },
  strikethrough: { textDecoration: 'line-through', color: '#94a3b8' },
  pills: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  datePill: { background: '#dbeafe', color: '#1d4ed8', borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 500 },
  daysAway: { color: '#1d4ed8' },
  prepPill: { background: '#d1fae5', color: '#065f46', borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 500 },
  prepOverdue: { background: '#fee2e2', color: '#991b1b' },
  shortNoticePill: { background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 600 },
  sourcePill: { background: '#f1f5f9', color: '#64748b', borderRadius: 6, padding: '3px 10px', fontSize: 12 },
  description: { color: '#475569', fontSize: 14, margin: '4px 0 0', lineHeight: 1.5 },
  shortNoticeNote: { color: '#b45309', fontSize: 13, margin: '6px 0 0', fontStyle: 'italic' },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#cbd5e1',
    cursor: 'pointer', fontSize: 16, padding: '0 4px',
    ':hover': { color: '#ef4444' },
  },
}
