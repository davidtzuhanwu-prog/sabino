import { useEffect, useState } from 'react'
import api from '../api/client'
import type { Email, PDFAnalysis, PDFEntry } from '../types'

// ── Data helpers ──────────────────────────────────────────────────────────────

interface SpellingWeek {
  emailId: number
  filename: string
  weekOf: string | null
  title: string
  words: string[]          // raw "word/word" or "word - word" pairs
  rawText: string          // full what_we_learned text as fallback
  receivedAt: string | null
}

interface PoemAssignment {
  emailId: number
  title: string
  text: string             // what_we_learned or coming_up about the poem
  dueDate: string | null
  weekOf: string | null
  receivedAt: string | null
}

interface SpecialHomework {
  id: number
  title: string
  description: string | null
  eventDate: string | null
  sourceType: string
  completed: boolean
}

function extractSpellingWeeks(emails: Email[]): SpellingWeek[] {
  const weeks: SpellingWeek[] = []
  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      const a = entry.analysis as PDFAnalysis
      const spelling = a.learning_areas.find(la =>
        la.subject.toLowerCase().includes('spelling')
      )
      if (!spelling) continue
      // Extract word/word pairs
      const raw = spelling.what_we_learned
      const pairs = raw.match(/\b\w+\/\w+\b|\b\w+ - \w+\b/g) ?? []
      weeks.push({
        emailId: email.id,
        filename: entry.filename,
        weekOf: a.week_of,
        title: a.title,
        words: pairs,
        rawText: raw,
        receivedAt: email.received_at,
      })
    }
  }
  // Sort newest first
  return weeks.sort((a, b) =>
    (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')
  )
}

