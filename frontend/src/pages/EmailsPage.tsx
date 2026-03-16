import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../api/client'
import EmailList from '../components/emails/EmailList'
import EmailDetail from '../components/emails/EmailDetail'
import type { Email } from '../types'

const MIN_LIST_WIDTH = 200
const MAX_LIST_WIDTH = 600
const DEFAULT_LIST_WIDTH = 320

export default function EmailsPage() {
  const location = useLocation()
  const initialEmailId: number | null = (location.state as any)?.emailId ?? null

  const [emails, setEmails] = useState<Email[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const [dividerHover, setDividerHover] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_LIST_WIDTH)

  useEffect(() => {
    api.get<Email[]>('/api/emails', { params: { limit: 100 } })
      .then(r => {
        setEmails(r.data)
        if (r.data.length > 0) {
          const target = initialEmailId && r.data.find(e => e.id === initialEmailId)
          setSelectedId(target ? target.id : r.data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = emails.find(e => e.id === selectedId) || null

  const handleToggle = (id: number, completed: boolean) => {
    api.patch(`/api/action-items/${id}`, { completed })
      .then(() => {
        setEmails(prev => prev.map(e => ({
          ...e,
          action_items: e.action_items.map(a => a.id === id ? { ...a, completed } : a),
        })))
      })
  }

  const handleDelete = (id: number) => {
    api.delete(`/api/action-items/${id}`)
      .then(() => {
        setEmails(prev => prev.map(e => ({
          ...e,
          action_items: e.action_items.filter(a => a.id !== id),
        })))
      })
  }

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = listWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      setListWidth(Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, startWidth.current + delta)))
    }

    const onMouseUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [listWidth])

  return (
    <div style={styles.container}>
      <div style={styles.layout}>
        <div style={{ ...styles.list, width: listWidth }}>
          {loading ? <p style={styles.msg}>Loading...</p> : (
            <EmailList emails={emails} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        {/* Draggable divider */}
        <div
          style={styles.divider}
          onMouseDown={onDividerMouseDown}
          onMouseEnter={() => setDividerHover(true)}
          onMouseLeave={() => setDividerHover(false)}
        >
          <div style={{
            ...styles.dividerHandle,
            ...(dividerHover ? styles.dividerHandleActive : {}),
          }} />
        </div>

        <div style={styles.detail}>
          {selected ? (
            <EmailDetail key={selected.id} email={selected} onToggle={handleToggle} onDelete={handleDelete} />
          ) : (
            <div style={styles.empty}>Select an email to view details</div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100%', display: 'flex', flexDirection: 'column' },
  layout: { display: 'flex', flex: 1, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' },
  list: { flexShrink: 0, overflow: 'auto' },
  divider: {
    width: 5, flexShrink: 0, cursor: 'col-resize',
    background: 'transparent', position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dividerHandle: {
    width: 1, height: '100%',
    background: '#e2e8f0',
    transition: 'background 0.15s, width 0.15s',
    pointerEvents: 'none',
  },
  dividerHandleActive: {
    width: 3,
    background: '#93c5fd',
  },
  detail: { flex: 1, overflow: 'auto', minWidth: 0 },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' },
  msg: { padding: 20, color: '#94a3b8', textAlign: 'center' },
}
