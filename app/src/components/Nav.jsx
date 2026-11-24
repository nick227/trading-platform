import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import { prefetchByPath } from '../app/pagePrefetch'
import ModeBadge from './ModeBadge'

// Primary destinations: Home, Strategies and Bots. Account lives behind the avatar.
const routes = [
  { path: '/', label: 'Home', match: (p) => p === '/' || p === '/portfolio' || p === '/history' },
  { path: '/strategies', label: 'Strategies', match: (p) => p.startsWith('/strategies') },
  { path: '/bots', label: 'Bots', match: (p) => p.startsWith('/bots') },
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
              <Link
                to="/strategies"
                className={`tl-nav-link ${location.pathname.startsWith('/strategies') ? 'is-active' : ''}`}
                aria-current={location.pathname.startsWith('/strategies') ? 'page' : undefined}
                onMouseEnter={() => prefetchByPath('/strategies')}
              >
                Strategies
              </Link>
              <Link to="/auth" className="tl-nav-link">Sign in</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
