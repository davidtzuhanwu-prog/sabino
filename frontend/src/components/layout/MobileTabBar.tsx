import { NavLink } from 'react-router-dom'

function IconHome() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L10 3l7 6.5" /><path d="M5 8.5V17h4v-4h2v4h4V8.5" /></svg>
}
function IconBook() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M13 3l2 1.5V17l-2-1.5" /><path d="M6 7h5M6 10h5M6 13h3" /></svg>
}
function IconInbox() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 11h4l1.5 2.5h5L14 11h4" /></svg>
}
function IconChecklist() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5l1.5 1.5L7 4" /><path d="M3 10.5l1.5 1.5L7 9" /><rect x="3" y="14" width="2.5" height="2.5" rx="0.5" /><path d="M9 5.5h8M9 10.5h8M9 15.25h8" /></svg>
}
function IconSettings() {
  return <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round"><line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" /><circle cx="7" cy="5" r="2" fill="currentColor" /><circle cx="13" cy="10" r="2" fill="currentColor" /><circle cx="9" cy="15" r="2" fill="currentColor" /></svg>
}

const tabs = [
  { to: '/',         label: 'Home',     Icon: IconHome,      end: true  },
  { to: '/homework', label: 'Homework', Icon: IconBook,      end: false },
  { to: '/emails',   label: 'Inbox',    Icon: IconInbox,     end: false },
  { to: '/actions',  label: 'Actions',  Icon: IconChecklist, end: false },
  { to: '/settings', label: 'Settings', Icon: IconSettings,  end: false },
]

export default function MobileTabBar() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-[#1c1c1e] border-t border-[#2c2c2e] flex md:hidden z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex w-full h-14">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 no-underline transition-colors ${
              isActive ? 'text-orange-400' : 'text-[#666666]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`transition-colors ${isActive ? 'text-orange-400' : 'text-[#666666]'}`}>
                <Icon />
              </span>
              <span className="text-[10px] font-medium leading-none">{label}</span>
              {isActive && <span className="absolute bottom-0 w-6 h-0.5 bg-orange-400 rounded-t-full" />}
            </>
          )}
        </NavLink>
      ))}
      </div>
    </nav>
  )
}
