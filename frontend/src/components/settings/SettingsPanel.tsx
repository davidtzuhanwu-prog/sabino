import { useEffect, useRef, useState, useCallback } from 'react'
import api from '../../api/client'
import OAuthConnectButton from '../auth/OAuthConnectButton'
import type { UserSettings, CalendarInfo } from '../../types'

interface ScanStatus {
  scanning: boolean
  last_email_scan_at: string | null
  last_calendar_scan_at: string | null
}

function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus>({
    scanning: false, last_email_scan_at: null, last_calendar_scan_at: null,
  })
  const refresh = useCallback(() => {
    api.get<ScanStatus>('/api/emails/scan/status').then(r => setStatus(r.data)).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { status, refresh }
}

function LastScanBadge({ isoTimestamp }: { isoTimestamp: string | null }) {
  if (!isoTimestamp) {
    return <span className="inline-flex items-center text-[12px] text-slate-400 bg-slate-50 rounded-full px-2.5 py-0.5 border border-dashed border-slate-200">Never scanned</span>
  }
  const dt = new Date(isoTimestamp.endsWith('Z') ? isoTimestamp : isoTimestamp + 'Z')
  const diffMs = Date.now() - dt.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)
  const relative =
    diffMin < 1 ? 'just now' :
    diffMin < 60 ? `${diffMin}m ago` :
    diffHr < 24 ? `${diffHr}h ago` :
    `${diffDay}d ago`
  const formatted = dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-0.5 border border-slate-200" title={`Last scanned at ${formatted}`}>
      🕐 Last scanned: <strong>{relative}</strong>
      <span className="text-slate-400">&nbsp;({formatted})</span>
    </span>
  )
}

function CalendarPicker({ settings, onSave }: { settings: UserSettings; onSave: (updates: Partial<UserSettings>) => void }) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearMsg, setClearMsg] = useState('')
  const [fetched, setFetched] = useState(false)

  const fetchCalendars = async () => {
    setLoading(true)
    try {
      const { data } = await api.get<CalendarInfo[]>('/api/calendar/list')
      setCalendars(data)
      setFetched(true)
    } catch { setFetched(true) } finally { setLoading(false) }
  }

  // Auto-fetch on mount so the selected calendar name resolves immediately
  useEffect(() => { fetchCalendars() }, [])

  const handleSelect = async (id: string) => {
    onSave({ selected_calendar_id: id })
    setClearing(true)
    setClearMsg('')
    try {
      await api.delete('/api/calendar/events')
      setClearMsg('Calendar changed — existing events cleared. Run Scan Now to fetch from the new calendar.')
    } catch {
      setClearMsg('Calendar saved, but could not clear old events.')
    } finally { setClearing(false) }
  }

  const hasSelection = !!settings.selected_calendar_id
  const selectedCal = calendars.find(c => c.id === settings.selected_calendar_id)

  return (
    <div>
      {/* Required selection warning */}
      {!hasSelection && (
        <div className="flex items-start gap-2.5 mb-4 px-3.5 py-3 bg-amber-50 border border-amber-300 rounded-lg">
          <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
          <p className="text-[13px] text-amber-800 m-0">
            <strong>No school calendar selected.</strong> You must select a calendar before scanning — otherwise the app cannot fetch school events.
          </p>
        </div>
      )}

      {/* Currently selected calendar chip */}
      {hasSelection && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
          <span className="text-emerald-600 text-sm shrink-0">✓</span>
          {selectedCal
            ? <><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: selectedCal.color }} /><span className="text-[13px] font-medium text-emerald-800">{selectedCal.name}</span></>
            : <span className="text-[13px] font-mono text-emerald-700 truncate">{settings.selected_calendar_id}</span>
          }
          <span className="text-[12px] text-emerald-600 ml-auto shrink-0">Active</span>
        </div>
      )}

      <label className="block text-sm text-gray-700 font-medium mb-2.5">
        {hasSelection ? 'Change calendar' : 'Select a school calendar'}
      </label>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading calendars…</p>
      ) : !fetched ? null
      : calendars.length === 0 ? (
        <p className="text-slate-400 text-sm">No calendars found. Make sure your Google account is connected.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {calendars.map(cal => {
            const selected = settings.selected_calendar_id === cal.id
            return (
              <button
                key={cal.id}
                className={`flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm text-gray-700 transition-colors min-h-[44px] ${selected ? 'border-[1.5px] border-emerald-400 bg-emerald-50' : 'border border-slate-200 bg-white cursor-pointer hover:border-slate-300 hover:bg-slate-50'}`}
                onClick={() => !selected && handleSelect(cal.id)}
                disabled={clearing}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cal.color }} />
                <span className="flex-1 flex items-center gap-2">
                  {cal.name}
                  {cal.primary && <span className="text-[11px] bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 font-medium">personal</span>}
                </span>
                {selected && <span className="text-emerald-500 font-bold text-[15px]">✓</span>}
              </button>
            )
          })}
        </div>
      )}
      {clearMsg && <p className="text-[13px] text-emerald-600 mt-2.5">{clearMsg}</p>}
      <p className="text-slate-400 text-[13px] mt-2.5">
        Choose your <strong>school</strong> calendar only — not your personal calendar. Changing this will clear stored events.
      </p>
    </div>
  )
}

