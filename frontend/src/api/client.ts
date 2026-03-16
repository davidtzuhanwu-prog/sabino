import axios from 'axios'
import { globalPushError } from '../context/ErrorContext'

// Extend axios config to support a silent flag
declare module 'axios' {
  interface AxiosRequestConfig {
    silent?: boolean
  }
}

const api = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:8000`,
  headers: { 'Content-Type': 'application/json' },
})

// Deduplicate: don't show the same error key more than once per window
const _lastShown: Record<string, number> = {}
const DEDUPE_MS = 10_000

function maybeToast(key: string, message: string, source: string) {
  const now = Date.now()
  if ((now - (_lastShown[key] ?? 0)) < DEDUPE_MS) return
  _lastShown[key] = now
  globalPushError(message, source)
}

// URLs that are always background/polling — never toast on these
const SILENT_URLS = ['/api/reminders/notifications', '/api/errors', '/api/auth/status']

api.interceptors.response.use(
  res => res,
  err => {
    const url: string = err.config?.url ?? ''
    const silent =
      err.config?.silent === true ||
      SILENT_URLS.some(p => url.includes(p))

    if (!silent) {
      const status: number | undefined = err.response?.status
      const detail: string =
        err.response?.data?.detail ?? err.response?.data?.message ?? err.message ?? 'Unknown error'

      if (status === undefined) {
        maybeToast('network', 'Cannot reach the server. Is the backend running?', 'network')
      } else if (status >= 500) {
        maybeToast(`5xx-${url}`, `Server error (${status}): ${detail}`, 'api')
      } else if (status >= 400) {
        maybeToast(`4xx-${url}`, `Request failed (${status}): ${detail}`, 'api')
      }
    }

    return Promise.reject(err)
  },
)

export default api
