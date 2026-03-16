import { useEffect, useState } from 'react'
import api from '../api/client'
import ActionItemChecklist from '../components/dashboard/ActionItemChecklist'
import PrepTimeline from '../components/dashboard/PrepTimeline'
import type { ActionItem } from '../types'

function SummaryCards() {
  const [all, setAll] = useState<ActionItem[]>([])
  const [upcoming, setUpcoming] = useState<ActionItem[]>([])
  const [shortNotice, setShortNotice] = useState<ActionItem[]>([])

  useEffect(() => {
    api.get<ActionItem[]>('/api/action-items', { params: { completed: false, limit: 500 }, silent: true })
      .then(r => setAll(r.data)).catch(() => {})
    api.get<ActionItem[]>('/api/action-items/upcoming', { params: { days: 14 }, silent: true })
      .then(r => setUpcoming(r.data)).catch(() => {})
    api.get<ActionItem[]>('/api/action-items/short-notice', { silent: true })
      .then(r => setShortNotice(r.data)).catch(() => {})
  }, [])

  const cards = [
    { label: 'Pending Actions', value: all.length, valueColor: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Due in 14 Days', value: upcoming.length, valueColor: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Short Notice', value: shortNotice.length, valueColor: 'text-red-500', bg: 'bg-red-50' },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {cards.map(c => (
        <div key={c.label} className={`${c.bg} rounded-xl px-6 py-5 flex flex-col gap-1.5`}>
          <span className={`${c.valueColor} text-4xl font-bold`}>{c.value}</span>
          <span className="text-slate-500 text-sm font-medium">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <SummaryCards />
      <PrepTimeline />
      <h2 className="m-0 mb-4 text-gray-700 text-[19px]">All Action Items</h2>
      <ActionItemChecklist />
    </div>
  )
}
