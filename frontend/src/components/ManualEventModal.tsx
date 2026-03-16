import { useState, useEffect, useRef } from 'react'
import api from '../api/client'
import type { ActionItem, EventGroup } from '../types'

// ── Item type options shown to the parent ─────────────────────────────────────

const ITEM_TYPE_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: '', label: 'General / unspecified', emoji: '📌' },
  { value: 'attendance', label: 'Attendance / show up', emoji: '🏫' },
  { value: 'bring_item', label: 'Bring something', emoji: '🎒' },
  { value: 'permission_slip', label: 'Permission slip / form', emoji: '📝' },
  { value: 'payment', label: 'Payment / fee', emoji: '💰' },
  { value: 'homework_special_project', label: 'Special project / performance', emoji: '⭐' },
  { value: 'homework_poem', label: 'Poem recitation', emoji: '🎤' },
  { value: 'homework_spelling', label: 'Spelling / word study', emoji: '🔤' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface AddNewEventProps {
  mode: 'new_event'
  initialDate?: string | null   // YYYY-MM-DD pre-fill from calendar click
  onSaved: (group: EventGroup) => void
  onClose: () => void
}

interface AddActionProps {
  mode: 'add_action'
  targetGroup: EventGroup       // existing group to attach the new action to
  onSaved: (item: ActionItem) => void
  onClose: () => void
}

interface EditActionProps {
  mode: 'edit_action'
  item: ActionItem              // manual item to edit
  onSaved: (item: ActionItem) => void
  onClose: () => void
}

type ManualEventModalProps = AddNewEventProps | AddActionProps | EditActionProps

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function ManualEventModal(props: ManualEventModalProps) {
  const { mode, onClose } = props

  // Shared fields
  const [title, setTitle] = useState(() => {
    if (mode === 'edit_action') return props.item.title
    return ''
  })
  const [description, setDescription] = useState(() => {
    if (mode === 'edit_action') return props.item.description ?? ''
    return ''
  })
  const [eventDate, setEventDate] = useState(() => {
    if (mode === 'new_event') return props.initialDate ?? ''
    if (mode === 'edit_action') return props.item.event_date ?? ''
    if (mode === 'add_action') return props.targetGroup.event_date ?? ''
    return ''
  })
  const [prepDate, setPrepDate] = useState(() => {
    if (mode === 'edit_action') return props.item.prep_start_date ?? ''
    return ''
  })
  const [itemType, setItemType] = useState(() => {
    if (mode === 'edit_action') return props.item.item_type ?? ''
    return ''
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSave() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'new_event') {
        const res = await api.post<EventGroup>('/api/event-groups', {
          title: title.trim(),
          description: description.trim() || null,
          event_date: eventDate || null,
          prep_start_date: prepDate || null,
          item_type: itemType || null,
        })
        props.onSaved(res.data)
      } else if (mode === 'add_action') {
        const res = await api.post<ActionItem>('/api/action-items', {
          source_type: 'manual',
          event_group_id: props.targetGroup.id,
          title: title.trim(),
          description: description.trim() || null,
          event_date: eventDate || props.targetGroup.event_date || null,
          prep_start_date: prepDate || null,
          item_type: itemType || null,
        })
        props.onSaved(res.data)
      } else if (mode === 'edit_action') {
        const res = await api.patch<ActionItem>(`/api/action-items/${props.item.id}`, {
          title: title.trim(),
          description: description.trim() || null,
          event_date: eventDate || null,
          prep_start_date: prepDate || null,
          item_type: itemType || null,
        })
        props.onSaved(res.data)
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to save — please try again')
      setSaving(false)
    }
  }

  const heading =
    mode === 'new_event' ? 'Add event'
    : mode === 'add_action' ? `Add action to "${props.targetGroup.display_name}"`
    : `Edit action`

  return (
    // Backdrop
    <div style={ms.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={ms.modal} role="dialog" aria-modal="true" aria-label={heading}>
        {/* Header */}
        <div style={ms.header}>
          <span style={ms.heading}>{heading}</span>
          <button style={ms.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {mode === 'add_action' && (
          <div style={ms.contextNote}>
            ✏️ Added manually · will appear alongside AI-extracted actions
          </div>
        )}

        {/* Form */}
        <div style={ms.body}>
          {/* Title */}
          <label style={ms.label}>
            {mode === 'add_action' ? 'Action' : 'Event name'} <span style={ms.required}>*</span>
          </label>
          <input
            ref={titleRef}
            style={ms.input}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={mode === 'add_action' ? 'e.g. Bring green shirt' : 'e.g. Clovers & Compliments'}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />

          {/* Description */}
          <label style={ms.label}>Notes <span style={ms.optional}>(optional)</span></label>
          <textarea
            style={ms.textarea}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Any extra context — what the child said, what to bring, etc."
            rows={2}
          />

          {/* Date row */}
          <div style={ms.row}>
            <div style={{ flex: 1 }}>
              <label style={ms.label}>
                {mode === 'add_action' ? 'Date' : 'Event date'} <span style={ms.optional}>(optional)</span>
              </label>
              <input
                type="date"
                style={ms.input}
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ms.label}>Prep start <span style={ms.optional}>(optional)</span></label>
              <input
                type="date"
                style={ms.input}
                value={prepDate}
                onChange={e => setPrepDate(e.target.value)}
                max={eventDate || undefined}
              />
            </div>
          </div>

          {/* Item type */}
          <label style={ms.label}>Type <span style={ms.optional}>(optional)</span></label>
          <div style={ms.typeGrid}>
            {ITEM_TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                style={{
                  ...ms.typeBtn,
                  ...(itemType === opt.value ? ms.typeBtnActive : {}),
                }}
                onClick={() => setItemType(opt.value)}
              >
                <span style={ms.typeEmoji}>{opt.emoji}</span>
                <span style={ms.typeLabel}>{opt.label}</span>
              </button>
            ))}
          </div>

          {error && <div style={ms.errorBox}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={ms.footer}>
          <button style={ms.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={ms.saveBtn} onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : mode === 'edit_action' ? 'Save changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ms: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  },
  modal: {
    background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column', maxHeight: '90vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid #f1f5f9',
  },
  heading: { fontWeight: 700, fontSize: 16, color: '#1e2a3a' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 16, color: '#94a3b8', padding: '2px 6px', borderRadius: 6,
  },
  contextNote: {
    fontSize: 12, color: '#7c6050', background: '#fff7ed',
    padding: '6px 20px', borderBottom: '1px solid #fed7aa',
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#475569',
    marginBottom: 4, marginTop: 12,
  },
  required: { color: '#ef4444' },
  optional: { fontWeight: 400, color: '#94a3b8' },
  input: {
    width: '100%', boxSizing: 'border-box' as const,
    border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
    fontSize: 14, color: '#1e2a3a', background: '#f8fafc',
    outline: 'none',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box' as const,
    border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
    fontSize: 13, color: '#374151', background: '#f8fafc',
    resize: 'vertical' as const, fontFamily: 'inherit', outline: 'none',
  },
  row: { display: 'flex', gap: 12 },
  typeGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
    marginTop: 2,
  },
  typeBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid #e2e8f0', background: '#f8fafc',
    textAlign: 'left' as const, fontSize: 12, color: '#374151',
    transition: 'all 0.1s',
  },
  typeBtnActive: {
    border: '1.5px solid #b94f1a', background: '#fff7ed', color: '#7a1a00',
    fontWeight: 600,
  },
  typeEmoji: { fontSize: 14, flexShrink: 0 },
  typeLabel: { lineHeight: 1.3 },
  errorBox: {
    marginTop: 10, padding: '8px 12px', background: '#fef2f2',
    border: '1px solid #fecaca', borderRadius: 8,
    fontSize: 13, color: '#dc2626',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '12px 20px', borderTop: '1px solid #f1f5f9',
    background: '#fafafa',
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, color: '#374151',
  },
  saveBtn: {
    padding: '8px 20px', borderRadius: 8, cursor: 'pointer',
    border: 'none', background: '#b94f1a', color: '#fff',
    fontSize: 14, fontWeight: 600,
    opacity: 1,
  },
}
