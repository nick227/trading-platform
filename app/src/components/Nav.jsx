import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import Logo from './Logo'

const routes = [
  { path: '/portfolio', label: 'Portfolio' },
  { path: '/assets', label: 'Assets', prefix: '/assets' },
  { path: '/bots', label: 'Bots', prefix: '/bots' },
  { path: '/orders', label: 'Orders', prefix: '/orders' },
  { path: '/profile', label: 'Profile' }
]

export default function Nav() {
  const { user } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pendingActive, setPendingActive] = useState(null)

  useEffect(() => {
    setPendingActive(null)
  }, [location.pathname])

  return (
    <nav className="nav">
      <div className="nav-inner container">
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
            const locationActive = route.prefix
              ? location.pathname === route.path || location.pathname.startsWith(`${route.prefix}/`)
              : undefined

            const isActive = pendingActive === route.path || (pendingActive === null && (
              locationActive !== undefined ? locationActive : location.pathname === route.path
            ))

            return (
              <NavLink
                key={route.path}
                to={route.path}
                end={!route.prefix}
                className={() => `nav-link ${isActive ? 'nav-link--active' : ''}`}
                onClick={() => {
                  setPendingActive(route.path)
                  setMobileOpen(false)
                }}
              >
                {route.label}
              </NavLink>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