function extractPoems(emails: Email[]): PoemAssignment[] {
  const poems: PoemAssignment[] = []
  const poemKeywords = ['poem', 'recit', 'memoriz', 'verse', 'rhyme', 'chant']

  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      const a = entry.analysis as PDFAnalysis
      // Check learning areas
      for (const la of a.learning_areas) {
        const text = (la.what_we_learned + ' ' + (la.coming_up ?? '')).toLowerCase()
        if (poemKeywords.some(kw => text.includes(kw))) {
          poems.push({
            emailId: email.id,
            title: a.title,
            text: la.what_we_learned + (la.coming_up ? '\n' + la.coming_up : ''),
            dueDate: null,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
        }
      }
      // Check upcoming_events for poem/recitation dates
      for (const ev of a.upcoming_events) {
        const label = ev.label.toLowerCase()
        if (poemKeywords.some(kw => label.includes(kw))) {
          poems.push({
            emailId: email.id,
            title: ev.label,
            text: `Due: ${ev.date ?? 'see newsletter'}`,
            dueDate: ev.date,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
        }
      }
      // Check reminders
      for (const r of a.reminders) {
        if (poemKeywords.some(kw => r.toLowerCase().includes(kw))) {
          poems.push({
            emailId: email.id,
            title: a.title,
            text: r,
            dueDate: null,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
        }
      }
    }
  }
  return poems.sort((a, b) =>
    (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')
  )
}

const SPECIAL_KEYWORDS = [
  'spring gala', 'science fair', 'performance', 'song', 'practice', 'rehearse',
  'script', 'costume', 'poem', 'recit', 'memoriz', 'contest', 'showcase',
  'presentation', 'project', 'pi day',
]

function isSpecialHomework(title: string, desc: string | null): boolean {
  const text = (title + ' ' + (desc ?? '')).toLowerCase()
  return SPECIAL_KEYWORDS.some(kw => text.includes(kw))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={sectionStyles.header}>
      <span style={sectionStyles.title}>{label}</span>
      {count > 0 && <span style={sectionStyles.badge}>{count}</span>}
    </div>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return <p style={sectionStyles.empty}>{msg}</p>
}

// ── Spelling Section ──────────────────────────────────────────────────────────

function SpellingSection({ weeks }: { weeks: SpellingWeek[] }) {
  const [expanded, setExpanded] = useState<string | null>(
    weeks.length > 0 ? `${weeks[0].emailId}-${weeks[0].filename}` : null
  )

  return (
    <section style={sectionStyles.section}>
      <SectionHeader label="📝 Spelling Test" count={weeks.length} />
      <p style={sectionStyles.desc}>
        Weekly homophone pairs from the class newsletter. Test is each Friday.
      </p>
      {weeks.length === 0 && (
        <EmptyState msg="No spelling words found yet — newsletter PDFs will populate this." />
      )}
      {weeks.map((w) => {
        const key = `${w.emailId}-${w.filename}`
        const isOpen = expanded === key
        const isLatest = weeks[0] === w
        return (
          <div key={key} style={{ ...spellingStyles.card, ...(isLatest ? spellingStyles.latestCard : {}) }}>
            <button
              style={spellingStyles.cardHeader}
              onClick={() => setExpanded(isOpen ? null : key)}
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={spellingStyles.weekLabel}>
                  {isLatest && <span style={spellingStyles.latestBadge}>Current</span>}
                  {w.weekOf ?? w.title}
                </span>
                {!isOpen && w.words.length > 0 && (
                  <span style={spellingStyles.preview}>
                    {w.words.slice(0, 3).join('  ·  ')}{w.words.length > 3 ? ` +${w.words.length - 3}` : ''}
                  </span>
                )}
              </div>
              <span style={spellingStyles.chevron}>{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div style={spellingStyles.body}>
                {w.words.length > 0 ? (
                  <div style={spellingStyles.wordGrid}>
                    {w.words.map((pair, i) => (
                      <span key={i} style={spellingStyles.wordPair}>{pair}</span>
                    ))}
                  </div>
                ) : (
                  <p style={spellingStyles.rawText}>{w.rawText}</p>
                )}
                <div style={spellingStyles.source}>
                  From: {w.filename.replace(/^_\s*/, '')}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Poem Section ─────────────────────────────────────────────────────────────

function PoemSection({ poems }: { poems: PoemAssignment[] }) {
  return (
    <section style={sectionStyles.section}>
      <SectionHeader label="🎤 Poem / Recitation" count={poems.length} />
      <p style={sectionStyles.desc}>
        Monthly poems to memorize and recite. Check the newsletter for due dates.
      </p>
      {poems.length === 0 && (
        <EmptyState msg="No poem assignments found yet — they'll appear here when detected in newsletters." />
      )}
      {poems.map((p, i) => (
        <div key={i} style={poemStyles.card}>
          <div style={poemStyles.header}>
            <span style={poemStyles.icon}>🎤</span>
            <div style={{ flex: 1 }}>
              <div style={poemStyles.title}>{p.title}</div>
              {p.weekOf && <div style={poemStyles.week}>{p.weekOf}</div>}
            </div>
            {p.dueDate && (
              <span style={poemStyles.dueBadge}>Due: {p.dueDate}</span>
            )}
          </div>
          <p style={poemStyles.text}>{p.text}</p>
        </div>
      ))}
    </section>
  )
}

// ── Special Homework Section ──────────────────────────────────────────────────

function SpecialSection({ items }: { items: SpecialHomework[] }) {
  const upcoming = items.filter(i => !i.completed && i.eventDate && new Date(i.eventDate) >= new Date())
  const past = items.filter(i => i.completed || (i.eventDate && new Date(i.eventDate) < new Date()))

  return (
    <section style={sectionStyles.section}>
      <SectionHeader label="⭐ Special Homework & Projects" count={upcoming.length} />
      <p style={sectionStyles.desc}>
        One-off or seasonal assignments: performances, projects, presentations, contests.
      </p>
      {items.length === 0 && (
        <EmptyState msg="No special homework found." />
      )}
      {upcoming.length > 0 && (
        <>
          <div style={specialStyles.groupLabel}>Upcoming</div>
          {upcoming.map(item => <SpecialCard key={item.id} item={item} />)}
        </>
      )}
      {past.length > 0 && (
        <>
          <div style={{ ...specialStyles.groupLabel, color: '#94a3b8', marginTop: 16 }}>Past</div>
          {past.slice(0, 5).map(item => <SpecialCard key={item.id} item={item} faded />)}
        </>
      )}
    </section>
  )
}

function SpecialCard({ item, faded }: { item: SpecialHomework; faded?: boolean }) {
  const [open, setOpen] = useState(false)
  const dateStr = item.eventDate
    ? new Date(item.eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div style={{ ...specialStyles.card, opacity: faded ? 0.55 : 1 }}>
      <button style={specialStyles.row} onClick={() => setOpen(o => !o)}>
        <span style={specialStyles.icon}>{item.completed ? '✓' : '📌'}</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <span style={{ ...specialStyles.title, textDecoration: item.completed ? 'line-through' : 'none' }}>
            {item.title}
          </span>
        </div>
        {dateStr && <span style={specialStyles.date}>{dateStr}</span>}
        <span style={specialStyles.chevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && item.description && (
        <p style={specialStyles.desc}>{item.description}</p>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomeworkPage() {
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Email[]>('/api/emails', { params: { limit: 200 } })
      .then(r => setEmails(r.data))
      .finally(() => setLoading(false))
  }, [])

  const spellingWeeks = extractSpellingWeeks(emails)
  const poems = extractPoems(emails)

  // Pull special homework from action items embedded in emails
  const specialItems: SpecialHomework[] = []
  const seen = new Set<string>()
  for (const email of emails) {
    for (const item of email.action_items) {
      if (!isSpecialHomework(item.title, item.description)) continue
      const key = item.title.toLowerCase().trim()
      if (seen.has(key)) continue
      seen.add(key)
      specialItems.push({
        id: item.id,
        title: item.title,
        description: item.description,
        eventDate: item.event_date,
        sourceType: item.source_type,
        completed: item.completed,
      })
    }
  }
  specialItems.sort((a, b) => {
    if (!a.eventDate && !b.eventDate) return 0
    if (!a.eventDate) return 1
    if (!b.eventDate) return -1
    return a.eventDate.localeCompare(b.eventDate)
  })

  return (
    <div style={pageStyles.container}>
      <div style={pageStyles.headerRow}>
        <h1 style={pageStyles.title}>📚 Homework</h1>
        <p style={pageStyles.subtitle}>
          Spelling tests, poems to memorize, and special projects — all in one place.
        </p>
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8', padding: 20 }}>Loading...</p>
      ) : (
        <div style={pageStyles.grid}>
          <SpellingSection weeks={spellingWeeks} />
          <PoemSection poems={poems} />
          <SpecialSection items={specialItems} />
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900 },
  headerRow: { marginBottom: 32 },
  title: { margin: '0 0 6px', fontSize: 24, fontWeight: 700, color: '#1e2a3a' },
  subtitle: { margin: 0, fontSize: 14, color: '#64748b' },
  grid: { display: 'flex', flexDirection: 'column', gap: 0 },
}

const sectionStyles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 40,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: '#1e2a3a',
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    background: '#dbeafe',
    color: '#1d4ed8',
    borderRadius: 20,
    padding: '1px 8px',
  },
  desc: {
    fontSize: 13,
    color: '#64748b',
    margin: '0 0 14px',
  },
  empty: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
    padding: '12px 16px',
    background: '#f8fafc',
    borderRadius: 8,
    border: '1px dashed #e2e8f0',
  },
}

const spellingStyles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    background: '#fff',
  },
  latestCard: {
    border: '1px solid #c4b5fd',
    boxShadow: '0 0 0 3px #ede9fe55',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    width: '100%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  weekLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 600,
    fontSize: 14,
    color: '#1e2a3a',
  },
  latestBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#5b21b6',
    color: '#fff',
    borderRadius: 4,
    padding: '1px 6px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  preview: {
    display: 'block',
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    fontFamily: 'ui-monospace, monospace',
  },
  chevron: { fontSize: 10, color: '#94a3b8', flexShrink: 0 },
  body: {
    padding: '0 16px 14px',
    borderTop: '1px solid #f1f5f9',
  },
  wordGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px 10px',
    paddingTop: 12,
    marginBottom: 10,
  },
  wordPair: {
    fontSize: 14,
    fontFamily: 'ui-monospace, monospace',
    background: '#ede9fe',
    color: '#3730a3',
    borderRadius: 5,
    padding: '4px 10px',
    border: '1px solid #c4b5fd',
    fontWeight: 500,
  },
  rawText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.6,
    margin: '12px 0 8px',
  },
  source: {
    fontSize: 11,
    color: '#94a3b8',
  },
}

const poemStyles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  icon: { fontSize: 18, lineHeight: 1.2, flexShrink: 0 },
  title: { fontWeight: 600, fontSize: 14, color: '#1c1917' },
  week: { fontSize: 12, color: '#78716c', marginTop: 2 },
  dueBadge: {
    fontSize: 11,
    fontWeight: 700,
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: 4,
    padding: '2px 8px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  text: {
    fontSize: 13,
    color: '#44403c',
    lineHeight: 1.65,
    margin: 0,
    whiteSpace: 'pre-line' as const,
  },
}

const specialStyles: Record<string, React.CSSProperties> = {
  groupLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
    marginBottom: 8,
  },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    transition: 'opacity 0.15s',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    width: '100%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  icon: { fontSize: 16, flexShrink: 0 },
  title: { fontWeight: 500, fontSize: 14, color: '#1e2a3a' },
  date: {
    fontSize: 12,
    color: '#b45309',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  chevron: { fontSize: 10, color: '#94a3b8', flexShrink: 0 },
  desc: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.6,
    margin: '0 16px 12px 42px',
  },
}
