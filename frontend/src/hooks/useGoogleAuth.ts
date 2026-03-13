import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import type { AuthStatus } from '../types'

export function useGoogleAuth() {
  const [status, setStatus] = useState<AuthStatus>({ connected: false, email: null, scopes: [] })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<AuthStatus>('/api/auth/status')
      setStatus(data)
    } catch {
      setStatus({ connected: false, email: null, scopes: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const connect = useCallback(async () => {
    const { data } = await api.get<{ auth_url?: string; error?: string }>('/api/auth/url')
    if (!data.auth_url) {
      alert(data.error ?? 'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env')
      return
    }
    window.location.href = data.auth_url
  }, [])

  const disconnect = useCallback(async () => {
    await api.delete('/api/auth/disconnect')
    setStatus({ connected: false, email: null, scopes: [] })
  }, [])

  return { status, loading, connect, disconnect, refresh }
}
