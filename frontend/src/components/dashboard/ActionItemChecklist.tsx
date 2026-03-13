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
      <div style={styles.controls}>
        <label style={styles.label}>
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
          {' '}Show completed
        </label>
        <label style={styles.label}>
          <input type="checkbox" checked={shortNoticeOnly} onChange={e => setShortNoticeOnly(e.target.checked)} />
          {' '}Short notice only
        </label>
        <select
          style={styles.select}
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="event_date">Sort by event date</option>
          <option value="prep_start_date">Sort by prep date</option>
          <option value="created_at">Sort by created</option>
        </select>
      </div>

      {loading && <p style={styles.msg}>Loading...</p>}
      {!loading && items.length === 0 && (
        <div style={styles.empty}>
          <p>No action items found.</p>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
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

const styles: Record<string, React.CSSProperties> = {
  controls: { display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' },
  label: { display: 'flex', alignItems: 'center', gap: 6, color: '#475569', fontSize: 14, cursor: 'pointer' },
  select: { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 14, color: '#374151', background: '#fff' },
  msg: { color: '#94a3b8', textAlign: 'center', padding: 40 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#475569' },
}
