/**
 * Flagship deterministic paper risk policy. An LLM supplies a proposal only.
 * This function controls quantity and refuses exposure or loss-policy violations.
 */
import { summarizeStockTraderReservations } from './stockTraderAccounting.js'

const MAX_POSITION_PCT = 0.20
const MAX_ORDER_NOTIONAL = 2000
const MAX_GROSS_EXPOSURE_PCT = 1.0
const MAX_SESSION_REALIZED_LOSS_PCT = 0.05

export function evaluateStockTraderPaperProposal({
  intent, price, portfolio, activeOrders, executionLimits,
  sessionRealizedPnl = 0
}) {
  const reject = reason => ({ allowed: false, reason })
  if (!intent || !['BUY', 'SELL'].includes(intent.action) ||
      !Number.isFinite(price) || price <= 0 ||
      !portfolio || !Array.isArray(portfolio.positions) ||
      !Number.isFinite(portfolio.cash) || portfolio.cash < 0 ||
      !Number.isFinite(portfolio.allocatedCapital) || portfolio.allocatedCapital <= 0 ||
      !Number.isFinite(sessionRealizedPnl)) {
    return reject('invalid_risk_inputs')
  }
  const cap = portfolio.allocatedCapital
  const positionCap = Math.min(MAX_POSITION_PCT, Number(executionLimits?.maxPositionPct))
  const orderCap = Math.min(MAX_ORDER_NOTIONAL, Number(executionLimits?.maxOrderNotional))
  if (!(positionCap > 0) || !(orderCap > 0)) return reject('invalid_risk_limits')

  const reserved = summarizeStockTraderReservations(activeOrders)
  const current = portfolio.positions.find(p => p.symbol === intent.symbol)
  const heldQty = Number(current?.quantity ?? 0)
  if (!Number.isFinite(heldQty) || heldQty < 0) return reject('invalid_holding_quantity')

  if (intent.action === 'SELL') {
    const remaining = heldQty - (reserved.sellQuantityBySymbol.get(intent.symbol) || 0)
    if (!Number.isInteger(remaining) || remaining < 1) return reject('no_unreserved_holding')
    return { allowed: true, quantity: remaining, notional: remaining * price }
  }

  if (!Number.isFinite(intent.confidence) || intent.confidence < 0.65 ||
      !Number.isFinite(intent.targetAllocationPct) ||
      !(intent.targetAllocationPct > 0) || intent.targetAllocationPct > positionCap) {
    return reject('invalid_or_low_confidence_proposal')
  }
  if (sessionRealizedPnl <= -(cap * MAX_SESSION_REALIZED_LOSS_PCT)) {
    return reject('session_realized_loss_limit')
  }
  if ((reserved.sellQuantityBySymbol.get(intent.symbol) || 0) > 0) {
    return reject('conflicting_pending_exit')
  }

  const allPositionValue = portfolio.positions.reduce((sum, p) => {
    if (!Number.isFinite(p.marketValue) || p.marketValue < 0) return Number.NaN
    return sum + p.marketValue
  }, 0)
  if (!Number.isFinite(allPositionValue)) return reject('unpriced_portfolio_exposure')
  const currentValue = Number(current?.marketValue ?? 0)
  const pendingSameSymbol = reserved.buyNotionalBySymbol.get(intent.symbol) || 0
  const availableCash = portfolio.cash - reserved.totalBuyNotional
  const remainingPositionCap = cap * positionCap - currentValue - pendingSameSymbol
  const remainingGrossCap = cap * MAX_GROSS_EXPOSURE_PCT - allPositionValue - reserved.totalBuyNotional
  const proposedNotional = Math.min(
    orderCap,
    cap * intent.targetAllocationPct,
    availableCash,
    remainingPositionCap,
    remainingGrossCap
  )
  const quantity = Math.floor(proposedNotional / price)
  if (!(quantity >= 1)) return reject('cash_or_exposure_limit')
  return { allowed: true, quantity, notional: quantity * price }
}
