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
  // Mobile: 'list' shows the list, 'detail' shows selected email
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
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

  const handleMobileSelect = (id: number) => {
    setSelectedId(id)
    setMobileView('detail')
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
    <div className="h-full flex flex-col">

      {/* ── MOBILE layout (< md) ── */}
      <div className="flex md:hidden flex-1 flex-col">
        {mobileView === 'list' ? (
          <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden">
            {loading
              ? <p className="p-5 text-slate-400 text-center">Loading...</p>
              : <EmailList emails={emails} selectedId={selectedId} onSelect={handleMobileSelect} />
            }
          </div>
        ) : (
          <div className="flex-1 flex flex-col border border-slate-200 rounded-xl overflow-hidden">
            <button
              className="flex items-center gap-2 px-4 py-3 text-sm text-blue-600 font-medium border-b border-slate-100 bg-white shrink-0 min-h-[44px]"
              onClick={() => setMobileView('list')}
            >
              ← Back to inbox
            </button>
            <div className="flex-1 overflow-auto">
              {selected
                ? <EmailDetail key={selected.id} email={selected} onToggle={handleToggle} onDelete={handleDelete} />
                : <div className="flex items-center justify-center h-full text-slate-400">No email selected</div>
              }
            </div>
          </div>
        )}
      </div>

      {/* ── DESKTOP layout (md+): two-pane with draggable divider ── */}
      <div className="hidden md:flex flex-1 border border-slate-200 rounded-xl overflow-hidden">
        <div className="shrink-0 overflow-auto" style={{ width: listWidth }}>
          {loading
            ? <p className="p-5 text-slate-400 text-center">Loading...</p>
            : <EmailList emails={emails} selectedId={selectedId} onSelect={setSelectedId} />
          }
        </div>

        {/* Draggable divider */}
        <div
          className="w-[5px] shrink-0 cursor-col-resize bg-transparent relative flex items-center justify-center"
          onMouseDown={onDividerMouseDown}
          onMouseEnter={() => setDividerHover(true)}
          onMouseLeave={() => setDividerHover(false)}
        >
          <div
            className={`h-full pointer-events-none transition-all ${dividerHover ? 'w-[3px] bg-blue-300' : 'w-px bg-slate-200'}`}
          />
        </div>

        <div className="flex-1 overflow-auto min-w-0">
          {selected
            ? <EmailDetail key={selected.id} email={selected} onToggle={handleToggle} onDelete={handleDelete} />
            : <div className="flex items-center justify-center h-full text-slate-400">Select an email to view details</div>
          }
        </div>
      </div>

    </div>
  )
}
