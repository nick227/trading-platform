import { Navigate, Route, Routes } from 'react-router-dom'
import Nav from '../components/Nav'
import Landing from '../features/Landing'
import Portfolio from '../features/Portfolio'
import AssetsIndex from '../features/AssetsIndex'
import Asset from '../features/Asset'
import Bots from '../features/Bots'
import BotCreate from '../features/BotCreate'
import RuleBasedBotSetup from '../features/RuleBasedBotSetup'
import StrategyBasedBotSetup from '../features/StrategyBasedBotSetup'
import BotDetails from '../features/BotDetails'
import BotHistory from '../features/BotHistory'
import Templates from '../features/Templates'
import TemplateDetails from '../features/TemplateDetails'
import Orders from '../features/Orders'
import AlphaShowcase from '../features/AlphaShowcase'
import Opportunities from '../features/Opportunities'
import BotConfirm from '../features/BotConfirm'
import OrderConfirm from '../features/OrderConfirm'
import Profile from '../features/Profile'
import Ops from '../features/Ops'
import Auth from '../features/Auth'
import ApiTest from '../test/ApiTest'
import ExecutionTest from '../test/ExecutionTest'
import { useAuth } from './AuthProvider'

/** Redirects logged-in users away from auth pages. */
function AuthScreen() {
  const { user } = useAuth()
  return user ? <Navigate to="/" replace /> : <Auth />
}

/** Redirects unauthenticated users to /auth while session resolves. */
function Protected({ children }) {
  const { user, sessionLoading } = useAuth()
  if (sessionLoading) return null  // brief flicker while cookie is verified
  return user ? children : <Navigate to="/auth" replace />
}

export function AppShell() {
  return (
    <div className="frame">
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/portfolio"      element={<Protected><Portfolio /></Protected>} />
        <Route path="/assets"         element={<Protected><AssetsIndex /></Protected>} />
        <Route path="/assets/:ticker" element={<Protected><Asset /></Protected>} />
        <Route path="/bots"           element={<Protected><Bots /></Protected>} />
        <Route path="/bots/create"    element={<Protected><BotCreate /></Protected>} />
        <Route path="/bots/create/rule-based"    element={<Protected><RuleBasedBotSetup /></Protected>} />
        <Route path="/bots/create/strategy-based" element={<Protected><StrategyBasedBotSetup /></Protected>} />
        <Route path="/bots/confirm"   element={<Protected><BotConfirm /></Protected>} />
        <Route path="/bots/:botId"    element={<Protected><BotDetails /></Protected>} />
        <Route path="/bots/:botId/history" element={<Protected><BotHistory /></Protected>} />
        <Route path="/templates"      element={<Protected><Templates /></Protected>} />
        <Route path="/templates/:templateSlug" element={<Protected><TemplateDetails /></Protected>} />
        <Route path="/orders"         element={<Protected><Orders /></Protected>} />
        <Route path="/orders/confirm" element={<Protected><OrderConfirm /></Protected>} />
        <Route path="/showcase"       element={<Protected><AlphaShowcase /></Protected>} />
        <Route path="/opportunities"  element={<Protected><Opportunities /></Protected>} />
        <Route path="/profile"        element={<Protected><Profile /></Protected>} />
        <Route path="/ops"            element={<Protected><Ops /></Protected>} />
        <Route path="/test"           element={<ApiTest />} />
        <Route path="/execution-test" element={<ExecutionTest />} />
        <Route path="/auth"           element={<AuthScreen />} />
        <Route path="/login"          element={<AuthScreen />} />
        <Route path="/register"       element={<AuthScreen />} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
