import type { ActionItem } from '../../types'

interface Props {
  item: ActionItem
  onToggle: (id: number, completed: boolean) => void
  onDelete: (id: number) => void
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export default function ActionItemCard({ item, onToggle, onDelete }: Props) {
  const eventDays = daysUntil(item.event_date)
  const prepDays = daysUntil(item.prep_start_date)

  const urgencyBg = item.completed
    ? 'bg-slate-50'
    : eventDays !== null
      ? eventDays <= 3 ? 'bg-red-50' : eventDays <= 7 ? 'bg-yellow-50' : 'bg-green-50'
      : 'bg-slate-50'

  return (
    <div className={`border border-slate-200 rounded-xl px-5 py-4 mb-3 transition-all ${urgencyBg} ${item.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.completed}
          onChange={e => onToggle(item.id, e.target.checked)}
          className="mt-1 w-[18px] h-[18px] cursor-pointer accent-blue-500 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <span className={`font-semibold text-base text-[#1e2a3a] block mb-2 ${item.completed ? 'line-through text-slate-400' : ''}`}>
            {item.title}
          </span>

          <div className="flex flex-wrap gap-2 mb-2">
            {item.event_date && (
              <span className="bg-blue-100 text-blue-700 rounded-md px-2.5 py-0.5 text-[13px] font-medium">
                📅 {formatDate(item.event_date)}
                {eventDays !== null && eventDays >= 0 && (
                  <span className="text-blue-700"> ({eventDays}d)</span>
                )}
              </span>
            )}
            {item.prep_start_date && !item.completed && (
              <span className={`rounded-md px-2.5 py-0.5 text-[13px] font-medium ${
                prepDays !== null && prepDays <= 0
                  ? 'bg-red-100 text-red-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}>
                🗓 Start prep: {formatDate(item.prep_start_date)}
                {prepDays !== null && prepDays <= 0 && <span> (overdue!)</span>}
              </span>
            )}
            {item.is_short_notice && (
              <span className="bg-amber-100 text-amber-800 rounded-md px-2.5 py-0.5 text-[13px] font-semibold">⚠️ Short notice</span>
            )}
            <span className="bg-slate-100 text-slate-500 rounded-md px-2.5 py-0.5 text-[12px]">{item.source_type}</span>
          </div>

          {item.description && !item.completed && (
            <p className="text-slate-600 text-[14px] mt-1 leading-relaxed m-0">{item.description}</p>
          )}

          {item.is_short_notice && item.short_notice_note && (
            <p className="text-amber-700 text-[13px] mt-1.5 italic m-0">⚠️ {item.short_notice_note}</p>
          )}
        </div>
        <button
          className="bg-transparent border-none text-slate-300 hover:text-red-400 cursor-pointer text-base px-1 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
          onClick={() => onDelete(item.id)}
          title="Delete"
        >✕</button>
      </div>
    </div>
  )
}
