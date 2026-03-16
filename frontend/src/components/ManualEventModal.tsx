import { useState, useEffect, useRef } from 'react'
import api from '../api/client'
import type { ActionItem, EventGroup } from '../types'

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

interface AddNewEventProps {
  mode: 'new_event'
  initialDate?: string | null
  onSaved: (group: EventGroup) => void
  onClose: () => void
}

interface AddActionProps {
  mode: 'add_action'
  targetGroup: EventGroup
  onSaved: (item: ActionItem) => void
  onClose: () => void
}

interface EditActionProps {
  mode: 'edit_action'
  item: ActionItem
  onSaved: (item: ActionItem) => void
  onClose: () => void
}

type ManualEventModalProps = AddNewEventProps | AddActionProps | EditActionProps

export default function ManualEventModal(props: ManualEventModalProps) {
  const { mode, onClose } = props

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

  useEffect(() => { titleRef.current?.focus() }, [])

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
          title: title.trim(), description: description.trim() || null,
          event_date: eventDate || null, prep_start_date: prepDate || null, item_type: itemType || null,
        })
        props.onSaved(res.data)
      } else if (mode === 'add_action') {
        const res = await api.post<ActionItem>('/api/action-items', {
          source_type: 'manual', event_group_id: props.targetGroup.id,
          title: title.trim(), description: description.trim() || null,
          event_date: eventDate || props.targetGroup.event_date || null,
          prep_start_date: prepDate || null, item_type: itemType || null,
        })
        props.onSaved(res.data)
      } else if (mode === 'edit_action') {
        const res = await api.patch<ActionItem>(`/api/action-items/${props.item.id}`, {
          title: title.trim(), description: description.trim() || null,
          event_date: eventDate || null, prep_start_date: prepDate || null, item_type: itemType || null,
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
    : 'Edit action'

  return (
    <div
      className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000] p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[520px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        role="dialog" aria-modal="true" aria-label={heading}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <span className="font-bold text-base text-[#1e2a3a]">{heading}</span>
          <button
            className="bg-transparent border-none cursor-pointer text-base text-slate-400 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md"
            onClick={onClose} aria-label="Close"
          >✕</button>
        </div>

        {mode === 'add_action' && (
          <div className="text-[12px] text-[#7c6050] bg-orange-50 px-5 py-1.5 border-b border-orange-200">
            ✏️ Added manually · will appear alongside AI-extracted actions
          </div>
        )}

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <label className="block text-[12px] font-semibold text-slate-600 mb-1 mt-3 first:mt-0">
            {mode === 'add_action' ? 'Action' : 'Event name'}{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            ref={titleRef}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-[#1e2a3a] bg-slate-50 outline-none focus:border-blue-400 focus:bg-white"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={mode === 'add_action' ? 'e.g. Bring green shirt' : 'e.g. Clovers & Compliments'}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />

          <label className="block text-[12px] font-semibold text-slate-600 mb-1 mt-3">
            Notes <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 bg-slate-50 resize-y font-[inherit] outline-none focus:border-blue-400 focus:bg-white"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Any extra context — what the child said, what to bring, etc."
            rows={2}
          />

          <div className="flex gap-3 flex-col sm:flex-row">
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1 mt-3">
                {mode === 'add_action' ? 'Date' : 'Event date'}{' '}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-[#1e2a3a] bg-slate-50 outline-none focus:border-blue-400"
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1 mt-3">
                Prep start <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-[#1e2a3a] bg-slate-50 outline-none focus:border-blue-400"
                value={prepDate}
                onChange={e => setPrepDate(e.target.value)}
                max={eventDate || undefined}
              />
            </div>
          </div>

          <label className="block text-[12px] font-semibold text-slate-600 mb-1 mt-3">
            Type <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-0.5">
            {ITEM_TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-left text-[12px] transition-all min-h-[44px] ${
                  itemType === opt.value
                    ? 'border-[1.5px] border-orange-700 bg-orange-50 text-orange-900 font-semibold'
                    : 'border border-slate-200 bg-slate-50 text-gray-700'
                }`}
                onClick={() => setItemType(opt.value)}
              >
                <span className="text-sm shrink-0">{opt.emoji}</span>
                <span className="leading-tight">{opt.label}</span>
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-2.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 px-5 py-3 border-t border-slate-100 bg-slate-50">
          <button
            className="px-4 py-2 rounded-lg cursor-pointer border border-slate-200 bg-white text-sm text-gray-700 min-h-[44px]"
            onClick={onClose} disabled={saving}
          >Cancel</button>
          <button
            className="px-5 py-2 rounded-lg cursor-pointer border-none bg-[#b94f1a] text-white text-sm font-semibold disabled:opacity-50 min-h-[44px]"
            onClick={handleSave} disabled={saving || !title.trim()}
          >
            {saving ? 'Saving…' : mode === 'edit_action' ? 'Save changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
