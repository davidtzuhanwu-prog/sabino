import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Email, EmailKeyPoints } from '../../types'
import ActionItemCard from '../dashboard/ActionItemCard'

// ── Markdown pre-processing ───────────────────────────────────────────────────
// body_plain comes from html2text which converts HTML → Markdown.
// We clean up common artefacts before rendering:
//   1. Decode HTML entities (&nbsp; → space, &amp; → &, etc.)
//   2. Strip MSO/VML conditional comments that html2text may leave as raw text
//   3. Collapse excessive blank lines (>2 in a row → 2)
//   4. Trim leading/trailing whitespace
function cleanMarkdown(raw: string): string {
  return raw
    // MSO/VML conditional blocks left as text artifacts
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    // HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse 3+ blank lines into 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
        {email.body_plain ? (
          <div style={styles.body}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {cleanMarkdown(email.body_plain)}
            </ReactMarkdown>
          </div>
        ) : (
          <p style={styles.emptyBody}>(empty)</p>
        )}
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
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '16px 20px',
    fontSize: 14,
    lineHeight: 1.7,
    color: '#374151',
    wordBreak: 'break-word',
  },
  emptyBody: { color: '#94a3b8', fontSize: 13, margin: 0 },
}

// ── Markdown component overrides — scoped email-body styles ───────────────────
const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => (
    <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600, color: '#1e2a3a' }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: 'italic', color: '#475569' }}>{children}</em>
  ),
  h1: ({ children }) => (
    <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1e2a3a', margin: '16px 0 8px', lineHeight: 1.3 }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e2a3a', margin: '14px 0 6px' }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '12px 0 4px' }}>{children}</h3>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: '4px 0 12px', paddingLeft: 22 }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: '4px 0 12px', paddingLeft: 22 }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: 4, lineHeight: 1.6 }}>{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: '#2563eb', textDecoration: 'underline', wordBreak: 'break-all' }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      margin: '8px 0',
      padding: '8px 14px',
      borderLeft: '3px solid #cbd5e1',
      background: '#f1f5f9',
      borderRadius: '0 6px 6px 0',
      color: '#64748b',
    }}>
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '16px 0' }} />
  ),
  code: ({ children }) => (
    <code style={{
      background: '#e2e8f0', borderRadius: 4,
      padding: '1px 5px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
    }}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre style={{
      background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
      padding: '10px 14px', fontSize: 12, lineHeight: 1.6, overflow: 'auto',
      fontFamily: 'ui-monospace, monospace',
    }}>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: '6px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', fontWeight: 600, textAlign: 'left' }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0' }}>{children}</td>
  ),
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
