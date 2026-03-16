import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

interface PendingPDF {
  emailId: number
  emailSubject: string | null
  filename: string
  receivedAt: string | null
}

function extractSpellingWeeks(emails: Email[]): SpellingWeek[] {
  // Dedup by filename — the same PDF may arrive attached to multiple emails
  // (e.g. forwarded newsletter), but it's always the same week's content.
  const seen = new Set<string>()
  const weeks: SpellingWeek[] = []
  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      if (seen.has(entry.filename)) continue   // already have this PDF
      const a = entry.analysis as PDFAnalysis
      const spelling = a.learning_areas.find(la =>
        la.subject.toLowerCase().includes('spelling')
      )
      if (!spelling) continue
      seen.add(entry.filename)
      // Extract word/word pairs, or individual words after a colon (e.g. "words: cow, now, how")
      const raw = spelling.what_we_learned
      let pairs = raw.match(/\b\w+\/\w+\b|\b\w+ - \w+\b/g) ?? []
      if (pairs.length === 0) {
        const colonIdx = raw.indexOf(':')
        if (colonIdx !== -1) {
          pairs = raw.slice(colonIdx + 1).match(/\b[a-z]{2,}\b/gi) ?? []
        }
      }
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

  // Only match the specific monthly "Poem of the Month" / "Poem Recital" assignment.
  // Must contain both "poem" AND ("recit" or "month") to avoid matching
  // Pi memorization contests, Spring Gala rehearsals, etc.
  const isPoemRecital = (text: string) => {
    const t = text.toLowerCase()
    return t.includes('poem') && (t.includes('recit') || t.includes('month') || t.includes('poem of'))
  }

  // Extract the poem's actual title from event label or reminder text.
  const extractPoemTitle = (label: string, reminder: string): string | null => {
    // "Poem Recital Test – 'Hug O'War'" → capture everything after the dash, strip wrapping quotes only
    const dashMatch = label.match(/[–—-]\s*(.+?)\s*$/)
    if (dashMatch) return dashMatch[1].replace(/^['"\u2018\u2019\u201c\u201d]+|['"\u2018\u2019\u201c\u201d]+$/g, '').trim()

    // Quoted with smart or straight quotes in label: 'The Crayon Box That Talked'
    // Use a greedy match that allows apostrophes inside the title (e.g. O'War)
    const labelQuote = label.match(/[\u2018\u2019'"]([A-Z][^\u2018\u2019"]{4,})[\u2018\u2019'"]/i)
    if (labelQuote) return labelQuote[1].trim()

    // In reminder text: capture title between quotes, allowing internal apostrophes
    // Stop at closing quote only when it's followed by whitespace, punctuation, or end
    const reminderQuote = reminder.match(/[\u2018\u2019'"]([A-Z][^'""\u201c\u201d]{3,})(?=['"\u2018\u2019\u201c\u201d](?:\s|$|[,.)by]))/i)
    if (reminderQuote) return reminderQuote[1].trim()

    // Fallback: "poem Title" unquoted
    const unquoted = reminder.match(/\bpoem\b\s+(?:of the month[,\s]*)?([A-Z][A-Za-z '\-]{3,30})(?:\s+by\b|[.,]|$)/i)
    if (unquoted) {
      const t = unquoted[1].trim()
      // Skip if we accidentally matched "Recital Test" or similar meta-phrases
      if (!/^(recital|of the|test)/i.test(t)) return t
    }

    return null
  }
  const cleanTitle = (t: string) => t.replace(/[,;:.!?]+$/, '').trim()

  for (const email of emails) {
    // Only scan newsletter PDF analyses — the monthly poem comes from the class newsletter
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      const a = entry.analysis as PDFAnalysis

      // Collect reminders for this analysis so we can pass them to extractPoemTitle
      const matchingReminders = a.reminders.filter(r => isPoemRecital(r))

      // Track whether this PDF already produced a poem entry from upcoming_events.
      // If so, skip the reminders loop — they describe the same assignment and
      // would create a redundant no-date candidate that risks a failed merge.
      let eventMatched = false

      for (const ev of a.upcoming_events) {
        if (isPoemRecital(ev.label)) {
          const bestReminder = matchingReminders[0] ?? ''
          const poemName = extractPoemTitle(ev.label, bestReminder)
          poems.push({
            emailId: email.id,
            title: poemName ? cleanTitle(poemName) : 'Poem Recital',
            text: bestReminder || `Due: ${ev.date ?? 'see newsletter'}`,
            dueDate: ev.date,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
          eventMatched = true
        }
      }
      // Only emit reminder-derived entries when upcoming_events had no match —
      // reminders are the fallback source, not a parallel one.
      if (!eventMatched) {
        for (const r of matchingReminders) {
          const poemName = extractPoemTitle('', r)
          poems.push({
            emailId: email.id,
            title: poemName ? cleanTitle(poemName) : 'Poem Recital',
            text: r,
            dueDate: null,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
        }
      }
    }
  }

  // Group candidates by due date (same calendar day = same assignment).
  // Entries with no due date are matched to a group by poem title similarity.
  // Each group is collapsed to its single best representative.
  if (poems.length === 0) return []

  // Normalize a date string to a YYYY-MM-DD key (strip time component)
  const dayKey = (d: string | null) => d ? d.slice(0, 10) : null

  // Group by due-date bucket first
  const groups = new Map<string, PoemAssignment[]>()
  const noDateEntries: PoemAssignment[] = []

  for (const p of poems) {
    const key = dayKey(p.dueDate)
    if (key) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(p)
    } else {
      noDateEntries.push(p)
    }
  }

  // Assign no-date entries to existing group if poem title overlaps, else own group
  for (const p of noDateEntries) {
    const titleWords = new Set(p.title.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(w => w.length > 3))
    let matched = false
    for (const [key, group] of groups) {
      const groupText = group.map(g => g.title + ' ' + g.text).join(' ').toLowerCase()
      if ([...titleWords].some(w => groupText.includes(w))) {
        group.push(p)
        matched = true
        break
      }
    }
    if (!matched) {
      const key = `nodate-${p.title.slice(0, 20)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(p)
    }
  }

  // Collapse each group to best entry
  const pickBest = (group: PoemAssignment[]): PoemAssignment => {
    const best = group.reduce((a, b) => {
      if (a.dueDate && !b.dueDate) return a
      if (!a.dueDate && b.dueDate) return b
      if (a.title.length !== b.title.length) return a.title.length > b.title.length ? a : b
      return (a.receivedAt ?? '') >= (b.receivedAt ?? '') ? a : b
    })
    const bestText = group.reduce((a, b) => a.text.length >= b.text.length ? a : b).text
    return { ...best, text: bestText }
  }

  return [...groups.values()]
    .map(pickBest)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
}

// KHe newsletter PDFs that haven't been analyzed yet
function findPendingNewsletterPDFs(emails: Email[]): PendingPDF[] {
  const pending: PendingPDF[] = []
  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    const filenames: string[] = ps.pdf_filenames ?? []
    const analyzed = new Set((ps.pdf_analyses ?? []).map((a: any) => a.filename))
    for (const fn of filenames) {
      // Only KHe (class) newsletters, not school-wide ones
      if (/khe|newsletter\s+week/i.test(fn) && !analyzed.has(fn)) {
        pending.push({
          emailId: email.id,
          emailSubject: email.subject,
          filename: fn,
          receivedAt: email.received_at,
        })
      }
    }
  }
  return pending.sort((a, b) =>
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

function PoemSection({ poems, pendingPDFs }: { poems: PoemAssignment[]; pendingPDFs: PendingPDF[] }) {
  const navigate = useNavigate()
  // poems are sorted ascending by dueDate — the last one is the most upcoming/current.
  // Only that card is expanded by default; past poems are collapsed.
  // "Current" = the poem whose due date is soonest on/after today.
  // If all are past, fall back to the one with the latest due date.
  // Due dates may be ISO ("2026-03-23") or human-readable ("Wednesday, February 25, 2026"),
  // so we parse them uniformly rather than relying on sort order.
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const parseDue = (p: PoemAssignment): Date | null => {
    if (!p.dueDate) return null
    // Try ISO format first ("2026-03-23" → append T12:00:00 to avoid UTC midnight shifting)
    const iso = p.dueDate.match(/^\d{4}-\d{2}-\d{2}/)
    if (iso) {
      const d = new Date(iso[0] + 'T12:00:00')
      if (!isNaN(d.getTime())) return d
    }
    // Human-readable fallback ("Monday, March 23, 2026" or "March 23, 2026")
    // Strip leading weekday name before parsing
    const stripped = p.dueDate.replace(/^[A-Za-z]+,?\s*/, '')
    const d = new Date(stripped)
    return isNaN(d.getTime()) ? null : d
  }
  const currentIdx = (() => {
    // Prefer upcoming (due >= today), pick the soonest
    let bestIdx = -1, bestDate: Date | null = null
    for (let i = 0; i < poems.length; i++) {
      const d = parseDue(poems[i])
      if (d && d >= today) {
        if (bestDate === null || d < bestDate) { bestDate = d; bestIdx = i }
      }
    }
    if (bestIdx >= 0) return bestIdx
    // All past — pick the most recent
    for (let i = 0; i < poems.length; i++) {
      const d = parseDue(poems[i])
      if (d && (bestDate === null || d > bestDate)) { bestDate = d; bestIdx = i }
    }
    return bestIdx >= 0 ? bestIdx : poems.length - 1
  })()
  const [expanded, setExpanded] = useState<number | null>(currentIdx >= 0 ? currentIdx : null)

  return (
    <section style={sectionStyles.section}>
      <SectionHeader label="🎤 Poem / Recitation" count={poems.length} />
      <p style={sectionStyles.desc}>
        Monthly poems to memorize and recite. Check the newsletter for due dates.
      </p>

      {/* Pending PDF notice */}
      {pendingPDFs.length > 0 && (
        <div style={poemStyles.pendingNotice}>
          <span style={poemStyles.pendingIcon}>📄</span>
          <div>
            <div style={poemStyles.pendingTitle}>Newsletter PDFs not yet loaded</div>
            <div style={poemStyles.pendingDesc}>
              Poem assignments are in the newsletter PDFs. Opening each email below will automatically extract the content:
            </div>
            <ul style={poemStyles.pendingList}>
              {pendingPDFs.map(p => (
                <li key={p.emailId + p.filename}>
                  <button
                    onClick={() => navigate('/emails', { state: { emailId: p.emailId } })}
                    style={poemStyles.pendingLink}
                  >
                    {p.emailSubject ?? 'Newsletter'}{' '}
                    <span style={{ opacity: 0.6 }}>
                      ({p.receivedAt ? new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''})
                    </span>
                  </button>
                  {' '}→ <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{p.filename.replace(/^_\s*/, '')}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {poems.length === 0 && pendingPDFs.length === 0 && (
        <EmptyState msg="No poem assignments found yet — they'll appear here when detected in newsletters." />
      )}
      {poems.map((p, i) => {
        // dueDate may be ISO (2026-03-23) or human-readable ("Monday, March 23")
        const dateStr = p.dueDate
          ? (() => {
              const iso = p.dueDate.match(/^\d{4}-\d{2}-\d{2}/)
              const d = iso
                ? new Date(iso[0] + 'T12:00:00')
                : new Date(p.dueDate.replace(/^[A-Za-z]+,?\s*/, ''))
              return isNaN(d.getTime()) ? p.dueDate : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            })()
          : null
        const isLatest = i === currentIdx
        const isOpen = expanded === i
        return (
          <div key={i} style={{ ...poemStyles.card, ...(isLatest ? poemStyles.latestCard : poemStyles.pastCard) }}>
            <button style={poemStyles.cardHeader} onClick={() => setExpanded(isOpen ? null : i)}>
              <span style={poemStyles.icon}>🎤</span>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isLatest && <span style={poemStyles.latestBadge}>Current</span>}
                  <span style={poemStyles.title}>{p.title}</span>
                </div>
                {p.weekOf && <div style={poemStyles.week}>{p.weekOf}</div>}
              </div>
              {dateStr && (
                <span style={poemStyles.dueBadge}>Due: {dateStr}</span>
              )}
              <span style={poemStyles.chevron}>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && p.text && (
              <p style={poemStyles.text}>{p.text}</p>
            )}
          </div>
        )
      })}
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
  const pendingNewsletterPDFs = findPendingNewsletterPDFs(emails)

  // Pull special homework from action items embedded in emails.
  // Primary signal: item_type === 'homework_special_project' (set by backend classifier).
  // Fallback: keyword match for older items that predate the item_type column.
  //
  // Dedup strategy (in priority order):
  //   1. event_group_id — backend groups items that refer to the same real event
  //   2. action item id — each DB row is unique
  // We pick the best representative per group: prefer the item with the longest
  // title (most descriptive) and earliest event_date.
  const specialItems: SpecialHomework[] = []
  // group_key → best item so far
  const groupMap = new Map<string, SpecialHomework>()

  for (const email of emails) {
    for (const item of email.action_items) {
      const isTagged = item.item_type === 'homework_special_project'
      const isKeywordMatch = !item.item_type && isSpecialHomework(item.title, item.description)
      if (!isTagged && !isKeywordMatch) continue

      // Dedup key: group id if available, otherwise the item's own id
      const groupKey = item.event_group_id != null
        ? `group-${item.event_group_id}`
        : `item-${item.id}`

      const candidate: SpecialHomework = {
        id: item.id,
        title: item.title,
        description: item.description,
        eventDate: item.event_date,
        sourceType: item.source_type,
        completed: item.completed,
      }

      const existing = groupMap.get(groupKey)
      if (!existing) {
        groupMap.set(groupKey, candidate)
      } else {
        // Prefer: has event_date > longer title > earlier received
        const existingHasDate = !!existing.eventDate
        const candidateHasDate = !!candidate.eventDate
        if (!existingHasDate && candidateHasDate) {
          groupMap.set(groupKey, candidate)
        } else if (existingHasDate === candidateHasDate) {
          if (candidate.title.length > existing.title.length) {
            groupMap.set(groupKey, candidate)
          }
        }
      }
    }
  }
  specialItems.push(...groupMap.values())
  specialItems.sort((a, b) => {
    if (!a.eventDate && !b.eventDate) return 0
    if (!a.eventDate) return 1
    if (!b.eventDate) return -1
    return a.eventDate.localeCompare(b.eventDate)
  })

  return (
    <div style={pageStyles.container}>
      {loading ? (
        <p style={{ color: '#94a3b8', padding: 20 }}>Loading...</p>
      ) : (
        <div style={pageStyles.grid}>
          <SpellingSection weeks={spellingWeeks} />
          <PoemSection poems={poems} pendingPDFs={pendingNewsletterPDFs} />
          <SpecialSection items={specialItems} />
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageStyles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900 },
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
    border: '1px solid #fed7aa',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  latestCard: {
    background: '#fff7ed',
    border: '1px solid #fb923c',
    boxShadow: '0 0 0 3px #ffedd555',
  },
  pastCard: {
    background: '#fffbf5',
    opacity: 0.8,
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
  latestBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#ea580c',
    color: '#fff',
    borderRadius: 4,
    padding: '1px 6px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    flexShrink: 0,
  },
  chevron: { fontSize: 10, color: '#94a3b8', flexShrink: 0 },
  // kept for layout compatibility (header is now the button itself)
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
    padding: '0 16px 14px 44px',  // indent to align with title, add bottom breathing room
    whiteSpace: 'pre-line' as const,
    borderTop: '1px solid #fed7aa33',
  },
  pendingNotice: {
    display: 'flex',
    gap: 12,
    background: '#fefce8',
    border: '1px solid #fde047',
    borderRadius: 10,
    padding: '12px 16px',
    marginBottom: 14,
  },
  pendingIcon: { fontSize: 20, flexShrink: 0, lineHeight: 1.3 },
  pendingTitle: { fontWeight: 600, fontSize: 13, color: '#713f12', marginBottom: 4 },
  pendingDesc: { fontSize: 12, color: '#78716c', marginBottom: 8 },
  pendingList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12,
    color: '#44403c',
    lineHeight: 1.8,
  },
  pendingLink: {
    color: '#2563eb',
    fontWeight: 500,
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    font: 'inherit',
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