const GRADE_LEVELS = [
  { value: '', label: '— select grade —' },
  { value: 'TK', label: 'Transitional Kindergarten (TK)' },
  { value: 'Kindergarten', label: 'Kindergarten (K)' },
  { value: 'Grade 1', label: 'Grade 1' },
  { value: 'Grade 2', label: 'Grade 2' },
  { value: 'Grade 3', label: 'Grade 3' },
  { value: 'Grade 4', label: 'Grade 4' },
  { value: 'Grade 5', label: 'Grade 5' },
]

interface LogLine { id: number; text: string; type: 'progress' | 'done' | 'error' }

function ScanNowSection({ onScanComplete, calendarSelected }: { onScanComplete?: () => void; calendarSelected: boolean }) {
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const pushLine = (text: string, type: LogLine['type'] = 'progress') => {
    counterRef.current += 1
    setLog(prev => [...prev, { id: counterRef.current, text, type }])
  }

  const handleScan = () => {
    if (scanning) return
    setScanning(true)
    setLog([])
    const es = new EventSource(`${window.location.protocol}//${window.location.hostname}:8000/api/emails/scan/stream`)
    es.addEventListener('progress', (e) => { const data = JSON.parse((e as MessageEvent).data); pushLine(data.message, 'progress') })
    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      pushLine(`✓ ${data.message}`, 'done')
      es.close(); setScanning(false); onScanComplete?.()
      setTimeout(() => window.location.reload(), 2000)
    })
    es.addEventListener('error', (e) => {
      try { const data = JSON.parse((e as MessageEvent).data); pushLine(`✗ ${data.message}`, 'error') } catch {}
      if ((e.target as EventSource).readyState === EventSource.CLOSED) { es.close(); setScanning(false) }
    })
  }

  const lastDone = log.filter(l => l.type === 'done').at(-1)

  return (
    <div>
      <p className="text-slate-400 text-[13px] mt-0 mb-4">
        Fetch new emails and calendar events right now. Sabino also scans automatically on the interval set above.
      </p>
      {!calendarSelected && (
        <div className="flex items-center gap-2 mb-4 px-3.5 py-3 bg-amber-50 border border-amber-300 rounded-lg">
          <span className="text-amber-500 shrink-0">⚠️</span>
          <p className="text-[13px] text-amber-800 m-0">Select a school calendar in the <strong>Calendar</strong> section above before scanning.</p>
        </div>
      )}
      <button
        className={`border-none rounded-lg px-5 py-2.5 font-semibold text-sm text-white min-h-[44px] ${scanning || !calendarSelected ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-500 cursor-pointer'}`}
        onClick={handleScan} disabled={scanning || !calendarSelected}
      >
        {scanning ? '⏳ Scanning…' : '🔄 Scan Now'}
      </button>

      {log.length > 0 && (
        <div className="mt-4 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="flex justify-between items-center px-3.5 py-2 border-b border-slate-800">
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-widest">Scan progress</span>
            {!scanning && (
              <button className="bg-none border-none text-slate-500 cursor-pointer text-[12px] p-0" onClick={() => setLog([])}>Clear</button>
            )}
          </div>
          <div className="max-h-[260px] overflow-y-auto px-3.5 py-2.5 font-mono text-[12px] leading-[1.8]" ref={logRef}>
            {log.map(line => (
              <div key={line.id} className={`flex gap-1.5 items-baseline ${line.type === 'done' ? 'text-emerald-400 font-semibold' : line.type === 'error' ? 'text-red-400 font-semibold' : 'text-slate-300'}`}>
                <span className="text-slate-600 shrink-0">›</span>
                {line.text}
              </div>
            ))}
            {scanning && <div className="text-blue-500 mt-1">▌</div>}
          </div>
          {!scanning && lastDone && (
            <div className="px-3.5 py-2 border-t border-slate-800 text-[12px] text-emerald-400 font-semibold font-mono">{lastDone.text}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const { status: scanStatus, refresh: refreshScanStatus } = useScanStatus()

  useEffect(() => {
    api.get<UserSettings>('/api/settings').then(r => setSettings(r.data))
  }, [])

  const save = async (updates: Partial<UserSettings>) => {
    const merged = { ...settings, ...updates } as UserSettings
    setSettings(merged)
    await api.put('/api/settings', updates)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) return <p>Loading settings...</p>

  const sectionClass = "bg-white border border-slate-200 rounded-xl p-6 mb-5"
  const labelClass = "block text-sm text-gray-700 font-medium mb-2 mt-4 first:mt-0"
  const inputClass = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-gray-700 outline-none focus:border-blue-400"
  const selectClass = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-gray-700 bg-white"
  const helpClass = "text-slate-400 text-[13px] mt-2"

  return (
    <div className="max-w-2xl">

      {/* My Child */}
      <section className={`${sectionClass} border-[#c9845e] bg-[#fdf6f0]`}>
        <h2 className="m-0 mb-4 text-[#7a3318] text-[17px] font-semibold">My Child</h2>
        <p className={`${helpClass} mt-0 mb-4`}>
          Tell Sabino which class your child is in so it can highlight what's most relevant to you.
        </p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className={labelClass}>Grade level</label>
            <select className={selectClass} value={settings.child_grade_level} onChange={e => save({ child_grade_level: e.target.value })}>
              {GRADE_LEVELS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className={labelClass}>Class code</label>
            <input className={inputClass} value={settings.child_class_code} placeholder="e.g. KHe, 1C, TKO" onChange={e => save({ child_class_code: e.target.value })} />
          </div>
        </div>
        <p className={helpClass}>
          The class code is shown as <strong>"posted in Kindergarten Helium (KHe)"</strong> in school emails. Enter just the code in parentheses (e.g. <code>KHe</code>).
        </p>
        {settings.child_class_code && (
          <div className="flex items-center gap-2.5 flex-wrap mt-3.5 px-3.5 py-2.5 bg-[#fde8d8] rounded-lg border border-[#c9845e]">
            <span className="text-[13px] text-[#7a3318] font-semibold shrink-0">Filtering as:</span>
            <span className="text-[13px] font-bold text-white bg-[#b94f1a] rounded-full px-3 py-0.5 shrink-0">
              {settings.child_grade_level || 'Grade'} · {settings.child_class_code}
            </span>
            <span className="text-[12px] text-[#92714a] flex-1">You'll see your class first, then grade-wide, then Lower School content.</span>
          </div>
        )}
      </section>

      {/* ParentSquare Session */}
      <section className={sectionClass}>
        <h2 className="m-0 mb-4 text-[#1e2a3a] text-[17px] font-semibold">ParentSquare Session</h2>
        <p className={`${helpClass} mt-0 mb-3`}>
          Paste your ParentSquare session cookie so Sabino can automatically download and analyze newsletter PDFs.
        </p>
        <label className={labelClass}><code>_ps_session</code> cookie value</label>
        <input
          className={`${inputClass} font-mono text-[12px]`}
          type="password"
          value={settings.ps_session_cookie}
          placeholder="Paste cookie value here…"
          onChange={e => save({ ps_session_cookie: e.target.value })}
        />
        <p className={helpClass}>
          <strong>Open parentsquare.com</strong> → DevTools (F12) → Application → Cookies → copy <code>_ps_session</code>.{' '}
          {settings.ps_session_cookie
            ? <span className="text-emerald-600 ml-2">✓ Cookie stored</span>
            : <span className="text-red-600 ml-2">Not set — PDF auto-load disabled</span>
          }
        </p>
      </section>

      {/* Google Account */}
      <section className={sectionClass}>
        <h2 className="m-0 mb-4 text-[#1e2a3a] text-[17px] font-semibold">Google Account</h2>
        <OAuthConnectButton />
        <p className={helpClass}>Connect your Google account to allow the app to read Gmail and Google Calendar.</p>
      </section>

      {/* Calendar */}
      <section className={sectionClass}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="m-0 text-[#1e2a3a] text-[17px] font-semibold">Calendar</h2>
          <LastScanBadge isoTimestamp={scanStatus.last_calendar_scan_at} />
        </div>
        <CalendarPicker settings={settings} onSave={save} />
      </section>

      {/* Email Scanning */}
      <section className={sectionClass}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="m-0 text-[#1e2a3a] text-[17px] font-semibold">Email Scanning</h2>
          <LastScanBadge isoTimestamp={scanStatus.last_email_scan_at} />
        </div>
        <label className={labelClass}>School sender domain (e.g. <code>school.edu</code>)</label>
        <input className={inputClass} value={settings.school_sender_domain} placeholder="school.edu" onChange={e => save({ school_sender_domain: e.target.value })} />
        <p className={helpClass}>Leave blank to scan all emails. Use your school's domain to filter.</p>
        <label className={labelClass}>Auto-scan interval</label>
        <select className={selectClass} value={settings.poll_interval_hours} onChange={e => save({ poll_interval_hours: e.target.value })}>
          <option value="1">Every 1 hour</option>
          <option value="3">Every 3 hours</option>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours</option>
          <option value="24">Every 24 hours</option>
        </select>
      </section>

      {/* Scan Now */}
      <section className={sectionClass}>
        <h2 className="m-0 mb-4 text-[#1e2a3a] text-[17px] font-semibold">Scan Now</h2>
        <ScanNowSection onScanComplete={refreshScanStatus} calendarSelected={!!settings.selected_calendar_id} />
      </section>

      {/* Reminders */}
      <section className={sectionClass}>
        <h2 className="m-0 mb-4 text-[#1e2a3a] text-[17px] font-semibold">Reminders</h2>
        <label className={labelClass}>Reminder channel</label>
        <select className={selectClass} value={settings.reminder_channel} onChange={e => save({ reminder_channel: e.target.value })}>
          <option value="browser">Browser notification</option>
          <option value="email">Email</option>
        </select>
        {settings.reminder_channel === 'email' && (
          <>
            <label className={labelClass}>Reminder email address</label>
            <input className={inputClass} type="email" value={settings.reminder_email_address} placeholder="parent@example.com" onChange={e => save({ reminder_email_address: e.target.value })} />
          </>
        )}
      </section>

      {/* School Feedback */}
      <section className={sectionClass}>
        <h2 className="m-0 mb-4 text-[#1e2a3a] text-[17px] font-semibold">School Feedback</h2>
        <label className={labelClass}>Short notice threshold (days)</label>
        <input
          className="w-20 border border-slate-200 rounded-lg px-3 py-2.5 text-[15px] text-gray-700 outline-none focus:border-blue-400"
          type="number" min={1} max={60}
          value={settings.short_notice_threshold_days}
          onChange={e => save({ short_notice_threshold_days: e.target.value })}
        />
        <p className={helpClass}>Action items with fewer than this many days of lead time will be flagged as short notice.</p>
      </section>

      {saved && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white rounded-xl px-5 py-2.5 font-semibold z-[400]">
          ✅ Settings saved
        </div>
      )}
    </div>
  )
}
