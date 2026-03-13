import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import NotificationBanner from './components/notifications/NotificationBanner'
import ErrorToast from './components/errors/ErrorToast'
import { useNotifications } from './hooks/useNotifications'
import { useBackendErrors } from './hooks/useBackendErrors'
import { ErrorProvider, useErrors, setGlobalErrorPush } from './context/ErrorContext'
import HomePage from './pages/HomePage'
import DashboardPage from './pages/DashboardPage'
import EmailsPage from './pages/EmailsPage'
import CalendarPage from './pages/CalendarPage'
import SettingsPage from './pages/SettingsPage'
import AuthCallbackPage from './pages/AuthCallbackPage'

function AppShell() {
  const { banner, dismissBanner } = useNotifications()
  const { pushError } = useErrors()

  // Wire the axios interceptor to this context instance
  useEffect(() => {
    setGlobalErrorPush(pushError)
  }, [pushError])

  // Poll backend for server-side errors (Claude failures, email reminder failures, etc.)
  useBackendErrors()

  // Show error toast if OAuth callback returned an error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'error') {
      const message = params.get('message') ?? 'Google sign-in failed'
      pushError(`Google sign-in failed: ${message}`, 'oauth')
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [pushError])

  return (
    <div style={styles.root}>
      <Sidebar />
      <div style={styles.main}>
        <TopBar />
        <NotificationBanner notification={banner} onDismiss={dismissBanner} />
        <main style={styles.content}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/actions" element={<DashboardPage />} />
            <Route path="/emails" element={<EmailsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
          </Routes>
        </main>
      </div>
      <ErrorToast />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorProvider>
        <AppShell />
      </ErrorProvider>
    </BrowserRouter>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', minHeight: '100vh', background: '#f8fafc' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  content: { flex: 1, padding: '32px 36px', overflow: 'auto' },
}
