import { useEffect, useRef, useState, type JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import type { Email, PDFAnalysis, PDFEntry } from '../types'

// ── Data helpers ──────────────────────────────────────────────────────────────

interface SpellingWeek {
  emailId: number
  filename: string
  weekOf: string | null
  title: string
  words: string[]
  rawText: string
  receivedAt: string | null
  spellingTip: string | null
}

interface PoemAssignment {
  emailId: number
  title: string
  text: string
  poemText: string | null
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
  const seen = new Set<string>()
  const weeks: SpellingWeek[] = []
  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      if (seen.has(entry.filename)) continue
      const a = entry.analysis as PDFAnalysis
      const spelling = a.learning_areas.find(la =>
        la.subject.toLowerCase().includes('spelling')
      )
      if (!spelling) continue
      seen.add(entry.filename)
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
        spellingTip: spelling.spelling_tip ?? null,
      })
    }
  }
  return weeks.sort((a, b) =>
    (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')
  )
}

function extractPoems(emails: Email[]): PoemAssignment[] {
  const poems: PoemAssignment[] = []

  const isPoemRecital = (text: string) => {
    const t = text.toLowerCase()
    return t.includes('poem') && (t.includes('recit') || t.includes('month') || t.includes('poem of'))
  }

  const extractPoemTitle = (label: string, reminder: string): string | null => {
    const dashMatch = label.match(/[–—-]\s*(.+?)\s*$/)
    if (dashMatch) return dashMatch[1].replace(/^['"\u2018\u2019\u201c\u201d]+|['"\u2018\u2019\u201c\u201d]+$/g, '').trim()

    const labelQuote = label.match(/[\u2018\u2019'"]([A-Z][^\u2018\u2019"]{4,})[\u2018\u2019'"]/i)
    if (labelQuote) return labelQuote[1].trim()

    const reminderQuote = reminder.match(/[\u2018\u2019'"]([A-Z][^'""\u201c\u201d]{3,})(?=['"\u2018\u2019\u201c\u201d](?:\s|$|[,.)by]))/i)
    if (reminderQuote) return reminderQuote[1].trim()

    const unquoted = reminder.match(/\bpoem\b\s+(?:of the month[,\s]*)?([A-Z][A-Za-z '\-]{3,30})(?:\s+by\b|[.,]|$)/i)
    if (unquoted) {
      const t = unquoted[1].trim()
      if (!/^(recital|of the|test)/i.test(t)) return t
    }

    return null
  }
  const cleanTitle = (t: string) => t.replace(/[,;:.!?]+$/, '').trim()

  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    for (const entry of (ps.pdf_analyses ?? []) as PDFEntry[]) {
      if (!entry.analysis) continue
      const a = entry.analysis as PDFAnalysis

      const matchingReminders = a.reminders.filter(r => isPoemRecital(r))
      let eventMatched = false

      const poemText = a.poem_text ?? null

      for (const ev of a.upcoming_events) {
        if (isPoemRecital(ev.label)) {
          const bestReminder = matchingReminders[0] ?? ''
          const poemName = extractPoemTitle(ev.label, bestReminder)
          poems.push({
            emailId: email.id,
            title: poemName ? cleanTitle(poemName) : 'Poem Recital',
            text: bestReminder || `Due: ${ev.date ?? 'see newsletter'}`,
            poemText,
            dueDate: ev.date,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
          eventMatched = true
        }
      }
      if (!eventMatched) {
        for (const r of matchingReminders) {
          const poemName = extractPoemTitle('', r)
          poems.push({
            emailId: email.id,
            title: poemName ? cleanTitle(poemName) : 'Poem Recital',
            text: r,
            poemText,
            dueDate: null,
            weekOf: a.week_of,
            receivedAt: email.received_at,
          })
        }
      }
    }
  }

  if (poems.length === 0) return []

  const dayKey = (d: string | null) => d ? d.slice(0, 10) : null
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

  for (const p of noDateEntries) {
    const titleWords = new Set(p.title.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(w => w.length > 3))
    let matched = false
    for (const [, group] of groups) {
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

  const pickBest = (group: PoemAssignment[]): PoemAssignment => {
    const best = group.reduce((a, b) => {
      if (a.dueDate && !b.dueDate) return a
      if (!a.dueDate && b.dueDate) return b
      if (a.title.length !== b.title.length) return a.title.length > b.title.length ? a : b
      return (a.receivedAt ?? '') >= (b.receivedAt ?? '') ? a : b
    })
    const bestText = group.reduce((a, b) => a.text.length >= b.text.length ? a : b).text
    const bestPoemText = group.find(p => p.poemText)?.poemText ?? null
    return { ...best, text: bestText, poemText: bestPoemText }
  }

  return [...groups.values()]
    .map(pickBest)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
}

function findPendingNewsletterPDFs(emails: Email[]): PendingPDF[] {
  const pending: PendingPDF[] = []
  for (const email of emails) {
    if (!email.ps_attachments) continue
    let ps: any
    try { ps = JSON.parse(email.ps_attachments) } catch { continue }
    const filenames: string[] = ps.pdf_filenames ?? []
    const analyzed = new Set((ps.pdf_analyses ?? []).map((a: any) => a.filename))
    for (const fn of filenames) {
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

const SECTION_ICONS: Record<string, JSX.Element> = {
  'Spelling Test': (
    // pencil-square
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M5.433 13.917l1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
    </svg>
  ),
  'Poem / Recitation': (
    // book-open
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
    </svg>
  ),
  'Special Homework & Projects': (
    // star (outline-style solid)
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clipRule="evenodd" />
    </svg>
  ),
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  const icon = SECTION_ICONS[label]
  return (
    <div className="flex items-center gap-2 mb-1.5">
      {icon && <span className="text-slate-500">{icon}</span>}
      <span className="text-[17px] font-bold text-[#1e2a3a]">{label}</span>
      {count > 0 && (
        <span className="text-[11px] font-bold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{count}</span>
      )}
    </div>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <p className="text-[13px] text-slate-400 italic px-4 py-3 bg-slate-50 rounded-lg border border-dashed border-slate-200">
      {msg}
    </p>
  )
}

// ── Spelling Section ──────────────────────────────────────────────────────────

function SpellingSection({ weeks }: { weeks: SpellingWeek[] }) {
  const [expanded, setExpanded] = useState<string | null>(
    weeks.length > 0 ? `${weeks[0].emailId}-${weeks[0].filename}` : null
  )
  // tip state: key → { tip, loading }
  const [tips, setTips] = useState<Record<string, { tip: string | null; loading: boolean }>>({})
  const fetchedKeys = useRef(new Set<string>())

  // Fetch tip for the initially expanded card on mount
  useEffect(() => {
    if (weeks.length > 0) fetchTip(weeks[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchTip = async (w: SpellingWeek) => {
    const key = `${w.emailId}-${w.filename}`
    if (fetchedKeys.current.has(key) || w.spellingTip) return
    fetchedKeys.current.add(key)
    setTips(prev => ({ ...prev, [key]: { tip: null, loading: true } }))
    try {
      const res = await api.post('/api/ps-pdf/spelling-tip', {
        email_id: w.emailId,
        filename: w.filename,
        words: w.words,
        raw_text: w.rawText,
      })
      setTips(prev => ({ ...prev, [key]: { tip: res.data.tip, loading: false } }))
    } catch {
      setTips(prev => ({ ...prev, [key]: { tip: null, loading: false } }))
    }
  }

  return (
    <section className="mb-10">
      <SectionHeader label="Spelling Test" count={weeks.length} />
      <p className="text-[13px] text-slate-500 mb-3.5">
        Weekly spelling words from the class newsletter. Test is each Friday.
      </p>
      {weeks.length === 0 && (
        <EmptyState msg="No spelling words found yet — newsletter PDFs will populate this." />
      )}
      {weeks.map((w) => {
        const key = `${w.emailId}-${w.filename}`
        const isOpen = expanded === key
        const isLatest = weeks[0] === w
        const tip = w.spellingTip ?? tips[key]?.tip ?? null
        const tipLoading = tips[key]?.loading ?? false
        return (
          <div key={key} className={`border rounded-xl mb-2 overflow-hidden bg-white ${isLatest ? 'border-violet-300 shadow-[0_0_0_3px_#ede9fe55]' : 'border-slate-200'}`}>
            <button
              className="flex items-center gap-2.5 px-4 py-3 w-full bg-transparent border-none cursor-pointer text-left min-h-[44px]"
              onClick={() => {
                const opening = !isOpen
                setExpanded(opening ? key : null)
                if (opening) fetchTip(w)
              }}
            >
              <div className="flex-1 min-w-0">
                <span className="flex items-center gap-2 font-semibold text-sm text-[#1e2a3a]">
                  {isLatest && (
                    <span className="text-[10px] font-bold bg-violet-700 text-white rounded px-1.5 py-0.5 uppercase tracking-wide">Current</span>
                  )}
                  {w.weekOf ?? w.title}
                </span>
                {!isOpen && w.words.length > 0 && (
                  <span className="block text-xs text-gray-500 mt-0.5 font-mono">
                    {w.words.slice(0, 3).join('  ·  ')}{w.words.length > 3 ? ` +${w.words.length - 3}` : ''}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 border-t border-slate-100">
                {w.words.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 pt-3 mb-3">
                    {w.words.map((pair, i) => (
                      <span key={i} className="text-sm font-mono bg-violet-100 text-indigo-700 rounded-md px-2.5 py-1 border border-violet-300 font-medium">{pair}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-gray-700 leading-relaxed mt-3 mb-2">{w.rawText}</p>
                )}

                {/* AI coaching tip */}
                {tipLoading && (
                  <div className="flex items-center gap-2 text-[12px] text-violet-500 italic mt-1 mb-2">
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full" />
                    Generating study tips…
                  </div>
                )}
                {tip && !tipLoading && (
                  <div className="mt-1 mb-2 bg-violet-50 border border-violet-200 rounded-lg px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-bold text-violet-700 uppercase tracking-wide">💡 Study tip</span>
                    </div>
                    <p className="text-[12.5px] text-violet-900 leading-relaxed">{tip}</p>
                  </div>
                )}

                <div className="text-[11px] text-slate-400 mt-1">
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
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const parseDue = (p: PoemAssignment): Date | null => {
    if (!p.dueDate) return null
    const iso = p.dueDate.match(/^\d{4}-\d{2}-\d{2}/)
    if (iso) {
      const d = new Date(iso[0] + 'T12:00:00')
      if (!isNaN(d.getTime())) return d
    }
    const stripped = p.dueDate.replace(/^[A-Za-z]+,?\s*/, '')
    // If no 4-digit year in the string, append current year so JS doesn't default to 2001
    const withYear = /\d{4}/.test(stripped) ? stripped : `${stripped} ${new Date().getFullYear()}`
    const d = new Date(withYear)
    return isNaN(d.getTime()) ? null : d
  }
  const currentIdx = (() => {
    let bestIdx = -1, bestDate: Date | null = null
    for (let i = 0; i < poems.length; i++) {
      const d = parseDue(poems[i])
      if (d && d >= today) {
        if (bestDate === null || d < bestDate) { bestDate = d; bestIdx = i }
      }
    }
    if (bestIdx >= 0) return bestIdx
    for (let i = 0; i < poems.length; i++) {
      const d = parseDue(poems[i])
      if (d && (bestDate === null || d > bestDate)) { bestDate = d; bestIdx = i }
    }
    return bestIdx >= 0 ? bestIdx : poems.length - 1
  })()
  const [expanded, setExpanded] = useState<number | null>(currentIdx >= 0 ? currentIdx : null)

  return (
    <section className="mb-10">
      <SectionHeader label="Poem / Recitation" count={poems.length} />
      <p className="text-[13px] text-slate-500 mb-3.5">
        Monthly poems to memorize and recite. Check the newsletter for due dates.
      </p>

      {/* Pending PDF notice */}
      {pendingPDFs.length > 0 && (
        <div className="flex gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 mb-3.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600">
              <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clipRule="evenodd" />
            </svg>
          <div>
            <div className="font-semibold text-[13px] text-yellow-900 mb-1">Newsletter PDFs not yet loaded</div>
            <div className="text-xs text-stone-500 mb-2">
              Poem assignments are in the newsletter PDFs. Opening each email below will automatically extract the content:
            </div>
            <ul className="m-0 pl-4.5 text-xs text-stone-700 leading-7">
              {pendingPDFs.map(p => (
                <li key={p.emailId + p.filename}>
                  <button
                    onClick={() => navigate('/emails', { state: { emailId: p.emailId } })}
                    className="text-blue-600 font-medium bg-transparent border-none p-0 cursor-pointer text-inherit"
                  >
                    {p.emailSubject ?? 'Newsletter'}{' '}
                    <span className="opacity-60">
                      ({p.receivedAt ? new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''})
                    </span>
                  </button>
                  {' '}→ <span className="font-mono text-[11px]">{p.filename.replace(/^_\s*/, '')}</span>
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
        const dateStr = p.dueDate
          ? (() => {
              const iso = p.dueDate.match(/^\d{4}-\d{2}-\d{2}/)
              const d = iso
                ? new Date(iso[0] + 'T12:00:00')
                : (() => { const s = p.dueDate.replace(/^[A-Za-z]+,?\s*/, ''); return new Date(/\d{4}/.test(s) ? s : `${s} ${new Date().getFullYear()}`) })()
              return isNaN(d.getTime()) ? p.dueDate : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            })()
          : null
        const isLatest = i === currentIdx
        const isOpen = expanded === i
        return (
          <div key={i} className={`border rounded-xl mb-2 overflow-hidden ${isLatest ? 'bg-orange-50 border-orange-400 shadow-[0_0_0_3px_#ffedd555]' : 'bg-[#fffbf5] border-orange-200 opacity-80'}`}>
            <button className="flex items-center gap-2.5 px-4 py-3 w-full bg-transparent border-none cursor-pointer text-left min-h-[44px]" onClick={() => setExpanded(isOpen ? null : i)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0 text-orange-400">
                <path d="M10 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z" />
                <path d="M3.5 9.75A.75.75 0 0 0 2 10a8 8 0 0 0 6.25 7.79V19h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.21A8 8 0 0 0 18 10a.75.75 0 0 0-1.5 0 6.5 6.5 0 0 1-13 0 .75.75 0 0 0-.75-.75h-.25Z" />
              </svg>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  {isLatest && <span className="text-[10px] font-bold bg-orange-600 text-white rounded px-1.5 py-0.5 uppercase tracking-wide shrink-0">Current</span>}
                  <span className="font-semibold text-sm text-stone-900">{p.title}</span>
                </div>
                {p.weekOf && <div className="text-xs text-stone-500 mt-0.5">{p.weekOf}</div>}
              </div>
              {dateStr && (
                <span className="text-[11px] font-bold bg-amber-100 text-amber-900 rounded px-2 py-0.5 whitespace-nowrap shrink-0">Due: {dateStr}</span>
              )}
              <span className="text-[10px] text-slate-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-3.5 pt-0 border-t border-orange-200/30">
                {p.poemText ? (
                  <pre className="text-[13px] text-stone-700 leading-relaxed m-0 mt-3 pl-7 font-serif whitespace-pre-wrap bg-orange-50/60 rounded-lg p-3 border border-orange-100">{p.poemText}</pre>
                ) : p.text ? (
                  <p className="text-[13px] text-stone-600 leading-relaxed m-0 mt-3 pl-7 whitespace-pre-line">{p.text}</p>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Special Homework Section ──────────────────────────────────────────────────

function SpecialCard({ item, faded }: { item: SpecialHomework; faded?: boolean }) {
  const [open, setOpen] = useState(false)
  const dateStr = item.eventDate
    ? new Date(item.eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className={`bg-white border border-slate-200 rounded-xl mb-2 overflow-hidden transition-opacity ${faded ? 'opacity-55' : ''}`}>
      <button className="flex items-center gap-2.5 px-4 py-3 w-full bg-transparent border-none cursor-pointer min-h-[44px]" onClick={() => setOpen(o => !o)}>
        <span className="shrink-0 text-slate-400">
          {item.completed
            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-500"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10Z" clipRule="evenodd" /></svg>
          }
        </span>
        <div className="flex-1 text-left">
          <span className={`font-medium text-sm text-[#1e2a3a] ${item.completed ? 'line-through' : ''}`}>
            {item.title}
          </span>
        </div>
        {dateStr && <span className="text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">{dateStr}</span>}
        <span className="text-[10px] text-slate-400 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && item.description && (
        <p className="text-[13px] text-gray-700 leading-relaxed m-0 mx-4 mb-3 ml-10">{item.description}</p>
      )}
    </div>
  )
}

function SpecialSection({ items }: { items: SpecialHomework[] }) {
  const upcoming = items.filter(i => !i.completed && i.eventDate && new Date(i.eventDate) >= new Date())
  const past = items.filter(i => i.completed || (i.eventDate && new Date(i.eventDate) < new Date()))

  return (
    <section className="mb-10">
      <SectionHeader label="Special Homework & Projects" count={upcoming.length} />
      <p className="text-[13px] text-slate-500 mb-3.5">
        One-off or seasonal assignments: performances, projects, presentations, contests.
      </p>
      {items.length === 0 && (
        <EmptyState msg="No special homework found." />
      )}
      {upcoming.length > 0 && (
        <>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Upcoming</div>
          {upcoming.map(item => <SpecialCard key={item.id} item={item} />)}
        </>
      )}
      {past.length > 0 && (
        <>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 mt-4">Past</div>
          {past.slice(0, 5).map(item => <SpecialCard key={item.id} item={item} faded />)}
        </>
      )}
    </section>
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

  const specialItems: SpecialHomework[] = []
  const groupMap = new Map<string, SpecialHomework>()

  for (const email of emails) {
    for (const item of email.action_items) {
      const isTagged = item.item_type === 'homework_special_project'
      const isKeywordMatch = !item.item_type && isSpecialHomework(item.title, item.description)
      if (!isTagged && !isKeywordMatch) continue

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
    <div className="max-w-[900px]">
      {loading ? (
        <p className="text-slate-400 p-5">Loading...</p>
      ) : (
        <div className="flex flex-col">
          <SpellingSection weeks={spellingWeeks} />
          <PoemSection poems={poems} pendingPDFs={pendingNewsletterPDFs} />
          <SpecialSection items={specialItems} />
        </div>
      )}
    </div>
  )
}
