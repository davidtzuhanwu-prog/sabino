import type { AppNotification } from '../../types'

interface Props {
  notification: AppNotification | null
  onDismiss: () => void
}

export default function NotificationBanner({ notification, onDismiss }: Props) {
  if (!notification) return null

  return (
    <div style={styles.banner}>
      <span style={styles.icon}>🔔</span>
      <span style={styles.message}>{notification.message}</span>
      <button style={styles.dismiss} onClick={onDismiss}>✕</button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed', top: 64, right: 20, zIndex: 200,
    background: '#1e40af', color: '#fff', borderRadius: 12,
    padding: '14px 20px', maxWidth: 420, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
    display: 'flex', alignItems: 'flex-start', gap: 12, animation: 'slideIn 0.3s ease',
  },
  icon: { fontSize: 20, flexShrink: 0 },
  message: { fontSize: 14, lineHeight: 1.5, flex: 1 },
  dismiss: {
    background: 'transparent', border: 'none', color: '#bfdbfe',
    cursor: 'pointer', fontSize: 16, flexShrink: 0, padding: 0,
  },
}
