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
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 sticky top-0 z-[100]">
      <span className="font-semibold text-[#1e2a3a] text-base">{pageTitle}</span>
    </header>
  )
}
