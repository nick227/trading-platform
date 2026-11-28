import { Navigate, useLocation } from 'react-router-dom'

/**
 * Preserve incoming stock links while retiring the two browsing surfaces.
 * A symbol-specific legacy URL opens bot creation with its ticker prefilled.
 * Unscoped discovery links open the public AI Trader evidence workspace.
 */
export function resolveLegacyStockDestination(search = '') {
  const params = new URLSearchParams(search)
  const ticker = (params.get('symbol') || params.get('ticker') || '').trim().toUpperCase()
  const strategy = (params.get('strategy') || params.get('template') || '').trim()
  if (!ticker) return '/ai-stock-trader'
  const next = new URLSearchParams({ ticker })
  if (strategy) next.set('template', strategy)
  return '/bots/new?' + next.toString()
}
export default function LegacyStocksRedirect() {
  const location = useLocation()
  return <Navigate to={resolveLegacyStockDestination(location.search)} replace />
}
