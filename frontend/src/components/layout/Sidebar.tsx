import { NavLink } from 'react-router-dom'

const links = [
  { to: '/',         label: '🏠 Home',         end: true  },
  { to: '/emails',   label: '📬 Inbox',        end: false },
  { to: '/calendar', label: '📅 Upcoming',     end: false },
  { to: '/actions',  label: '✅ Action Items', end: false },
  { to: '/settings', label: '⚙️ Settings',    end: false },
]

export default function Sidebar() {
  return (
    <nav style={styles.nav}>
      <div style={styles.logo}>
        <span style={styles.logoIcon}>🏫</span>
        <span style={styles.logoText}>Sabino</span>
      </div>
      <ul style={styles.list}>
        {links.map(link => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const styles: Record<string, React.CSSProperties> = {
  nav: { width: 220, background: '#1e2a3a', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0' },
  logo: { display: 'flex', alignItems: 'center', gap: 10, padding: '24px 20px 20px', borderBottom: '1px solid #2d3f55' },
  logoIcon: { fontSize: 28 },
  logoText: { color: '#e2e8f0', fontWeight: 700, fontSize: 16 },
  list: { listStyle: 'none', margin: 0, padding: '12px 0' },
  link: {
    display: 'block', padding: '12px 20px', color: '#94a3b8',
    textDecoration: 'none', fontSize: 15, transition: 'all 0.15s',
  },
  activeLink: { color: '#60a5fa', background: '#2d3f55', borderLeft: '3px solid #60a5fa' },
}
