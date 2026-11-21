import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import { prefetchByPath } from '../app/pagePrefetch'
import Logo from './Logo'
import ModeBadge from './ModeBadge'

// Minimal persistent navigation. Portfolio, research, and trading are
// reached through content (Home cards, bot detail, asset links).
const routes = [
  { path: '/', label: 'Home', match: (p) => p === '/' },
  { path: '/bots', label: 'Bots', match: (p) => p === '/bots' || p.startsWith('/bots/') },
  { path: '/profile', label: 'Account', match: (p) => p === '/profile' || p.startsWith('/profile/') },
]

export default function Nav() {
  const { user, brokerStatus } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const close = () => setMobileOpen(false)

  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner container">
        <NavLink className="nav-logo" to="/" onClick={close} aria-label="TradeLoom home">
          <Logo />
        </NavLink>

        {user && <ModeBadge brokerStatus={brokerStatus} />}

        <button
          className={`nav-toggle ${mobileOpen ? 'nav-toggle--open' : ''}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div className={`nav-menu ${mobileOpen ? 'nav-menu--open' : ''}`}>
          {user ? (
            routes.map((route) => {
              const active = route.match(location.pathname)
              return (
                <Link
                  key={route.path}
                  to={route.path}
                  className={`nav-link ${active ? 'nav-link--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                  onMouseEnter={() => prefetchByPath(route.path)}
                >
                  {route.label}
                </Link>
              )
            })
          ) : (
            <Link to="/auth" className="nav-link" onClick={close}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
