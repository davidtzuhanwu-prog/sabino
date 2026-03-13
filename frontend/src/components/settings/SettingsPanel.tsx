import { useEffect, useRef, useState, useCallback } from 'react'
import api from '../../api/client'
import OAuthConnectButton from '../auth/OAuthConnectButton'
import type { UserSettings, CalendarInfo } from '../../types'

// ── Scan status ──────────────────────────────────────────────────────────────

interface ScanStatus {
  scanning: boolean
  last_email_scan_at: string | null
  last_calendar_scan_at: string | null
}

function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus>({
    scanning: false,
    last_email_scan_at: null,
    last_calendar_scan_at: null,
  })

  const refresh = useCallback(() => {
    api.get<ScanStatus>('/api/emails/scan/status').then(r => setStatus(r.data)).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { status, refresh }
}

function LastScanBadge({ isoTimestamp }: { isoTimestamp: string | null }) {
  if (!isoTimestamp) {
    return <span style={scanBadgeStyles.never}>Never scanned</span>
  }

  // Backend stores UTC without 'Z'; ensure correct parsing
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

  const formatted = dt.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <span style={scanBadgeStyles.badge} title={`Last scanned at ${formatted}`}>
      🕐 Last scanned: <strong>{relative}</strong>
      <span style={scanBadgeStyles.abs}>&nbsp;({formatted})</span>
    </span>
  )
}

const scanBadgeStyles: Record<string, React.CSSProperties> = {
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: 12, color: '#475569',
    background: '#f1f5f9', borderRadius: 20,
    padding: '3px 10px', border: '1px solid #e2e8f0',
  },
  never: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 12, color: '#94a3b8',
    background: '#f8fafc', borderRadius: 20,
    padding: '3px 10px', border: '1px dashed #e2e8f0',
  },
  abs: { color: '#94a3b8', fontWeight: 400 },
}

