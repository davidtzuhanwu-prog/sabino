import { useState, useCallback } from 'react'
import api from '../api/client'
import type { DailyPlanItem, DayResponse, MyDaySettings, DailyRoutine } from '../types'

export function useMyDay() {
  const [items, setItems] = useState<DailyPlanItem[]>([])
  const [progress, setProgress] = useState({ total: 0, completed: 0 })
  const [loading, setLoading] = useState(false)

  const fetchDay = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const { data } = await api.get<DayResponse>(`/api/my-day/items?date=${date}`)
      setItems(data.items)
      setProgress(data.progress)
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleComplete = useCallback(async (id: number) => {
    const { data } = await api.patch<DailyPlanItem>(`/api/my-day/items/${id}/complete`)
    setItems(prev => prev.map(item => item.id === id ? data : item))
    setProgress(prev => {
      const completed = data.completed ? prev.completed + 1 : prev.completed - 1
      return { ...prev, completed }
    })
    return data
  }, [])

  const createItem = useCallback(async (payload: Omit<DailyPlanItem, 'id' | 'completed' | 'completed_at' | 'source_action_item_id' | 'routine_id'>) => {
    const { data } = await api.post<DailyPlanItem>('/api/my-day/items', payload)
    setItems(prev => [...prev, data].sort((a, b) => a.start_time.localeCompare(b.start_time)))
    setProgress(prev => ({ ...prev, total: prev.total + 1 }))
    return data
  }, [])

  const updateItem = useCallback(async (id: number, patch: Partial<DailyPlanItem>) => {
    const { data } = await api.patch<DailyPlanItem>(`/api/my-day/items/${id}`, patch)
    setItems(prev => prev.map(item => item.id === id ? data : item))
    return data
  }, [])

  const deleteItem = useCallback(async (id: number) => {
    await api.delete(`/api/my-day/items/${id}`)
    setItems(prev => {
      const removed = prev.find(i => i.id === id)
      if (!removed) return prev
      setProgress(p => ({
        total: p.total - 1,
        completed: removed.completed ? p.completed - 1 : p.completed,
      }))
      return prev.filter(i => i.id !== id)
    })
  }, [])

  const reorderItems = useCallback(async (updates: { id: number; start_time: string; sort_order: number }[]) => {
    await api.post('/api/my-day/items/reorder', { updates })
    // Optimistic: update local state
    setItems(prev => {
      const map = new Map(updates.map(u => [u.id, u]))
      return prev
        .map(item => {
          const u = map.get(item.id)
          return u ? { ...item, start_time: u.start_time, sort_order: u.sort_order } : item
        })
        .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.sort_order - b.sort_order)
    })
  }, [])

  const importFromSabino = useCallback(async (date: string) => {
    const { data } = await api.post<{ created: number }>('/api/my-day/items/import', { date })
    await fetchDay(date)
    return data.created
  }, [fetchDay])

  return { items, progress, loading, fetchDay, toggleComplete, createItem, updateItem, deleteItem, reorderItems, importFromSabino }
}

export function useMyDaySettings() {
  const [settings, setSettings] = useState<MyDaySettings | null>(null)

  const fetchSettings = useCallback(async () => {
    const { data } = await api.get<MyDaySettings>('/api/my-day/settings')
    setSettings(data)
    return data
  }, [])

  const updateSettings = useCallback(async (patch: Partial<MyDaySettings>) => {
    const { data } = await api.put<MyDaySettings>('/api/my-day/settings', patch)
    setSettings(data)
    return data
  }, [])

  return { settings, fetchSettings, updateSettings }
}

export function useRoutines() {
  const [routines, setRoutines] = useState<DailyRoutine[]>([])

  const fetchRoutines = useCallback(async () => {
    const { data } = await api.get<DailyRoutine[]>('/api/my-day/routines')
    setRoutines(data)
    return data
  }, [])

  const createRoutine = useCallback(async (payload: Omit<DailyRoutine, 'id'>) => {
    const { data } = await api.post<DailyRoutine>('/api/my-day/routines', payload)
    setRoutines(prev => [...prev, data])
    return data
  }, [])

  const updateRoutine = useCallback(async (id: number, patch: Partial<DailyRoutine>) => {
    const { data } = await api.patch<DailyRoutine>(`/api/my-day/routines/${id}`, patch)
    setRoutines(prev => prev.map(r => r.id === id ? data : r))
    return data
  }, [])

  const deleteRoutine = useCallback(async (id: number) => {
    await api.delete(`/api/my-day/routines/${id}`)
    setRoutines(prev => prev.filter(r => r.id !== id))
  }, [])

  const generateForDate = useCallback(async (date: string) => {
    const { data } = await api.post<{ created: number; date: string }>(`/api/my-day/routines/generate?date=${date}`)
    return data.created
  }, [])

  return { routines, fetchRoutines, createRoutine, updateRoutine, deleteRoutine, generateForDate }
}
