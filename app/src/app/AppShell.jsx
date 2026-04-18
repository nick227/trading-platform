import { Navigate, Route, Routes } from 'react-router-dom'
import Nav from '../components/Nav'
import Landing from '../features/Landing'
import Portfolio from '../features/Portfolio'
import Asset from '../features/Asset'
import Bots from '../features/Bots'
import BotCreate from '../features/BotCreate'
import Orders from '../features/Orders'
import BotConfirm from '../features/BotConfirm'
import OrderConfirm from '../features/OrderConfirm'
import Profile from '../features/Profile'
import Ops from '../features/Ops'
import Auth from '../features/Auth'
import ApiTest from '../test/ApiTest'
import ExecutionTest from '../test/ExecutionTest'
import { useAuth } from './AuthProvider'

function AuthScreen() {
  const { user } = useAuth()
  return user ? <Navigate to="/" replace /> : <Auth />
}

export function AppShell() {
  return (
    <div>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/assets" element={<Navigate to="/assets/NVDA" replace />} />
        <Route path="/assets/:ticker" element={<Asset />} />
        <Route path="/bots" element={<Bots />} />
        <Route path="/bots/create" element={<BotCreate />} />
        <Route path="/bots/confirm" element={<BotConfirm />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/confirm" element={<OrderConfirm />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/test" element={<ApiTest />} />
        <Route path="/execution-test" element={<ExecutionTest />} />
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/register" element={<AuthScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
