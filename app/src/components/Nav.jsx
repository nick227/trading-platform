import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import { useApp } from '../app/AppProvider'

const routes = [
  { path: '/', label: 'Landing', end: true },
  { path: '/portfolio', label: 'Portfolio' },
  { asset: true, label: 'Asset' },
  { path: '/bots', label: 'Add Bots', prefix: '/bots' },
  { path: '/orders', label: 'Add Orders', prefix: '/orders' },
  { path: '/profile', label: 'Profile' },
  { path: '/auth', label: 'Auth' }
]

function navBtnClass(active) {
  return `btn btn-${active ? 'primary' : 'ghost'} ${active ? ' is-active' : ''}`
}

export default function Nav() {
  const { user } = useAuth()
  const { state } = useApp()
  const location = useLocation()
  const assetTabActive = location.pathname.startsWith('/assets/')

  return (
    <div className="nav-wrap">
      <div className="nav container">
        <div className="nav-left">
          <NavLink className="btn-reset" to="/">
            <strong>Lunastic</strong>
          </NavLink>
        </div>

        <div className="nav-links">
          {routes.map((route) => {
            if (route.asset) {
              return (
                <NavLink
                  key="asset"
                  to={`/assets/${state.selectedAsset}`}
                  className={() => navBtnClass(assetTabActive)}
                  aria-current={assetTabActive ? 'page' : undefined}
                >
                  {route.label}
                </NavLink>
              )
            }
            if (route.prefix) {
              const active =
                location.pathname === route.path || location.pathname.startsWith(`${route.prefix}/`)
              return (
                <NavLink
                  key={route.path}
                  to={route.path}
                  className={() => navBtnClass(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  {route.label}
                </NavLink>
              )
            }
            return (
              <NavLink
                key={route.path}
                to={route.path}
                end={route.end === true}
                className={({ isActive }) => navBtnClass(isActive)}
                aria-current={undefined}
              >
                {route.label}
              </NavLink>
            )
          })}
        </div>

        <div className="nav-right">
          {user ? (
            <div className="nav-user">
              <img src={user.avatar} alt={user.name} className="avatar-sm" />
              <span>{user.name}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