function CalendarPicker({
  settings,
  onSave,
}: {
  settings: UserSettings
  onSave: (updates: Partial<UserSettings>) => void
}) {
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
    } catch {
      setFetched(true) // show empty state
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (id: string) => {
    // Save the selection, then clear stored events so next scan pulls from the new calendar
    onSave({ selected_calendar_id: id })
    setClearing(true)
    setClearMsg('')
    try {
      await api.delete('/api/calendar/events')
      setClearMsg('Calendar changed — existing events cleared. Run Scan Now to fetch from the new calendar.')
    } catch {
      setClearMsg('Calendar saved, but could not clear old events.')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div>
      <label style={calStyles.label}>Selected calendar</label>

      {!fetched ? (
        <button style={calStyles.loadBtn} onClick={fetchCalendars} disabled={loading}>
          {loading ? 'Loading calendars…' : '📅 Load my Google Calendars'}
        </button>
      ) : calendars.length === 0 ? (
        <p style={calStyles.empty}>No calendars found. Make sure your Google account is connected.</p>
      ) : (
        <div style={calStyles.list}>
          {calendars.map(cal => {
            const selected = settings.selected_calendar_id === cal.id ||
              (settings.selected_calendar_id === 'primary' && cal.primary)
            return (
              <button
                key={cal.id}
                style={{ ...calStyles.calRow, ...(selected ? calStyles.calRowSelected : {}) }}
                onClick={() => !selected && handleSelect(cal.id)}
                disabled={clearing}
              >
                <span style={{ ...calStyles.dot, background: cal.color }} />
                <span style={calStyles.calName}>
                  {cal.name}
                  {cal.primary && <span style={calStyles.primaryBadge}>primary</span>}
                </span>
                {selected && <span style={calStyles.checkmark}>✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {clearMsg && <p style={calStyles.clearMsg}>{clearMsg}</p>}
      <p style={calStyles.help}>
        Choose which calendar to pull events from. Changing this will clear stored events — use <strong>Scan Now</strong> below to repopulate.
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

interface LogLine {
  id: number
  text: string
  type: 'progress' | 'done' | 'error'
}

function ScanNowSection({ onScanComplete }: { onScanComplete?: () => void }) {
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const pushLine = (text: string, type: LogLine['type'] = 'progress') => {
    counterRef.current += 1
    setLog(prev => [...prev, { id: counterRef.current, text, type }])
  }

  const handleScan = () => {
    if (scanning) return
    setScanning(true)
    setLog([])

    const es = new EventSource('http://localhost:8000/api/emails/scan/stream')

    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      pushLine(data.message, 'progress')
    })

    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      pushLine(`✓ ${data.message}`, 'done')
      es.close()
      setScanning(false)
      onScanComplete?.()
      setTimeout(() => window.location.reload(), 2000)
    })

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        pushLine(`✗ ${data.message}`, 'error')
      } catch {
        // native SSE connection error (not our custom error event)
      }
      if ((e.target as EventSource).readyState === EventSource.CLOSED) {
        es.close()
        setScanning(false)
      }
    })
  }

  const lastDone = log.filter(l => l.type === 'done').at(-1)

  return (
    <div>
      <p style={{ ...styles.help, marginTop: 0, marginBottom: 16 }}>
        Fetch new emails and calendar events right now. Sabino also scans automatically on the
        interval set above.
      </p>

      <button
        style={{ ...scanStyles.btn, ...(scanning ? scanStyles.btnDisabled : {}) }}
        onClick={handleScan}
        disabled={scanning}
      >
        {scanning ? '⏳ Scanning…' : '🔄 Scan Now'}
      </button>

      {log.length > 0 && (
        <div style={scanStyles.logPanel}>
          <div style={scanStyles.logHeader}>
            <span style={scanStyles.logTitle}>Scan progress</span>
            {!scanning && (
              <button style={scanStyles.clearBtn} onClick={() => setLog([])}>Clear</button>
            )}
          </div>
          <div style={scanStyles.logBody} ref={logRef}>
            {log.map(line => (
              <div key={line.id} style={{ ...scanStyles.logLine, ...scanLogLineStyle[line.type] }}>
                <span style={scanStyles.logDot}>›</span>
                {line.text}
              </div>
            ))}
            {scanning && <div style={scanStyles.cursor}>▌</div>}
          </div>
          {!scanning && lastDone && (
            <div style={scanStyles.logFooter}>{lastDone.text}</div>
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

  return (
    <div style={styles.container}>

      {/* ── My Child ──────────────────────────────────────────────────────── */}
      <section style={{ ...styles.section, borderColor: '#c9845e', background: '#fdf6f0' }}>
        <h2 style={{ ...styles.sectionTitle, color: '#7a3318' }}>My Child</h2>
        <p style={{ ...styles.help, marginTop: 0, marginBottom: 16 }}>
          Tell Sabino which class your child is in so it can highlight what's most relevant to you
          and de-emphasise content meant for other grades.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={styles.label}>Grade level</label>
            <select
              style={styles.select}
              value={settings.child_grade_level}
              onChange={e => save({ child_grade_level: e.target.value })}
            >
              {GRADE_LEVELS.map(g => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 180px' }}>
            <label style={styles.label}>Class code</label>
            <input
              style={styles.input}
              value={settings.child_class_code}
              placeholder="e.g. KHe, 1C, TKO"
              onChange={e => save({ child_class_code: e.target.value })}
            />
          </div>
        </div>

        <p style={{ ...styles.help, marginTop: 12 }}>
          The class code is the short group name used in ParentSquare — shown as
          {' '}<strong>"[Name] posted in Kindergarten Helium (KHe)"</strong>{' '}
          at the top of school emails. Enter just the code in parentheses (e.g. <code>KHe</code>).
        </p>

        {settings.child_class_code && (
          <div style={childStyles.previewRow}>
            <span style={childStyles.previewLabel}>Filtering as:</span>
            <span style={childStyles.previewBadge}>
              {settings.child_grade_level || 'Grade'} · {settings.child_class_code}
            </span>
            <span style={childStyles.previewNote}>
              You'll see your class first, then grade-wide, then Lower School content.
              Upper School content will be collapsed.
            </span>
          </div>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Google Account</h2>
        <OAuthConnectButton />
        <p style={styles.help}>
          Connect your Google account to allow the app to read your Gmail and Google Calendar.
        </p>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitleNoMargin}>Calendar</h2>
          <LastScanBadge isoTimestamp={scanStatus.last_calendar_scan_at} />
        </div>
        <CalendarPicker settings={settings} onSave={save} />
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitleNoMargin}>Email Scanning</h2>
          <LastScanBadge isoTimestamp={scanStatus.last_email_scan_at} />
        </div>
        <label style={styles.label}>School sender domain (e.g. <code>school.edu</code>)</label>
        <input
          style={styles.input}
          value={settings.school_sender_domain}
          placeholder="school.edu"
          onChange={e => save({ school_sender_domain: e.target.value })}
        />
        <p style={styles.help}>Leave blank to scan all emails. Use your school's domain to filter.</p>

        <label style={styles.label}>Auto-scan interval</label>
        <select
          style={styles.select}
          value={settings.poll_interval_hours}
          onChange={e => save({ poll_interval_hours: e.target.value })}
        >
          <option value="1">Every 1 hour</option>
          <option value="3">Every 3 hours</option>
          <option value="6">Every 6 hours</option>
          <option value="12">Every 12 hours</option>
          <option value="24">Every 24 hours</option>
        </select>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Scan Now</h2>
        <ScanNowSection onScanComplete={refreshScanStatus} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Reminders</h2>
        <label style={styles.label}>Reminder channel</label>
        <select
          style={styles.select}
          value={settings.reminder_channel}
          onChange={e => save({ reminder_channel: e.target.value })}
        >
          <option value="browser">Browser notification</option>
          <option value="email">Email</option>
        </select>

        {settings.reminder_channel === 'email' && (
          <>
            <label style={styles.label}>Reminder email address</label>
            <input
              style={styles.input}
              type="email"
              value={settings.reminder_email_address}
              placeholder="parent@example.com"
              onChange={e => save({ reminder_email_address: e.target.value })}
            />
          </>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>School Feedback</h2>
        <label style={styles.label}>Short notice threshold (days)</label>
        <input
          style={{ ...styles.input, width: 80 }}
          type="number"
          min={1}
          max={60}
          value={settings.short_notice_threshold_days}
          onChange={e => save({ short_notice_threshold_days: e.target.value })}
        />
        <p style={styles.help}>
          Action items with fewer than this many days of lead time will be flagged as short notice.
        </p>
      </section>

      {saved && <div style={styles.savedBadge}>✅ Settings saved</div>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 640 },
  section: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '24px', marginBottom: 20 },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  sectionTitle: { margin: '0 0 16px', color: '#1e2a3a', fontSize: 17 },
  sectionTitleNoMargin: { margin: 0, color: '#1e2a3a', fontSize: 17 },
  label: { display: 'block', color: '#374151', fontSize: 14, fontWeight: 500, marginBottom: 8, marginTop: 16 },
  input: {
    width: '100%', boxSizing: 'border-box', border: '1px solid #e2e8f0',
    borderRadius: 8, padding: '10px 12px', fontSize: 15, color: '#374151', outline: 'none',
  },
  select: {
    border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px',
    fontSize: 15, color: '#374151', background: '#fff', width: '100%',
  },
  help: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
  savedBadge: {
    position: 'fixed', bottom: 24, right: 24,
    background: '#059669', color: '#fff', borderRadius: 10,
    padding: '10px 20px', fontWeight: 600,
  },
}

const childStyles: Record<string, React.CSSProperties> = {
  previewRow: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    marginTop: 14, padding: '10px 14px',
    background: '#fde8d8', borderRadius: 8, border: '1px solid #c9845e',
  },
  previewLabel: { fontSize: 13, color: '#7a3318', fontWeight: 600, flexShrink: 0 },
  previewBadge: {
    fontSize: 13, fontWeight: 700, color: '#fff',
    background: '#b94f1a', borderRadius: 20, padding: '2px 12px', flexShrink: 0,
  },
  previewNote: { fontSize: 12, color: '#92714a', flex: 1 },
}

const calStyles: Record<string, React.CSSProperties> = {
  label: { display: 'block', color: '#374151', fontSize: 14, fontWeight: 500, marginBottom: 10 },
  loadBtn: {
    border: '1px solid #c7d9f5', borderRadius: 8, padding: '9px 16px',
    background: '#f0f7ff', color: '#2563eb', fontWeight: 500, fontSize: 14,
    cursor: 'pointer',
  },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  calRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px',
    background: '#fff', cursor: 'pointer', textAlign: 'left' as const,
    fontSize: 14, color: '#374151', transition: 'border-color 0.15s',
  },
  calRowSelected: {
    border: '1.5px solid #3b82f6', background: '#eff6ff',
  },
  dot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  calName: { flex: 1, display: 'flex', alignItems: 'center', gap: 8 },
  primaryBadge: {
    fontSize: 11, background: '#e2e8f0', color: '#64748b',
    borderRadius: 10, padding: '1px 7px', fontWeight: 500,
  },
  checkmark: { color: '#3b82f6', fontWeight: 700, fontSize: 15 },
  clearMsg: { fontSize: 13, color: '#059669', marginTop: 10 },
  empty: { color: '#94a3b8', fontSize: 14 },
  help: { color: '#94a3b8', fontSize: 13, marginTop: 10 },
}

const scanStyles: Record<string, React.CSSProperties> = {
  btn: {
    background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnDisabled: { background: '#94a3b8', cursor: 'not-allowed' },
  logPanel: {
    marginTop: 16, background: '#0f172a', borderRadius: 10,
    border: '1px solid #1e293b', overflow: 'hidden',
  },
  logHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 14px', borderBottom: '1px solid #1e293b',
  },
  logTitle: {
    color: '#94a3b8', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  },
  clearBtn: {
    background: 'none', border: 'none', color: '#475569',
    cursor: 'pointer', fontSize: 12, padding: 0,
  },
  logBody: {
    maxHeight: 260, overflowY: 'auto' as const, padding: '10px 14px',
    fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.8,
  },
  logLine: { display: 'flex', gap: 6, alignItems: 'baseline' },
  logDot: { color: '#334155', flexShrink: 0 },
  cursor: { color: '#3b82f6', marginTop: 4 },
  logFooter: {
    padding: '8px 14px', borderTop: '1px solid #1e293b',
    fontSize: 12, color: '#34d399', fontWeight: 600,
    fontFamily: 'ui-monospace, monospace',
  },
}

const scanLogLineStyle: Record<string, React.CSSProperties> = {
  done: { color: '#34d399', fontWeight: 600 },
  error: { color: '#f87171', fontWeight: 600 },
  progress: { color: '#cbd5e1' },
}
