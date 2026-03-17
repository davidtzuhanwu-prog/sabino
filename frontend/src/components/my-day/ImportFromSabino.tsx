/**
 * Modal that shows today's Sabino ActionItems and lets the parent import them.
 */
import { useEffect, useState } from 'react'
import api from '../../api/client'
import type { ActionItem } from '../../types'

interface ImportFromSabinoProps {
  date: string
  onImport: () => void
  onCancel: () => void
}

export default function ImportFromSabino({ date, onImport, onCancel }: ImportFromSabinoProps) {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    api.get<ActionItem[]>('/api/action-items', { params: { event_date: date } })
      .then(r => setItems(r.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [date])

  async function handleImport() {
    setImporting(true)
    try {
      await api.post('/api/my-day/items/import', { date })
      onImport()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Add from School</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="text-gray-500 text-sm py-4 text-center">
              No Sabino items found for {date}.
            </p>
          )}
          {!loading && items.length > 0 && (
            <ul className="space-y-2">
              {items.map(item => (
                <li key={item.id} className="flex items-start gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-lg mt-0.5">📝</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 pb-5 pt-2 flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || items.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold text-sm hover:bg-orange-600 disabled:opacity-40"
          >
            {importing ? 'Importing…' : `Import ${items.length} item${items.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
