import { useErrors } from '../../context/ErrorContext'
import type { AppError } from '../../context/ErrorContext'

export default function ErrorToast() {
  const { errors, dismissError } = useErrors()

  if (errors.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2.5 max-w-[440px] md:left-auto left-3 md:right-6 md:bottom-6 md:max-w-[440px]">
      {errors.map(err => (
        <ErrorItem key={err.id} error={err} onDismiss={() => dismissError(err.id)} />
      ))}
    </div>
  )
}

function ErrorItem({ error, onDismiss }: { error: AppError; onDismiss: () => void }) {
  return (
    <div className="bg-red-900 text-white rounded-xl px-4 py-3 shadow-xl flex items-start gap-2.5 animate-[slideIn_0.2s_ease]">
      <span className="text-lg shrink-0 mt-0.5">⚠️</span>
      <div className="flex-1 flex flex-col gap-0.5">
        {error.source && (
          <span className="text-xs uppercase tracking-wide text-red-300 font-semibold">{error.source}</span>
        )}
        <span className="text-[13px] leading-relaxed">{error.message}</span>
      </div>
      <button
        className="bg-transparent border-none text-red-300 cursor-pointer text-[15px] shrink-0 p-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >✕</button>
    </div>
  )
}
