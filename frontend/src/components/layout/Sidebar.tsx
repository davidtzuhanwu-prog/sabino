import { NavLink } from 'react-router-dom'

// ── SVG icon set — 20×20 viewBox, stroke-based, no fill ──────────────────────

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L10 3l7 6.5" />
      <path d="M5 8.5V17h4v-4h2v4h4V8.5" />
    </svg>
  )
}

function IconInbox() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M2 11h4l1.5 2.5h5L14 11h4" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="14" rx="2" />
      <path d="M2 8h16" />
      <path d="M7 2v3M13 2v3" />
      <circle cx="7" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconChecklist() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* Checked rows */}
      <path d="M3 5.5l1.5 1.5L7 4" />
      <path d="M3 10.5l1.5 1.5L7 9" />
      {/* Unchecked box */}
      <rect x="3" y="14" width="2.5" height="2.5" rx="0.5" />
      {/* Text lines */}
      <path d="M9 5.5h8" />
      <path d="M9 10.5h8" />
      <path d="M9 15.25h8" />
    </svg>
  )
}

function IconSettings() {
  return (
    // Sliders / equalizer icon — universally understood as "settings/preferences"
    // Three horizontal lines, each with a moveable knob at a different position
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round">
      {/* Lines */}
      <line x1="3" y1="5" x2="17" y2="5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="15" x2="17" y2="15" />
      {/* Knobs (filled circles that sit on the lines) */}
      <circle cx="7"  cy="5"  r="2" fill="currentColor" />
      <circle cx="13" cy="10" r="2" fill="currentColor" />
      <circle cx="9"  cy="15" r="2" fill="currentColor" />
    </svg>
  )
}

// ── Logo mark ─────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      {/* Shield / badge shape — represents a school / parent monitor */}
      <path
        d="M14 2L4 6v8c0 5.25 4.3 9.8 10 11 5.7-1.2 10-5.75 10-11V6L14 2z"
        fill="#3b82f6"
        fillOpacity="0.18"
        stroke="#60a5fa"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Letter S */}
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#93c5fd"
        letterSpacing="-0.5"
      >
        S
      </text>
    </svg>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const links = [
  { to: '/',         label: 'Home',         Icon: IconHome,      end: true  },
  { to: '/emails',   label: 'Inbox',        Icon: IconInbox,     end: false },
  { to: '/calendar', label: 'Upcoming',     Icon: IconCalendar,  end: false },
  { to: '/actions',  label: 'Action Items', Icon: IconChecklist, end: false },
  { to: '/settings', label: 'Settings',     Icon: IconSettings,  end: false },
]

export default function Sidebar() {
  return (
    <nav style={styles.nav}>
      {/* Logo */}
      <div style={styles.logo}>
        <LogoMark />
        <span style={styles.logoText}>Sabino</span>
      </div>

      {/* Nav links */}
      <ul style={styles.list}>
        {links.map(({ to, label, Icon, end }) => (
          <li key={to} style={styles.item}>
            <NavLink
              to={to}
              end={end}
              style={({ isActive }) => ({
                ...styles.link,
                ...(isActive ? styles.activeLink : {}),
              })}
            >
              {({ isActive }) => (
                <>
                  <span style={{ ...styles.iconWrap, ...(isActive ? styles.iconWrapActive : {}) }}>
                    <Icon />
                  </span>
                  <span style={styles.label}>{label}</span>
                  {isActive && <span style={styles.activeDot} />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Bottom spacer / version hint */}
      <div style={styles.footer}>
        <span style={styles.footerText}>School monitor</span>
      </div>
    </nav>
  )
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    width: 220,
    background: '#151e2d',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    borderRight: '1px solid #1e2d40',
  },

  // Logo row
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '22px 18px 18px',
    borderBottom: '1px solid #1e2d40',
  },
  logoText: {
    color: '#e2e8f0',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '-0.01em',
  },

  // Nav list
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '10px 10px 0',
    flex: 1,
  },
  item: {
    marginBottom: 2,
  },

  // Base link
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    color: '#7a90a8',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '0.005em',
    transition: 'background 0.12s, color 0.12s',
    position: 'relative' as const,
  },

  // Active link overrides
  activeLink: {
    color: '#dde6f0',
    background: '#1e2d42',
  },

  // Icon container
  iconWrap: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    flexShrink: 0,
    transition: 'background 0.12s, color 0.12s',
    color: '#5a718a',
  },
  iconWrapActive: {
    background: '#1d3557',
    color: '#60a5fa',
  },

  label: {
    flex: 1,
  },

  // Small accent dot on right when active
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#3b82f6',
    flexShrink: 0,
  },

  // Footer
  footer: {
    padding: '16px 18px',
    borderTop: '1px solid #1e2d40',
  },
  footerText: {
    color: '#2d3f55',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
}
