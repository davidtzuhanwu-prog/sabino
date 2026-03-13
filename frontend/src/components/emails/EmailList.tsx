import type { Email } from '../../types'

interface Props {
  emails: Email[]
  selectedId: number | null
  onSelect: (id: number) => void
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function EmailList({ emails, selectedId, onSelect }: Props) {
  if (emails.length === 0) {
    return (
      <div style={styles.empty}>
        <p>No emails fetched yet.</p>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Go to Settings → Scan Now to fetch school emails.</p>
      </div>
    )
  }

  return (
    <ul style={styles.list}>
      {emails.map(email => (
        <li
          key={email.id}
          style={{ ...styles.item, ...(selectedId === email.id ? styles.selected : {}) }}
          onClick={() => onSelect(email.id)}
        >
          <div style={styles.subject}>{email.subject || '(no subject)'}</div>
          <div style={styles.meta}>
            <span style={styles.sender}>{email.sender || 'Unknown'}</span>
            <span style={styles.date}>{formatDate(email.received_at)}</span>
          </div>
          <div style={styles.badges}>
            {email.analyzed && <span style={styles.analyzedBadge}>✓ Analyzed</span>}
            {email.action_items.length > 0 && (
              <span style={styles.itemsBadge}>{email.action_items.length} action{email.action_items.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

const styles: Record<string, React.CSSProperties> = {
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: {
    padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
    transition: 'background 0.1s',
  },
  selected: { background: '#eff6ff' },
  empty: { padding: '40px 16px', textAlign: 'center', color: '#475569' },
  subject: { fontWeight: 600, fontSize: 14, color: '#1e2a3a', marginBottom: 4 },
  meta: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  sender: { color: '#64748b', fontSize: 12 },
  date: { color: '#94a3b8', fontSize: 12 },
  badges: { display: 'flex', gap: 6 },
  analyzedBadge: { background: '#d1fae5', color: '#065f46', borderRadius: 4, padding: '2px 7px', fontSize: 11 },
  itemsBadge: { background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '2px 7px', fontSize: 11 },
}
