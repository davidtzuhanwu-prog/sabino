import { useLocation } from 'react-router-dom'

const PAGE_TITLES: Record<string, string> = {
  '/':          '🏠 Home',
  '/emails':    '📬 Inbox',
  '/calendar':  '📅 Upcoming',
  '/actions':   '✅ Action Items',
  '/homework':  '📚 Homework',
  '/settings':  '⚙️ Settings',
}

export default function TopBar() {
  const location = useLocation()
  const pageTitle = PAGE_TITLES[location.pathname] ?? 'Sabino'

  return (
    <header style={styles.bar}>
      <span style={styles.title}>{pageTitle}</span>
    </header>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 56, background: '#fff', borderBottom: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center',
    padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
  },
  title: { fontWeight: 600, color: '#1e2a3a', fontSize: 16 },
}
