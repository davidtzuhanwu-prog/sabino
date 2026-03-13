import { useGoogleAuth } from '../../hooks/useGoogleAuth'

export default function OAuthConnectButton() {
  const { status, loading, connect, disconnect } = useGoogleAuth()

  if (loading) return <span style={{ color: '#94a3b8' }}>Checking connection...</span>

  if (status.connected) {
    return (
      <div style={styles.connected}>
        <span style={styles.badge}>✅ Connected as {status.email}</span>
        <button style={styles.disconnectBtn} onClick={disconnect}>Disconnect</button>
      </div>
    )
  }

  return (
    <button style={styles.connectBtn} onClick={connect}>
      <GoogleIcon />
      Connect Google Account
    </button>
  )
}

function GoogleIcon() {
  return <span style={{ fontSize: 18, marginRight: 8 }}>G</span>
}

const styles: Record<string, React.CSSProperties> = {
  connected: { display: 'flex', alignItems: 'center', gap: 16 },
  badge: { color: '#059669', fontWeight: 500, fontSize: 15 },
  connectBtn: {
    display: 'flex', alignItems: 'center', background: '#fff',
    border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 20px',
    cursor: 'pointer', fontWeight: 600, fontSize: 15, color: '#374151',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)', transition: 'box-shadow 0.15s',
  },
  disconnectBtn: {
    background: 'transparent', border: '1px solid #ef4444', color: '#ef4444',
    borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13,
  },
}
