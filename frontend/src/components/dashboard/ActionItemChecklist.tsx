import { useEffect, useState } from 'react'
import { useActionItems } from '../../hooks/useActionItems'
import ActionItemCard from './ActionItemCard'

export default function ActionItemChecklist() {
  const { items, loading, fetchItems, toggleComplete, deleteItem } = useActionItems()
  const [showCompleted, setShowCompleted] = useState(false)
  const [shortNoticeOnly, setShortNoticeOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'event_date' | 'prep_start_date' | 'created_at'>('event_date')

  useEffect(() => {
    fetchItems({
      completed: showCompleted ? undefined : false,
      is_short_notice: shortNoticeOnly ? true : undefined,
      sort_by: sortBy,
      order: 'asc',
    })
  }, [showCompleted, shortNoticeOnly, sortBy, fetchItems])

  return (
    <div>
      <div className="flex gap-4 items-center mb-5 flex-wrap">
        <label className="flex items-center gap-1.5 text-slate-600 text-sm cursor-pointer">
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
          {' '}Show completed
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 text-sm cursor-pointer">
          <input type="checkbox" checked={shortNoticeOnly} onChange={e => setShortNoticeOnly(e.target.checked)} />
          {' '}Short notice only
        </label>
        <select
          className="border border-slate-200 rounded-md px-2.5 py-1.5 text-sm text-gray-700 bg-white"
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="event_date">Sort by event date</option>
          <option value="prep_start_date">Sort by prep date</option>
          <option value="created_at">Sort by created</option>
        </select>
      </div>

      {loading && <p className="text-slate-400 text-center py-10">Loading...</p>}
      {!loading && items.length === 0 && (
        <div className="text-center py-16 text-slate-600">
          <p>No action items found.</p>
          <p className="text-slate-400 text-sm mt-1">
            Connect your Google account and go to Settings → Scan Now to fetch school communications.
          </p>
        </div>
      )}
      {items.map(item => (
        <ActionItemCard
          key={item.id}
          item={item}
          onToggle={toggleComplete}
          onDelete={deleteItem}
        />
      ))}
    </div>
  )
}
