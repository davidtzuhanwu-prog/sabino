/**
 * PIN entry overlay. Calls onSuccess when correct PIN is entered.
 * If no PIN is configured the backend returns valid=true for any input.
 */
import { useState, useRef, useEffect } from 'react'

interface PinGateProps {
  onVerify: (pin: string) => Promise<boolean>
  onSuccess: () => void
}

export default function PinGate({ onVerify, onSuccess }: PinGateProps) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  useEffect(() => {
    inputRefs[0].current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChange(idx: number, val: string) {
    if (!/^\d*$/.test(val)) return
    const next = [...digits]
    next[idx] = val.slice(-1)
    setDigits(next)
    setError(false)

    if (val && idx < 3) {
      inputRefs[idx + 1].current?.focus()
    }

    if (next.every(d => d !== '') && next.join('').length === 4) {
      const pin = next.join('')
      setChecking(true)
      try {
        const valid = await onVerify(pin)
        if (valid) {
          onSuccess()
        } else {
          setError(true)
          setDigits(['', '', '', ''])
          setTimeout(() => inputRefs[0].current?.focus(), 50)
        }
      } finally {
        setChecking(false)
      }
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs[idx - 1].current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-80 text-center">
        <span className="text-4xl mb-3 block">🔒</span>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Parent Mode</h2>
        <p className="text-gray-500 text-sm mb-6">Enter your 4-digit PIN</p>

        <div className="flex justify-center gap-3 mb-4">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              disabled={checking}
              className={`w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 outline-none transition-colors ${
                error
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : d
                  ? 'border-orange-400 bg-orange-50 text-orange-700'
                  : 'border-gray-300 bg-gray-50 text-gray-900 focus:border-orange-400'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-500 text-sm font-medium">Incorrect PIN. Try again.</p>
        )}
        {checking && (
          <p className="text-gray-400 text-sm">Checking…</p>
        )}
      </div>
    </div>
  )
}
