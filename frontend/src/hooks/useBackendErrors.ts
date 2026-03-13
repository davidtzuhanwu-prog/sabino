import { useEffect, useCallback } from 'react'
import api from '../api/client'
import { useErrors } from '../context/ErrorContext'

interface BackendError {
  id: number
  source: string
  message: string
  timestamp: string
}

/**
 * Polls /api/errors every 30 seconds and surfaces backend-originated
 * errors (e.g. Claude API failures, email reminder failures) as toasts.
 */
export function useBackendErrors() {
  const { pushError } = useErrors()

  const poll = useCallback(async () => {
    try {
      const { data } = await api.get<BackendError[]>('/api/errors')
      for (const err of data) {
        pushError(err.message, err.source)
      }
    } catch {
      // Silently ignore — we don't want error-polling itself to spam errors
    }
  }, [pushError])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [poll])
}
