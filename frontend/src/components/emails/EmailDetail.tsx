import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Email, EmailKeyPoints, PSAttachments, PDFAnalysis, PDFEntry } from '../../types'
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
  try { return JSON.parse(raw) as EmailKeyPoints } catch { return null }
}

function parsePSAttachments(raw: string | null): PSAttachments | null {
  if (!raw) return null
  try { return JSON.parse(raw) as PSAttachments } catch { return null }
}

// ── ParentSquare photo gallery ────────────────────────────────────────────────

function PSGallery({ ps, emailId, onPdfLoaded }: { ps: PSAttachments; emailId: number; onPdfLoaded?: () => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [pdfStatus, setPdfStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({})
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({})
  const thumbs = ps.thumbnail_urls ?? []
  const pendingPdfs = (ps.pdf_filenames ?? []).filter(
    fn => !(ps.pdf_analyses ?? []).some(a => a.filename === fn)
  )
  const autoTriggered = useRef(false)

  // Auto-fetch pending PDFs on mount (no button click required)
  useEffect(() => {
    if (autoTriggered.current || pendingPdfs.length === 0 || !ps.feed_url) return
    autoTriggered.current = true
    for (const fn of pendingPdfs) {
      fetchOnePdf(fn, ps.feed_url)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchOnePdf(filename: string, _feedUrl: string) {
    setPdfStatus(s => ({ ...s, [filename]: 'loading' }))
    try {
      // Ask the backend to fetch + analyze the PDF using the stored PS session cookie
      const apiResp = await fetch('http://localhost:8000/api/ps-pdf/proxy-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          feed_url: ps.feed_url,
          feed_id: ps.feed_id,
          email_id: emailId,
        }),
      })
      const result = await apiResp.json()
      if (!apiResp.ok || !result.ok) {
        throw new Error(result.error || `Backend ${apiResp.status}`)
      }
      setPdfStatus(s => ({ ...s, [filename]: 'done' }))
      onPdfLoaded?.()
    } catch (e: any) {
      const msg = e?.message || 'Unknown error'
      setPdfErrors(s => ({ ...s, [filename]: msg }))
      setPdfStatus(s => ({ ...s, [filename]: 'error' }))
    }
  }

  if (thumbs.length === 0 && !ps.error && pendingPdfs.length === 0) return null

  return (
    <div style={galleryStyles.card}>
      {/* Header */}
      <div style={galleryStyles.header}>
        <span style={galleryStyles.psLogo}>PS</span>
        <div>
          <div style={galleryStyles.title}>ParentSquare Attachments</div>
          <div style={galleryStyles.subtitle}>
            {ps.attachment_count} attachment{ps.attachment_count !== 1 ? 's' : ''} on this post
            {ps.error && <span style={galleryStyles.errorNote}> · fetch error, showing partial results</span>}
          </div>
        </div>
        <a
          href={ps.feed_url}
          target="_blank"
          rel="noopener noreferrer"
          style={galleryStyles.openBtn}
        >
          Open in ParentSquare ↗
        </a>
      </div>

      {/* Pending PDF documents */}
      {pendingPdfs.length > 0 && (
        <div style={galleryStyles.pdfRow}>
          {pendingPdfs.map(fn => {
            const status = pdfStatus[fn] ?? 'idle'
            return (
              <button
                key={fn}
                style={{
                  ...galleryStyles.pdfBtn,
                  opacity: status === 'loading' ? 0.6 : 1,
                  background: status === 'error' ? '#fee2e2' : status === 'done' ? '#dcfce7' : '#ede9fe',
                  color: status === 'error' ? '#991b1b' : status === 'done' ? '#166534' : '#5b21b6',
                  border: `1px solid ${status === 'error' ? '#fca5a5' : status === 'done' ? '#86efac' : '#c4b5fd'}`,
                  cursor: status === 'loading' || status === 'done' ? 'default' : 'pointer',
                }}
                disabled={status === 'loading' || status === 'done'}
                onClick={() => fetchOnePdf(fn, ps.feed_url)}
                title={status === 'error' ? (pdfErrors[fn] || 'Click to retry') : status === 'loading' ? 'Analyzing…' : status === 'done' ? 'Analysis complete' : 'Auto-analyzing…'}
              >
                {status === 'loading' ? '⏳' : status === 'done' ? '✓' : status === 'error' ? '✗' : '⏳'} {fn.replace(/^_\s*/, '')}
                {status === 'error' && pdfErrors[fn] && (
                  <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.8 }}>
                    {pdfErrors[fn].includes('session cookie') ? '→ Add PS cookie in Settings' : pdfErrors[fn]}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Post text (if any) */}
      {ps.post_text && (
        <p style={galleryStyles.postText}>{ps.post_text}</p>
      )}

      {/* Photo grid */}
      {thumbs.length > 0 && (
        <div style={galleryStyles.grid}>
          {thumbs.map((url, i) => (
            <button
              key={i}
              style={galleryStyles.thumb}
              onClick={() => setLightbox(url)}
              title={`Photo ${i + 1}`}
            >
              <img
                src={url}
                alt={`Attachment ${i + 1}`}
                style={galleryStyles.thumbImg}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Simple lightbox */}
      {lightbox && (
        <div style={galleryStyles.lightboxBackdrop} onClick={() => setLightbox(null)}>
          <div style={galleryStyles.lightboxContent} onClick={e => e.stopPropagation()}>
            <button style={galleryStyles.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
            <img src={lightbox} alt="Full size" style={galleryStyles.lightboxImg} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── PDF Newsletter Analysis ───────────────────────────────────────────────────

// Subject → background/text color pair
const SUBJECT_COLORS: Record<string, [string, string]> = {
  'Literacy':  ['#fef9c3', '#92400e'],
  'Phonics':   ['#fce7f3', '#9d174d'],
  'Spelling':  ['#ede9fe', '#5b21b6'],
  'Math':      ['#dcfce7', '#166534'],
  'Science':   ['#e0f2fe', '#075985'],
  'Social Studies': ['#fff7ed', '#9a3412'],
  'Art':       ['#fdf4ff', '#7e22ce'],
  'Music':     ['#fff1f2', '#9f1239'],
  'PE':        ['#f0fdf4', '#15803d'],
  'SEL':       ['#fef3c7', '#92400e'],
  'SEL (Social Emotional Learning)': ['#fef3c7', '#92400e'],
}
function subjectColor(subject: string): [string, string] {
  for (const [key, val] of Object.entries(SUBJECT_COLORS)) {
    if (subject.toLowerCase().includes(key.toLowerCase())) return val
  }
  return ['#f8fafc', '#334155']
}

function PDFNewsletter({ entries }: { entries: PDFEntry[] }) {
  const [openSubject, setOpenSubject] = useState<string | null>(null)
  const pdfs = entries.filter(e => e.analysis)
  if (pdfs.length === 0) return null

  return (
    <div style={pdfStyles.wrapper}>
      {pdfs.map((entry) => {
        const a = entry.analysis as PDFAnalysis
        return (
          <div key={entry.filename} style={pdfStyles.card}>
            {/* Header */}
            <div style={pdfStyles.header}>
              <span style={pdfStyles.pdfIcon}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={pdfStyles.title}>{a.title}</div>
                {a.week_of && <div style={pdfStyles.weekOf}>{a.week_of}</div>}
              </div>
              <span style={pdfStyles.fileBadge}>{entry.filename.replace(/^_\s*/, '')}</span>
            </div>

            {/* Summary */}
            <p style={pdfStyles.summary}>{a.summary}</p>

            {/* Spelling words — always shown prominently */}
            {(() => {
              const spelling = a.learning_areas.find(la => la.subject.toLowerCase().includes('spelling'))
              if (!spelling) return null
              // Extract word pairs from what_we_learned
              const wordPairs = spelling.what_we_learned.match(/\w+\/\w+|\w+ - \w+/g) ?? []
              return (
                <div style={pdfStyles.spellingBox}>
                  <div style={pdfStyles.spellingTitle}>📝 Spelling Test Words (Week {a.week_of ?? ''})</div>
                  {wordPairs.length > 0 ? (
                    <div style={pdfStyles.spellingGrid}>
                      {wordPairs.map((pair, i) => (
                        <span key={i} style={pdfStyles.spellingPair}>{pair}</span>
                      ))}
                    </div>
                  ) : (
                    <p style={pdfStyles.spellingDesc}>{spelling.what_we_learned}</p>
                  )}
                </div>
              )
            })()}

            {/* Learning areas */}
            {a.learning_areas.length > 0 && (
              <div style={pdfStyles.subjectsSection}>
                <div style={pdfStyles.sectionLabel}>This Week's Learning</div>
                <div style={pdfStyles.subjectsGrid}>
                  {a.learning_areas
                    .filter(la => !la.subject.toLowerCase().includes('spelling'))
                    .map((la) => {
                      const [bg, fg] = subjectColor(la.subject)
                      const isOpen = openSubject === la.subject
                      return (
                        <button
                          key={la.subject}
                          style={{ ...pdfStyles.subjectChip, background: bg, color: fg, border: `1px solid ${fg}22` }}
                          onClick={() => setOpenSubject(isOpen ? null : la.subject)}
                        >
                          {la.subject}
                          {(la.coming_up) && <span style={pdfStyles.comingUpDot} title="Coming up next week">•</span>}
                        </button>
                      )
                    })}
                </div>
                {openSubject && (() => {
                  const la = a.learning_areas.find(l => l.subject === openSubject)
                  if (!la) return null
                  const [bg, fg] = subjectColor(la.subject)
                  return (
                    <div style={{ ...pdfStyles.subjectDetail, borderLeft: `3px solid ${fg}` }}>
                      <div style={{ ...pdfStyles.subjectDetailTitle, color: fg }}>{la.subject}</div>
                      <p style={pdfStyles.subjectDetailText}>{la.what_we_learned}</p>
                      {la.coming_up && (
                        <p style={pdfStyles.subjectComingUp}>
                          <strong>Coming up:</strong> {la.coming_up}
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Upcoming events */}
            {a.upcoming_events.length > 0 && (
              <div style={pdfStyles.eventsSection}>
                <div style={pdfStyles.sectionLabel}>Upcoming Dates</div>
                <div style={pdfStyles.eventsList}>
                  {a.upcoming_events.map((ev, i) => (
                    <div key={i} style={pdfStyles.eventRow}>
                      <span style={pdfStyles.eventDate}>{ev.date ?? '—'}</span>
                      <span style={pdfStyles.eventLabel}>{ev.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reminders */}
            {a.reminders.length > 0 && (
              <div style={pdfStyles.remindersSection}>
                <div style={pdfStyles.sectionLabel}>Parent Reminders</div>
                <ul style={pdfStyles.remindersList}>
                  {a.reminders.map((r, i) => (
                    <li key={i} style={pdfStyles.reminderItem}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const pdfStyles: Record<string, React.CSSProperties> = {
  wrapper: { marginBottom: 4 },
  card: {
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 12,
    padding: '16px 18px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  pdfIcon: { fontSize: 22, lineHeight: 1, flexShrink: 0 },
  title: { fontWeight: 700, fontSize: 15, color: '#1c1917', lineHeight: 1.3 },
  weekOf: { fontSize: 12, color: '#78716c', marginTop: 2 },
  fileBadge: {
    fontSize: 10,
    color: '#92400e',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: 4,
    padding: '2px 6px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  summary: {
    fontSize: 13,
    color: '#44403c',
    lineHeight: 1.65,
    margin: '0 0 14px',
  },
  spellingBox: {
    background: '#ede9fe',
    border: '1px solid #c4b5fd',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 14,
  },
  spellingTitle: {
    fontWeight: 600,
    fontSize: 13,
    color: '#5b21b6',
    marginBottom: 8,
  },
  spellingGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px 12px',
  },
  spellingPair: {
    fontSize: 13,
    color: '#3730a3',
    fontFamily: 'monospace',
    background: '#fff',
    borderRadius: 4,
    padding: '2px 8px',
    border: '1px solid #c4b5fd',
  },
  spellingDesc: {
    fontSize: 13,
    color: '#3730a3',
    margin: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#78716c',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 8,
  },
  subjectsSection: { marginBottom: 14 },
  subjectsGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 8,
  },
  subjectChip: {
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 20,
    padding: '4px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    transition: 'opacity 0.1s',
  },
  comingUpDot: {
    fontSize: 16,
    lineHeight: 1,
    opacity: 0.6,
  },
  subjectDetail: {
    background: '#fff',
    borderRadius: 8,
    padding: '10px 14px',
    marginTop: 4,
  },
  subjectDetailTitle: { fontWeight: 700, fontSize: 13, marginBottom: 4 },
  subjectDetailText: { fontSize: 13, color: '#374151', margin: '0 0 6px', lineHeight: 1.6 },
  subjectComingUp: { fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 },
  eventsSection: { marginBottom: 14 },
  eventsList: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  eventRow: { display: 'flex', alignItems: 'baseline', gap: 10 },
  eventDate: {
    fontSize: 12,
    fontWeight: 700,
    color: '#b45309',
    minWidth: 90,
    flexShrink: 0,
  },
  eventLabel: { fontSize: 13, color: '#1c1917' },
  remindersSection: { marginBottom: 0 },
  remindersList: { margin: 0, paddingLeft: 18 },
  reminderItem: { fontSize: 12, color: '#44403c', marginBottom: 4, lineHeight: 1.5 },
}

const galleryStyles: Record<string, React.CSSProperties> = {
  card: {
    background: '#f0f7ff',
    border: '1px solid #bfdbfe',
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 4,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  psLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: '#2563eb',
    color: '#fff',
    fontWeight: 800,
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    letterSpacing: '-0.5px',
  },
  title: {
    fontWeight: 600,
    fontSize: 14,
    color: '#1e40af',
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 12,
    color: '#3b82f6',
    marginTop: 2,
  },
  errorNote: {
    color: '#f87171',
  },
  openBtn: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#2563eb',
    textDecoration: 'none',
    background: '#dbeafe',
    border: '1px solid #bfdbfe',
    borderRadius: 6,
    padding: '4px 10px',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  pdfRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 12,
  },
  pdfBtn: {
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    padding: '5px 10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    transition: 'opacity 0.15s',
  },
  postText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.6,
    margin: '0 0 12px',
    background: '#fff',
    borderRadius: 6,
    padding: '8px 12px',
    border: '1px solid #dbeafe',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
    gap: 6,
  },
  thumb: {
    border: 'none',
    padding: 0,
    borderRadius: 6,
    overflow: 'hidden',
    cursor: 'pointer',
    aspectRatio: '1',
    background: '#e0e7ff',
    display: 'block',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    transition: 'opacity 0.15s',
  },
  // Lightbox
  lightboxBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxContent: {
    position: 'relative' as const,
    maxWidth: '90vw',
    maxHeight: '90vh',
  },
  lightboxClose: {
    position: 'absolute' as const,
    top: -14,
    right: -14,
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
    color: '#1e2a3a',
    zIndex: 1001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  lightboxImg: {
    maxWidth: '90vw',
    maxHeight: '90vh',
    borderRadius: 8,
    objectFit: 'contain' as const,
    display: 'block',
  },
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
  const [psRaw, setPsRaw] = useState(email.ps_attachments)
  const psAttachments = parsePSAttachments(psRaw)

  // Reload ps_attachments from backend after a PDF is loaded
  async function refreshPsAttachments() {
    try {
      const resp = await fetch(`/api/emails/${email.id}`)
      if (resp.ok) {
        const data = await resp.json()
        setPsRaw(data.ps_attachments)
      }
    } catch { /* ignore */ }
  }

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

      {psAttachments?.pdf_analyses && psAttachments.pdf_analyses.length > 0 && (
        <section style={styles.section}>
          <PDFNewsletter entries={psAttachments.pdf_analyses} />
        </section>
      )}

      {psAttachments && (
        <section style={styles.section}>
          <PSGallery ps={psAttachments} emailId={email.id} onPdfLoaded={refreshPsAttachments} />
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
