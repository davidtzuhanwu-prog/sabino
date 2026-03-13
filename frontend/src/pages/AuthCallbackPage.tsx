import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // OAuth callback — redirect to settings after a short delay
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'success') {
      setTimeout(() => navigate('/settings'), 1500)
    } else {
      navigate('/settings')
    }
  }, [navigate])

  return (
    <div style={styles.container}>
      <div style={styles.box}>
        <div style={styles.spinner}>⏳</div>
        <h2>Connecting Google Account...</h2>
        <p>Redirecting to Settings...</p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' },
  box: { textAlign: 'center', color: '#374151' },
  spinner: { fontSize: 48, marginBottom: 16 },
}
