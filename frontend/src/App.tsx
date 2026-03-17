import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import MobileTabBar from './components/layout/MobileTabBar'
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
import HomeworkPage from './pages/HomeworkPage'
import MyDayPage from './pages/MyDayPage'
import MyDayManagePage from './pages/MyDayManagePage'

function AppShell() {
  const { banner, dismissBanner } = useNotifications()
  const { pushError } = useErrors()

  useEffect(() => {
    setGlobalErrorPush(pushError)
  }, [pushError])

  useBackendErrors()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'error') {
      const message = params.get('message') ?? 'Google sign-in failed'
      pushError(`Google sign-in failed: ${message}`, 'oauth')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [pushError])

  return (
    <div className="flex w-full h-screen overflow-hidden bg-slate-50">
      {/* Sidebar: hidden on mobile, visible on md+ */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <NotificationBanner notification={banner} onDismiss={dismissBanner} />
        <main className="flex-1 p-4 md:p-6 lg:p-9 overflow-y-auto safe-area-pb md:pb-6">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/my-day" element={<MyDayPage />} />
            <Route path="/my-day/manage" element={<MyDayManagePage />} />
            <Route path="/actions" element={<DashboardPage />} />
            <Route path="/emails" element={<EmailsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/homework" element={<HomeworkPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
          </Routes>
        </main>
      </div>

      {/* Mobile bottom tab bar: visible only on mobile */}
      <MobileTabBar />
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
