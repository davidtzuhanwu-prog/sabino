import { useErrors } from '../../context/ErrorContext'
import type { AppError } from '../../context/ErrorContext'

export default function ErrorToast() {
  const { errors, dismissError } = useErrors()

  if (errors.length === 0) return null

  return (
    <div style={styles.container}>
      {errors.map(err => (
        <ErrorItem key={err.id} error={err} onDismiss={() => dismissError(err.id)} />
      ))}
    </div>
  )
}

function ErrorItem({ error, onDismiss }: { error: AppError; onDismiss: () => void }) {
  return (
    <div style={styles.toast}>
      <span style={styles.icon}>⚠️</span>
      <div style={styles.body}>
        {error.source && <span style={styles.source}>{error.source}</span>}
        <span style={styles.message}>{error.message}</span>
      </div>
      <button style={styles.dismiss} onClick={onDismiss} aria-label="Dismiss error">✕</button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 300,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxWidth: 440,
  },
  toast: {
    background: '#7f1d1d',
    color: '#fff',
    borderRadius: 10,
    padding: '12px 16px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    animation: 'slideIn 0.2s ease',
  },
  icon: { fontSize: 18, flexShrink: 0, marginTop: 1 },
  body: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  source: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#fca5a5',
    fontWeight: 600,
  },
  message: { fontSize: 13, lineHeight: 1.5 },
  dismiss: {
    background: 'transparent',
    border: 'none',
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 15,
    flexShrink: 0,
    padding: 0,
  },
}
