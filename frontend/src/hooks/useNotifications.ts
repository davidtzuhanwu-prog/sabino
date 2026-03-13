import { useEffect, useCallback, useState } from 'react'
import api from '../api/client'
import type { AppNotification } from '../types'

export function useNotifications() {
  const [banner, setBanner] = useState<AppNotification | null>(null)

  const requestPermission = useCallback(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const pollNotifications = useCallback(async () => {
    try {
      const { data } = await api.get<AppNotification[]>('/api/reminders/notifications')
      const pending = data.filter(n => n.status === 'pending')
      for (const notif of pending) {
        // Show browser OS notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('School Reminder', {
            body: notif.message,
            icon: '/favicon.svg',
          })
        }
        // Show in-app banner for the first one
        setBanner(notif)
        // Mark dismissed on backend
        await api.post(`/api/reminders/notifications/${notif.id}/dismiss`)
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [])

  const dismissBanner = useCallback(() => setBanner(null), [])

  useEffect(() => {
    requestPermission()
    pollNotifications()
    const interval = setInterval(pollNotifications, 60_000)
    return () => clearInterval(interval)
  }, [pollNotifications, requestPermission])

  return { banner, dismissBanner }
}
