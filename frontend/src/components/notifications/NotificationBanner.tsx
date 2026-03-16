import type { AppNotification } from '../../types'

interface Props {
  notification: AppNotification | null
  onDismiss: () => void
}

export default function NotificationBanner({ notification, onDismiss }: Props) {
  if (!notification) return null

  return (
    <div className="fixed top-16 left-3 right-3 md:left-auto md:right-5 md:max-w-[420px] z-[200] bg-blue-800 text-white rounded-xl px-5 py-3.5 shadow-xl flex items-start gap-3 animate-[slideIn_0.3s_ease]">
      <span className="text-xl shrink-0">🔔</span>
      <span className="text-sm leading-relaxed flex-1">{notification.message}</span>
      <button
        className="bg-transparent border-none text-blue-300 cursor-pointer text-base shrink-0 p-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        onClick={onDismiss}
      >✕</button>
    </div>
  )
}
