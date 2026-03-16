import { NavLink } from 'react-router-dom'

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L10 3l7 6.5" /><path d="M5 8.5V17h4v-4h2v4h4V8.5" />
    </svg>
  )
}
function IconInbox() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 11h4l1.5 2.5h5L14 11h4" />
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="14" rx="2" /><path d="M2 8h16" /><path d="M7 2v3M13 2v3" />
      <circle cx="7" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconChecklist() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5l1.5 1.5L7 4" /><path d="M3 10.5l1.5 1.5L7 9" />
      <rect x="3" y="14" width="2.5" height="2.5" rx="0.5" />
      <path d="M9 5.5h8" /><path d="M9 10.5h8" /><path d="M9 15.25h8" />
    </svg>
  )
}
function IconBook() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13 3l2 1.5V17l-2-1.5" /><path d="M6 7h5M6 10h5M6 13h3" />
    </svg>
  )
}
function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round">
      <line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" />
      <circle cx="7" cy="5" r="2" fill="currentColor" /><circle cx="13" cy="10" r="2" fill="currentColor" /><circle cx="9" cy="15" r="2" fill="currentColor" />
    </svg>
  )
}

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 2L4 6v8c0 5.25 4.3 9.8 10 11 5.7-1.2 10-5.75 10-11V6L14 2z" fill="#3b82f6" fillOpacity="0.18" stroke="#60a5fa" strokeWidth="1.4" strokeLinejoin="round" />
      <text x="14" y="19" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif" fill="#93c5fd" letterSpacing="-0.5">S</text>
    </svg>
  )
}

const links = [
  { to: '/',         label: 'Home',         Icon: IconHome,      end: true  },
  { to: '/homework', label: 'Homework',     Icon: IconBook,      end: false },
  { to: '/emails',   label: 'Inbox',        Icon: IconInbox,     end: false },
  { to: '/calendar', label: 'Upcoming',     Icon: IconCalendar,  end: false },
  { to: '/actions',  label: 'Action Items', Icon: IconChecklist, end: false },
  { to: '/settings', label: 'Settings',     Icon: IconSettings,  end: false },
]

export default function Sidebar() {
  return (
    <nav className="w-[220px] bg-[#151e2d] min-h-screen flex flex-col border-r border-[#1e2d40]">
      <div className="flex items-center gap-2.5 px-[18px] pt-[22px] pb-[18px] border-b border-[#1e2d40]">
        <LogoMark />
        <span className="text-slate-200 font-bold text-base tracking-tight">Sabino</span>
      </div>

      <ul className="list-none m-0 px-2.5 pt-2.5 pb-0 flex-1">
        {links.map(({ to, label, Icon, end }) => (
          <li key={to} className="mb-0.5">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg no-underline text-sm font-medium tracking-wide transition-colors relative ${
                  isActive ? 'text-[#dde6f0] bg-[#1e2d42]' : 'text-[#7a90a8] hover:text-slate-300 hover:bg-white/5'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`w-[30px] h-[30px] flex items-center justify-center rounded-[7px] shrink-0 transition-colors ${isActive ? 'bg-[#1d3557] text-blue-400' : 'text-[#5a718a]'}`}>
                    <Icon />
                  </span>
                  <span className="flex-1">{label}</span>
                  {isActive && <span className="w-[5px] h-[5px] rounded-full bg-blue-500 shrink-0" />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="px-[18px] py-4 border-t border-[#1e2d40]">
        <span className="text-[#2d3f55] text-[11px] font-medium uppercase tracking-widest">School monitor</span>
      </div>
    </nav>
  )
}
