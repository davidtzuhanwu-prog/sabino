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
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="lbg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF922B"/>
          <stop offset="50%" stopColor="#F03868"/>
          <stop offset="100%" stopColor="#AE1C55"/>
        </linearGradient>
        <linearGradient id="lsun" x1="16" y1="10" x2="16" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFE566" stopOpacity="0.95"/>
          <stop offset="100%" stopColor="#FF8C2A" stopOpacity="0.8"/>
        </linearGradient>
        <radialGradient id="lglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE8A0" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#FF922B" stopOpacity="0"/>
        </radialGradient>
      </defs>
      {/* Background rounded square */}
      <rect width="32" height="32" rx="7" fill="url(#lbg)"/>
      {/* Warm glow */}
      <circle cx="16" cy="21" r="13" fill="url(#lglow)" opacity="0.4"/>
      {/* Horizon line */}
      <rect x="5" y="21" width="18" height="1.5" rx="0.75" fill="white" opacity="0.25"/>
      {/* Sunrise semicircle */}
      <path d="M5 21.5 A9.5 9.5 0 0 1 24 21.5 Z" fill="url(#lsun)"/>
      {/* Spark — 4-point starburst upper right */}
      <path d="M24.5 9 C24.65 10.4 25.2 11.1 24.5 11.8 C23.8 11.1 24.35 10.4 24.5 9Z" fill="white" opacity="0.95"/>
      <path d="M24.5 14.6 C24.35 13.2 23.8 12.5 24.5 11.8 C25.2 12.5 24.65 13.2 24.5 14.6Z" fill="white" opacity="0.85"/>
      <path d="M21.8 11.8 C23.1 11.65 23.9 11.2 24.5 11.8 C23.9 12.4 23.1 11.95 21.8 11.8Z" fill="white" opacity="0.85"/>
      <path d="M27.2 11.8 C25.9 11.95 25.1 12.4 24.5 11.8 C25.1 11.2 25.9 11.65 27.2 11.8Z" fill="white" opacity="0.75"/>
      <circle cx="24.5" cy="11.8" r="1" fill="white" opacity="1"/>
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
    <nav className="w-[220px] bg-[#1c1c1e] min-h-screen flex flex-col border-r border-[#2c2c2e]">
      <div className="flex items-center gap-2.5 px-[18px] pt-[22px] pb-[18px] border-b border-[#2c2c2e]">
        <LogoMark />
        <span className="text-white font-bold text-base tracking-tight">Family Hub</span>
      </div>

      <ul className="list-none m-0 px-2.5 pt-2.5 pb-0 flex-1">
        {links.map(({ to, label, Icon, end }) => (
          <li key={to} className="mb-0.5">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg no-underline text-sm font-medium tracking-wide transition-colors relative ${
                  isActive ? 'text-white bg-[#2c2c2e]' : 'text-[#888888] hover:text-white hover:bg-white/5'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`w-[30px] h-[30px] flex items-center justify-center rounded-[7px] shrink-0 transition-colors ${isActive ? 'bg-[#3a3a3c] text-orange-400' : 'text-[#666666]'}`}>
                    <Icon />
                  </span>
                  <span className="flex-1">{label}</span>
                  {isActive && <span className="w-[5px] h-[5px] rounded-full bg-orange-400 shrink-0" />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="px-[18px] py-4 border-t border-[#2c2c2e]">
        <span className="text-[#444444] text-[11px] font-medium uppercase tracking-widest">School monitor</span>
      </div>
    </nav>
  )
}
