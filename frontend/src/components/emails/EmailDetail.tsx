import type { Email, EmailKeyPoints } from '../../types'
import ActionItemCard from '../dashboard/ActionItemCard'

interface Props {
  email: Email
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
}

function parseKeyPoints(raw: string | null): EmailKeyPoints | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as EmailKeyPoints
  } catch {
    return null
  }
}

function KeyPointsCard({ kp, receivedAt }: { kp: EmailKeyPoints; receivedAt: string | null }) {
  const hasDates = kp.dates.length > 0
  const hasReqs = kp.requirements.length > 0

  const notifiedDate = receivedAt
    ? new Date(receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div style={kpStyles.card}>
      <div style={kpStyles.cardHeader}>
        <span style={kpStyles.sparkle}>✦</span>
        <span style={kpStyles.cardTitle}>AI Summary</span>
        {notifiedDate && (
          <span style={kpStyles.notifiedBadge}>📬 Notified {notifiedDate}</span>
        )}
      </div>

      {kp.summary && (
        <p style={kpStyles.summary}>{kp.summary}</p>
      )}

      <div style={kpStyles.grid}>
        {hasDates && (
          <div style={kpStyles.block}>
            <div style={kpStyles.blockLabel}>📅 Key Dates</div>
            <ul style={kpStyles.list}>
              {kp.dates.map((d, i) => (
                <li key={i} style={kpStyles.listItem}>
                  <span style={kpStyles.dateLabel}>{d.label}</span>
                  {d.date && <span style={kpStyles.dateValue}>{d.date}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasReqs && (
          <div style={kpStyles.block}>
            <div style={kpStyles.blockLabel}>✅ What You Need to Do</div>
            <ul style={kpStyles.list}>
              {kp.requirements.map((r, i) => (
                <li key={i} style={kpStyles.reqItem}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!hasDates && !hasReqs && !kp.summary && (
        <p style={kpStyles.empty}>No key points found in this email.</p>
      )}
    </div>
  )
}

export default function EmailDetail({ email, onToggle, onDelete }: Props) {
  const keyPoints = parseKeyPoints(email.key_points)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.subject}>{email.subject || '(no subject)'}</h2>
        <div style={styles.meta}>
          <span>From: <strong>{email.sender}</strong></span>
          {email.received_at && (
            <span>
              {new Date(email.received_at).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

      {keyPoints && (
        <section style={styles.section}>
          <KeyPointsCard kp={keyPoints} receivedAt={email.received_at} />
        </section>
      )}

      {email.action_items.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Action Items ({email.action_items.length})</h3>
          {email.action_items.map(item => (
            <ActionItemCard key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </section>
      )}

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Email Body</h3>
        <pre style={styles.body}>{email.body_plain || '(empty)'}</pre>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '20px 24px' },
  header: { marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' },
  subject: { margin: '0 0 10px', color: '#1e2a3a', fontSize: 20 },
  meta: { display: 'flex', gap: 24, color: '#64748b', fontSize: 14 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#374151', fontSize: 15, margin: '0 0 14px' },
  body: {
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: 16, fontSize: 13, lineHeight: 1.6, color: '#475569',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
  },
}

const kpStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'linear-gradient(135deg, #f0f7ff 0%, #faf5ff 100%)',
    border: '1px solid #c7d9f5',
    borderRadius: 12,
    padding: '16px 20px',
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  sparkle: { fontSize: 14, color: '#6366f1' },
  cardTitle: { fontWeight: 600, fontSize: 14, color: '#4338ca', letterSpacing: '0.02em' },
  notifiedBadge: {
    marginLeft: 'auto', fontSize: 11, color: '#64748b',
    background: '#e2e8f0', borderRadius: 20, padding: '2px 8px', fontWeight: 500,
  },
  summary: {
    margin: '0 0 14px', fontSize: 14, lineHeight: 1.65, color: '#1e293b',
  },
  grid: { display: 'flex', gap: 20, flexWrap: 'wrap' as const },
  block: { flex: '1 1 220px', minWidth: 0 },
  blockLabel: {
    fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', marginBottom: 8,
  },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  listItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    gap: 8, fontSize: 13, color: '#334155', padding: '4px 0',
    borderBottom: '1px dashed #dde5f0',
  },
  dateLabel: { fontWeight: 500 },
  dateValue: { color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap' as const, fontSize: 12 },
  reqItem: {
    fontSize: 13, color: '#334155', padding: '5px 0 5px 16px',
    borderBottom: '1px dashed #dde5f0', position: 'relative' as const,
    lineHeight: 1.5,
  },
  empty: { fontSize: 13, color: '#94a3b8', margin: 0 },
}
