import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import Nav from '../components/Nav'
import Landing from '../features/Landing'
import Welcome from '../features/home/Welcome'
import AlgorithmBuilder from '../features/bots/builder/AlgorithmBuilder'
import Asset from '../features/Asset'
import LegacyStocksRedirect from './LegacyStocksRedirect'
import BotsPage from '../features/bots/BotsPage'
import BotDashboard from '../features/bots/detail/BotDashboard'
import OrderConfirm from '../features/OrderConfirm'
import AccountPage from '../features/account/AccountPage'
import Auth from '../features/Auth'
import PageSkeleton from '../components/PageSkeleton'
import AdminRoute from '../features/admin/AdminRoute'
import { useAuth } from './AuthProvider'
import pageTitleService from '../services/pageTitleService'

const PortfolioPage = lazy(() => import('../features/home/PortfolioPage'))
const StrategiesIndex = lazy(() => import('../features/strategies/StrategiesIndex'))
const StockTraderDashboard = lazy(() => import('../features/ai/StockTraderDashboard'))
const ResearchPartnerWorkspace = lazy(() => import('../features/researchPartner/ResearchPartnerWorkspace'))
const StrategyDetail = lazy(() => import('../features/strategies/StrategyDetail'))
const Orders = lazy(() => import('../features/Orders'))
const AdminDashboard = lazy(() => import('../features/admin/AdminDashboard'))

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

/** "/" — public welcome or the canonical portfolio for signed-in users. */
function HomeRoute() {
  const { user, sessionLoading } = useAuth()
  if (sessionLoading) return <PageSkeleton />
  return user ? <Navigate to="/portfolio" replace /> : <Welcome />
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
      '/': 'Portfolio',
      '/portfolio': 'Portfolio',
      '/assets': 'Stocks',
      '/bots': 'My Bots',
      '/bots/new': 'New bot',
      '/strategies': 'Strategies',
      '/ai-stock-trader': 'AI Stock Trader',
      '/orders': 'Orders',
      '/history': 'Trade History',
      '/profile': 'Account',
      '/research': 'Research',
      '/research-partners': 'AI Research Partner',
      '/opportunities': 'Stocks',
      '/ops': 'Operations',
      '/admin': 'Admin — Overview',
      '/admin/users': 'Admin — Users',
      '/admin/trading': 'Admin — Trading',
      '/admin/ai': 'Admin — AI & Data',
      '/admin/system': 'Admin — System',
      '/auth': 'Authentication',
      '/login': 'Login',
      '/register': 'Register',
    }

    const fallbackPage = location.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')

    const pageName = routeNameMap[location.pathname] ||
      (location.pathname.startsWith('/strategies/') ? 'Strategy Evidence' :
       location.pathname.startsWith('/assets/') ? 'Stock Overview' :
       location.pathname.startsWith('/bots/') ? 'Bot Details' : fallbackPage) || 'Portfolio'
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
        <Route path="/research-partners" element={<Protected><Suspense fallback={<PageSkeleton />}><ResearchPartnerWorkspace /></Suspense></Protected>} />
        <Route path="/opportunities" element={<LegacyStocksRedirect />} />
        <Route path="/portfolio" element={<Protected><Suspense fallback={<PageSkeleton />}><PortfolioPage /></Suspense></Protected>} />
        <Route path="/assets" element={<LegacyStocksRedirect />} />
        <Route path="/assets/:ticker" element={<Protected><Asset /></Protected>} />
        <Route path="/bots" element={<Protected><BotsPage /></Protected>} />
        {/* Canonical Algorithm Builder for creation and editing */}
        <Route path="/bots/new" element={<Protected><AlgorithmBuilder /></Protected>} />
        <Route path="/bots/:botId/edit" element={<Protected><AlgorithmBuilder /></Protected>} />
        <Route path="/bots/:id/edit" element={<Protected><AlgorithmBuilder /></Protected>} />
        <Route path="/bots/create" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/create/rule-based" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/create/strategy-based" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/confirm" element={<Navigate to="/bots/new" replace />} />
        <Route path="/bots/:botId" element={<Protected><BotDashboard /></Protected>} />
        {/* Former mock-data history page; the bot page timeline replaces it. */}
        <Route path="/bots/:botId/history" element={<BotHistoryRedirect />} />
        <Route path="/strategies/:templateId/history" element={<FeaturedRedirect />} />
        {/* Public read-only flagship paper-trading evidence & intelligence. */}
        <Route path="/ai-stock-trader" element={<Suspense fallback={<PageSkeleton />}><StockTraderDashboard /></Suspense>} />
        {/* Public: platform strategy evidence, no account needed. */}
        <Route path="/strategies" element={<Suspense fallback={<PageSkeleton />}><StrategiesIndex /></Suspense>} />
        <Route path="/strategies/:templateId" element={<Suspense fallback={<PageSkeleton />}><StrategyDetail /></Suspense>} />
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
        <Route
          path="/admin/*"
          element={
            <AdminRoute>
              <Suspense fallback={<PageSkeleton />}>
                <AdminDashboard />
              </Suspense>
            </AdminRoute>
          }
        />
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/register" element={<AuthScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
