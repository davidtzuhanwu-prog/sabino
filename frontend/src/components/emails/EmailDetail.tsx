import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Email, EmailKeyPoints, PSAttachments, PDFAnalysis, PDFEntry } from '../../types'
import ActionItemCard from '../dashboard/ActionItemCard'

// ── Markdown pre-processing ───────────────────────────────────────────────────
function cleanMarkdown(raw: string): string {
  return raw
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
      const apiBase = `${window.location.protocol}//${window.location.hostname}:8000`
      const apiResp = await fetch(`${apiBase}/api/ps-pdf/proxy-fetch`, {
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
    <div className="bg-[#f0f7ff] border border-blue-200 rounded-xl p-4 mb-1">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <span className="w-8 h-8 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0 tracking-tighter">PS</span>
        <div>
          <div className="font-semibold text-sm text-blue-800 leading-tight">ParentSquare Attachments</div>
          <div className="text-xs text-blue-500 mt-0.5">
            {ps.attachment_count} attachment{ps.attachment_count !== 1 ? 's' : ''} on this post
            {ps.error && <span className="text-red-400"> · fetch error, showing partial results</span>}
          </div>
        </div>
        <a
          href={ps.feed_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-blue-600 no-underline bg-blue-100 border border-blue-200 rounded-md px-2.5 py-1 font-medium whitespace-nowrap shrink-0"
        >
          Open in ParentSquare ↗
        </a>
      </div>

      {/* Pending PDF documents */}
      {pendingPdfs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {pendingPdfs.map(fn => {
            const status = pdfStatus[fn] ?? 'idle'
            const colorCls = status === 'error'
              ? 'bg-red-100 text-red-800 border-red-300'
              : status === 'done'
                ? 'bg-green-100 text-green-800 border-green-300'
                : 'bg-violet-100 text-violet-800 border-violet-300'
            return (
              <button
                key={fn}
                className={`text-xs font-medium rounded-md px-2.5 py-1 flex items-center gap-1 border transition-opacity min-h-[44px] ${colorCls} ${status === 'loading' || status === 'done' ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
                disabled={status === 'loading' || status === 'done'}
                onClick={() => fetchOnePdf(fn, ps.feed_url)}
                title={status === 'error' ? (pdfErrors[fn] || 'Click to retry') : status === 'loading' ? 'Analyzing…' : status === 'done' ? 'Analysis complete' : 'Auto-analyzing…'}
              >
                {status === 'loading' ? '⏳' : status === 'done' ? '✓' : status === 'error' ? '✗' : '⏳'} {fn.replace(/^_\s*/, '')}
                {status === 'error' && pdfErrors[fn] && (
                  <span className="text-[10px] ml-1.5 opacity-80">
                    {pdfErrors[fn].includes('session cookie') ? '→ Add PS cookie in Settings' : pdfErrors[fn]}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Post text */}
      {ps.post_text && (
        <p className="text-[13px] text-gray-700 leading-relaxed mb-3 bg-white rounded-md px-3 py-2 border border-blue-100 m-0">{ps.post_text}</p>
      )}

      {/* Photo grid */}
      {thumbs.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
          {thumbs.map((url, i) => (
            <button
              key={i}
              className="border-none p-0 rounded-md overflow-hidden cursor-pointer bg-indigo-100 block aspect-square"
              onClick={() => setLightbox(url)}
              title={`Photo ${i + 1}`}
            >
              <img
                src={url}
                alt={`Attachment ${i + 1}`}
                className="w-full h-full object-cover block transition-opacity"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/85 z-[1000] flex items-center justify-center" onClick={() => setLightbox(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-3.5 -right-3.5 w-8 h-8 rounded-full bg-white border-none cursor-pointer text-sm font-bold text-[#1e2a3a] z-[1001] flex items-center justify-center leading-none"
              onClick={() => setLightbox(null)}
            >✕</button>
            <img src={lightbox} alt="Full size" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain block" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── PDF Newsletter Analysis ───────────────────────────────────────────────────

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
    <div className="mb-1">
      {pdfs.map((entry) => {
        const a = entry.analysis as PDFAnalysis
        return (
          <div key={entry.filename} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4">
            {/* Header */}
            <div className="flex items-start gap-2.5 mb-3">
              <span className="text-[22px] leading-none shrink-0">📄</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[15px] text-stone-900 leading-tight">{a.title}</div>
                {a.week_of && <div className="text-xs text-stone-500 mt-0.5">{a.week_of}</div>}
              </div>
              <span className="text-[10px] text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0 self-start">
                {entry.filename.replace(/^_\s*/, '')}
              </span>
            </div>

            {/* Summary */}
            <p className="text-[13px] text-stone-600 leading-relaxed mb-3.5 m-0">{a.summary}</p>

            {/* Spelling words */}
            {(() => {
              const spelling = a.learning_areas.find(la => la.subject.toLowerCase().includes('spelling'))
              if (!spelling) return null
              const wordPairs = spelling.what_we_learned.match(/\w+\/\w+|\w+ - \w+/g) ?? []
              return (
                <div className="bg-violet-100 border border-violet-300 rounded-lg px-3.5 py-2.5 mb-3.5">
                  <div className="font-semibold text-[13px] text-violet-800 mb-2">📝 Spelling Test Words (Week {a.week_of ?? ''})</div>
                  {wordPairs.length > 0 ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                      {wordPairs.map((pair, i) => (
                        <span key={i} className="text-[13px] text-indigo-700 font-mono bg-white rounded px-2 py-0.5 border border-violet-300">{pair}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-indigo-700 m-0">{spelling.what_we_learned}</p>
                  )}
                </div>
              )
            })()}

            {/* Learning areas */}
            {a.learning_areas.length > 0 && (
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-stone-400 uppercase tracking-widest mb-2">This Week's Learning</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {a.learning_areas
                    .filter(la => !la.subject.toLowerCase().includes('spelling'))
                    .map((la) => {
                      const [bg, fg] = subjectColor(la.subject)
                      const isOpen = openSubject === la.subject
                      return (
                        <button
                          key={la.subject}
                          style={{ background: bg, color: fg, border: `1px solid ${fg}22` }}
                          className="text-xs font-semibold rounded-full px-3 py-1 cursor-pointer flex items-center gap-1 transition-opacity min-h-[32px]"
                          onClick={() => setOpenSubject(isOpen ? null : la.subject)}
                        >
                          {la.subject}
                          {la.coming_up && <span className="text-base leading-none opacity-60" title="Coming up next week">•</span>}
                        </button>
                      )
                    })}
                </div>
                {openSubject && (() => {
                  const la = a.learning_areas.find(l => l.subject === openSubject)
                  if (!la) return null
                  const [bg, fg] = subjectColor(la.subject)
                  return (
                    <div style={{ background: bg, borderLeft: `3px solid ${fg}` }} className="rounded-lg px-3.5 py-2.5 mt-1">
                      <div style={{ color: fg }} className="font-bold text-[13px] mb-1">{la.subject}</div>
                      <p className="text-[13px] text-gray-700 mb-1.5 leading-relaxed m-0">{la.what_we_learned}</p>
                      {la.coming_up && (
                        <p className="text-xs text-gray-500 m-0 leading-relaxed">
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
              <div className="mb-3.5">
                <div className="text-[11px] font-bold text-stone-400 uppercase tracking-widest mb-2">Upcoming Dates</div>
                <div className="flex flex-col gap-1">
                  {a.upcoming_events.map((ev, i) => (
                    <div key={i} className="flex items-baseline gap-2.5">
                      <span className="text-xs font-bold text-amber-700 min-w-[90px] shrink-0">{ev.date ?? '—'}</span>
                      <span className="text-[13px] text-stone-900">{ev.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reminders */}
            {a.reminders.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-stone-400 uppercase tracking-widest mb-2">Parent Reminders</div>
                <ul className="m-0 pl-4.5">
                  {a.reminders.map((r, i) => (
                    <li key={i} className="text-xs text-stone-600 mb-1 leading-relaxed">{r}</li>
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

function KeyPointsCard({ kp, receivedAt }: { kp: EmailKeyPoints; receivedAt: string | null }) {
  const hasDates = kp.dates.length > 0
  const hasReqs = kp.requirements.length > 0

  const notifiedDate = receivedAt
    ? new Date(receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="bg-gradient-to-br from-[#f0f7ff] to-[#faf5ff] border border-[#c7d9f5] rounded-xl px-5 py-4">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-sm text-indigo-500">✦</span>
        <span className="font-semibold text-sm text-indigo-700 tracking-wide">AI Summary</span>
        {notifiedDate && (
          <span className="ml-auto text-[11px] text-slate-500 bg-slate-200 rounded-full px-2 py-0.5 font-medium">📬 Notified {notifiedDate}</span>
        )}
      </div>

      {kp.summary && (
        <p className="mb-3.5 text-sm leading-relaxed text-slate-800 m-0">{kp.summary}</p>
      )}

      <div className="flex gap-5 flex-wrap">
        {hasDates && (
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">📅 Key Dates</div>
            <ul className="m-0 p-0 list-none">
              {kp.dates.map((d, i) => (
                <li key={i} className="flex justify-between items-baseline gap-2 text-[13px] text-slate-700 py-1 border-b border-dashed border-[#dde5f0]">
                  <span className="font-medium">{d.label}</span>
                  {d.date && <span className="text-blue-600 font-semibold whitespace-nowrap text-xs">{d.date}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasReqs && (
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">✅ What You Need to Do</div>
            <ul className="m-0 p-0 list-none">
              {kp.requirements.map((r, i) => (
                <li key={i} className="text-[13px] text-slate-700 py-1.5 pl-4 border-b border-dashed border-[#dde5f0] relative leading-relaxed">{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!hasDates && !hasReqs && !kp.summary && (
        <p className="text-[13px] text-slate-400 m-0">No key points found in this email.</p>
      )}
    </div>
  )
}

export default function EmailDetail({ email, onToggle, onDelete }: Props) {
  const keyPoints = parseKeyPoints(email.key_points)
  const [psRaw, setPsRaw] = useState(email.ps_attachments)
  const psAttachments = parsePSAttachments(psRaw)

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
    <div className="p-5 md:px-6 md:py-5">
      <div className="mb-6 pb-4 border-b border-slate-200">
        <h2 className="m-0 mb-2.5 text-[#1e2a3a] text-lg md:text-xl font-semibold">{email.subject || '(no subject)'}</h2>
        <div className="flex flex-wrap gap-4 md:gap-6 text-slate-500 text-sm">
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
        <section className="mb-6">
          <KeyPointsCard kp={keyPoints} receivedAt={email.received_at} />
        </section>
      )}

      {psAttachments?.pdf_analyses && psAttachments.pdf_analyses.length > 0 && (
        <section className="mb-6">
          <PDFNewsletter entries={psAttachments.pdf_analyses} />
        </section>
      )}

      {psAttachments && (
        <section className="mb-6">
          <PSGallery ps={psAttachments} emailId={email.id} onPdfLoaded={refreshPsAttachments} />
        </section>
      )}

      {email.action_items.length > 0 && (
        <section className="mb-6">
          <h3 className="text-gray-700 text-[15px] m-0 mb-3.5">Action Items ({email.action_items.length})</h3>
          {email.action_items.map(item => (
            <ActionItemCard key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </section>
      )}

      <section className="mb-6">
        <h3 className="text-gray-700 text-[15px] m-0 mb-3.5">Email Body</h3>
        {email.body_plain ? (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 md:px-5 py-4 text-sm leading-relaxed text-gray-700 break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {cleanMarkdown(email.body_plain)}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-slate-400 text-[13px] m-0">(empty)</p>
        )}
      </section>
    </div>
  )
}

// ── Markdown component overrides ──────────────────────────────────────────────
const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => (
    <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#1e2a3a]">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-slate-600">{children}</em>
  ),
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-[#1e2a3a] mt-4 mb-2 leading-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-[#1e2a3a] mt-3.5 mb-1.5">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-gray-700 mt-3 mb-1">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="my-1 mb-3 pl-5.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 mb-3 pl-5.5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="mb-1 leading-relaxed">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline break-all"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 px-3.5 py-2 border-l-[3px] border-slate-300 bg-slate-100 rounded-r-md text-slate-500">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="border-none border-t border-slate-200 my-4" />
  ),
  code: ({ children }) => (
    <code className="bg-slate-200 rounded px-1 py-px text-xs font-mono">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-slate-100 border border-slate-200 rounded-md px-3.5 py-2.5 text-xs leading-relaxed overflow-auto font-mono">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto mb-3">
      <table className="border-collapse w-full text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 bg-slate-100 border border-slate-200 font-semibold text-left">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 border border-slate-200">{children}</td>
  ),
}
