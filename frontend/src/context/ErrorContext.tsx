import { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'

export interface AppError {
  id: number
  message: string
  source?: string
}

interface ErrorContextValue {
  errors: AppError[]
  pushError: (message: string, source?: string) => void
  dismissError: (id: number) => void
}

const ErrorContext = createContext<ErrorContextValue | null>(null)

let _nextId = 0

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<AppError[]>([])
  // Keep a ref so the axios interceptor (set up once) always sees the latest setter
  const pushErrorRef = useRef<(msg: string, source?: string) => void>(() => {})

  const pushError = useCallback((message: string, source?: string) => {
    const id = _nextId++
    setErrors(prev => [...prev.slice(-9), { id, message, source }]) // keep max 10
  }, [])

  pushErrorRef.current = pushError

  const dismissError = useCallback((id: number) => {
    setErrors(prev => prev.filter(e => e.id !== id))
  }, [])

  return (
    <ErrorContext.Provider value={{ errors, pushError, dismissError }}>
      {children}
    </ErrorContext.Provider>
  )
}

export function useErrors() {
  const ctx = useContext(ErrorContext)
  if (!ctx) throw new Error('useErrors must be used within ErrorProvider')
  return ctx
}

// Escape hatch so api/client.ts can push errors before React is ready
type GlobalPushFn = (msg: string, source?: string) => void
let _globalPush: GlobalPushFn = () => {}
export function setGlobalErrorPush(fn: GlobalPushFn) { _globalPush = fn }
export function globalPushError(msg: string, source?: string) { _globalPush(msg, source) }
