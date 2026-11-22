import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import Nav from '../components/Nav'
import Landing from '../features/Landing'
import HomeDashboard from '../features/home/HomeDashboard'
import Welcome from '../features/home/Welcome'
import NewBotWizard from '../features/bots/new/NewBotWizard'
import Asset from '../features/Asset'
import BotsPage from '../features/bots/BotsPage'
import BotDashboard from '../features/bots/detail/BotDashboard'
import OrderConfirm from '../features/OrderConfirm'
import AccountPage from '../features/account/AccountPage'
import Auth from '../features/Auth'
import PageSkeleton from '../components/PageSkeleton'
import { useAuth } from './AuthProvider'
import pageTitleService from '../services/pageTitleService'

const AssetsIndex = lazy(() => import('../features/AssetsIndex'))
const Orders = lazy(() => import('../features/Orders'))

/** Redirects logged-in users away from auth pages. */
function AuthScreen() {
  const { user } = useAuth()
  return user ? <Navigate to="/" replace /> : <Auth />
}

function FeaturedRedirect() {
  const { templateId } = useParams()
  return <Navigate to={`/bots?featured=${encodeURIComponent(templateId)}`} replace />
}

function BotHistoryRedirect() {
  const { botId } = useParams()
  return <Navigate to={`/bots/${encodeURIComponent(botId)}`} replace />
}

/** "/" — bots-first Home for signed-in users, a short welcome otherwise. */
function HomeRoute() {
  const { user, sessionLoading } = useAuth()
  if (sessionLoading) return <PageSkeleton />
  return user ? <HomeDashboard /> : <Welcome />
}

/** Redirects unauthenticated users to /auth while session resolves. */
function Protected({ children }) {
  const { user, sessionLoading } = useAuth()
  if (sessionLoading) return <PageSkeleton />
  return user ? children : <Navigate to="/auth" replace />
}

function AppLayout() {
  const location = useLocation()

  useEffect(() => {
    const routeNameMap = {
      '/': 'Home',
      '/portfolio': 'Portfolio',
      '/assets': 'Assets',
      '/bots': 'Bots',
      '/bots/new': 'New bot',
      '/orders': 'Orders',
      '/history': 'Trade History',
      '/profile': 'Account',
      '/research': 'Research',
      '/opportunities': 'Opportunities',
      '/ops': 'Operations',
      '/auth': 'Authentication',
      '/login': 'Login',
      '/register': 'Register',
    }

    const fallbackPage = location.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')

    const pageName = routeNameMap[location.pathname] || fallbackPage || 'Home'
    pageTitleService.setTitle(pageName)
  }, [location.pathname])

  return (
    <div className="frame">
      <Nav />
      <Outlet />
    </div>
  )
}

export function AppShell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomeRoute />} />
        {/* Former Landing dashboard; secondary research surface (see TRADELOOM_CONSUMER_UX_PLAN.md M6). */}
        <Route path="/research" element={<Protected><Landing /></Protected>} />
        <Route path="/portfolio" element={<Navigate to="/#holdings" replace />} />
        <Route
          path="/assets"
          element={
            <Protected>
              <Suspense fallback={<PageSkeleton />}>
                <AssetsIndex />
              </Suspense>
            </Protected>
          }
        />
        <Route path="/assets/:ticker" element={<Protected><Asset /></Protected>} />
        <Route path="/bots" element={<Protected><BotsPage /></Protected>} />
        {/* One bot-creation flow. Former creation paths redirect here. */}
        <Route path="/bots/new" element={<Protected><NewBotWizard /></Protected>} />
        <Route path="/bots/create" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/create/rule-based" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/create/strategy-based" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/confirm" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/:botId" element={<Protected><BotDashboard /></Protected>} />
        {/* Former mock-data history page; the bot page timeline replaces it. */}
        <Route path="/bots/:botId/history" element={<BotHistoryRedirect />} />
        <Route path="/strategies/:templateId/history" element={<FeaturedRedirect />} />
        <Route path="/templates" element={<Navigate to="/bots/new" replace />} />
        <Route path="/templates/:templateSlug" element={<Navigate to="/bots/new" replace />} />
        <Route
          path="/orders"
          element={
            <Protected>
              <Suspense fallback={<PageSkeleton />}>
                <Orders />
              </Suspense>
            </Protected>
          }
        />
        <Route path="/history" element={<Navigate to="/bots#activity" replace />} />
        <Route path="/orders/confirm" element={<Protected><OrderConfirm /></Protected>} />
        <Route path="/profile" element={<Protected><AccountPage /></Protected>} />
        <Route path="/profile/account" element={<Navigate to="/profile" replace />} />
        <Route path="/profile/broker" element={<Navigate to="/profile" replace />} />
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/register" element={<AuthScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
