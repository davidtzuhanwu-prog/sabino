import { useState, useCallback } from 'react'
import api from '../api/client'
import type { ActionItem } from '../types'

export function useActionItems() {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(false)

  const fetchItems = useCallback(async (params?: {
    completed?: boolean
    is_short_notice?: boolean
    sort_by?: string
    order?: string
  }) => {
    setLoading(true)
    try {
      const { data } = await api.get<ActionItem[]>('/api/action-items', { params, silent: true })
      setItems(data)
    } catch {
      // background data fetch — interceptor already handles explicit-action errors
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleComplete = useCallback(async (id: number, completed: boolean) => {
    const { data } = await api.patch<ActionItem>(`/api/action-items/${id}`, { completed })
    setItems(prev => prev.map(item => item.id === id ? data : item))
  }, [])

  const deleteItem = useCallback(async (id: number) => {
    await api.delete(`/api/action-items/${id}`)
    setItems(prev => prev.filter(item => item.id !== id))
  }, [])

  return { items, loading, fetchItems, toggleComplete, deleteItem }
}
