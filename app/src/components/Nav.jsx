import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import Logo from './Logo'

const routes = [
  { path: '/portfolio', label: 'Portfolio' },
  { path: '/assets', label: 'Assets', prefix: '/assets' },
  { path: '/bots', label: 'Bots', prefix: '/bots' },
  { path: '/orders', label: 'Orders', prefix: '/orders' }
]

export default function Nav() {
  const { user } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="nav">
      <div className="nav-inner">
        <NavLink className="nav-logo" to="/" onClick={() => setMobileOpen(false)}>
          <Logo />
        </NavLink>

        <button
          className={`nav-toggle ${mobileOpen ? 'nav-toggle--open' : ''}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div className={`nav-menu ${mobileOpen ? 'nav-menu--open' : ''}`}>
          {routes.map((route) => {
            const active = route.prefix
              ? location.pathname === route.path || location.pathname.startsWith(`${route.prefix}/`)
              : undefined

            return (
              <NavLink
                key={route.path}
                to={route.path}
                end={!route.prefix}
                className={({ isActive }) => `nav-link ${active !== undefined ? (active ? 'nav-link--active' : '') : (isActive ? 'nav-link--active' : '')}`}
                onClick={() => setMobileOpen(false)}
              >
                {route.label}
              </NavLink>
            )
          })}

          {user && (
            <NavLink to="/profile" className="nav-user-pill" onClick={() => setMobileOpen(false)}>
              {user.avatar && <img src={user.avatar} alt={user.fullName || user.email} className="nav-avatar" />}
              <span className="nav-username">{user.fullName || user.email}</span>
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  )
}
