import type { Email } from '../../types'

interface Props {
  emails: Email[]
  selectedId: number | null
  onSelect: (id: number) => void
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function EmailList({ emails, selectedId, onSelect }: Props) {
  if (emails.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-slate-600">
        <p>No emails fetched yet.</p>
        <p className="text-slate-400 text-[13px]">Go to Settings → Scan Now to fetch school emails.</p>
      </div>
    )
  }

  return (
    <ul className="list-none m-0 p-0">
      {emails.map(email => (
        <li
          key={email.id}
          className={`px-4 py-3.5 cursor-pointer border-b border-slate-100 transition-colors ${
            selectedId === email.id ? 'bg-blue-50' : 'hover:bg-slate-50'
          }`}
          onClick={() => onSelect(email.id)}
        >
          <div className="font-semibold text-[14px] text-[#1e2a3a] mb-1">{email.subject || '(no subject)'}</div>
          <div className="flex justify-between mb-1.5">
            <span className="text-slate-500 text-[12px]">{email.sender || 'Unknown'}</span>
            <span className="text-slate-400 text-[12px]">{formatDate(email.received_at)}</span>
          </div>
          <div className="flex gap-1.5">
            {email.analyzed && (
              <span className="bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5 text-[11px]">✓ Analyzed</span>
            )}
            {email.action_items.length > 0 && (
              <span className="bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-[11px]">
                {email.action_items.length} action{email.action_items.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
