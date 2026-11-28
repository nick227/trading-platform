import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import { prefetchByPath } from '../app/pagePrefetch'
import ModeBadge from './ModeBadge'

// Three product destinations. Strategy catalog is part of bot creation.
const routes = [
  { path: '/portfolio', label: 'Portfolio', match: p => p === '/' || p === '/portfolio' },
  { path: '/bots', label: 'My Bots', match: p => p.startsWith('/bots') },
  { path: '/ai-stock-trader', label: 'AI Trader', match: p => p.startsWith('/ai-stock-trader') }
]

function Mark() {
  return (
    <svg className="tl-nav-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2.2" />
      <path d="M11 16.2l3.2 3.2L21 12.6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function initials(user) {
  const name = String(user?.fullName ?? user?.name ?? user?.email ?? '').trim()
  if (!name) return '•'
  const parts = name.includes('@') ? [name[0]] : name.split(/\s+/).slice(0, 2).map((p) => p[0])
  return parts.join('').toUpperCase()
}

export default function Nav() {
  const { user, brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const location = useLocation()

  return (
    <nav className="tl-nav" aria-label="Main">
      <div className="tl-nav-inner">
        <div className="tl-nav-left">
          <NavLink className="tl-nav-logo" to="/" aria-label="TradeLoom home">
            <Mark />
            <span>TradeLoom</span>
          </NavLink>
          {user && <ModeBadge brokerStatus={brokerStatus} loading={brokerStatusLoading} error={brokerStatusError} />}
        </div>
        <div className="tl-nav-right">
          {user ? (
            <>
              {routes.map((route) => {
                const active = route.match(location.pathname)
                return (
                  <Link
                    key={route.path}
                    to={route.path}
                    className={`tl-nav-link ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onMouseEnter={() => prefetchByPath(route.path)}
                  >
                    {route.label}
                  </Link>
                )
              })}
              {(user.role === 'admin' || user.role === 'operator') && (
                <Link
                  to="/admin"
                  className={`tl-nav-link ${location.pathname.startsWith('/admin') ? 'is-active' : ''}`}
                  aria-current={location.pathname.startsWith('/admin') ? 'page' : undefined}
                >
                  Admin
                </Link>
              )}
              <Link
                to="/profile"
                className={`tl-nav-avatar ${location.pathname.startsWith('/profile') ? 'is-active' : ''}`}
                aria-label="Account"
                title="Account"
              >
                {initials(user)}
              </Link>
            </>
          ) : (
            <>
              <Link to="/ai-stock-trader" className="tl-nav-link">AI Trader</Link>
              <Link to="/auth" className="tl-nav-link">Sign in</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
