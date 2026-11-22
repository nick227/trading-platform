/**
 * Portfolio state for risk checks — the SAME model Home shows (portfolioValuationService):
 * the owner's fills (simulator fills only in simulator mode), FIFO holdings, each holding
 * marked at Alpha Engine's latest known close, cash from fills (simulator) or the broker,
 * and an explicit prices-as-of session. User-scoped through the portfolio's owner.
 *
 * Fails closed: if the owner, the account or any holding's price is unknown, it throws, and
 * callers treat the evaluation as rejected. Never substitutes placeholder or zero balances.
 */
import prisma from '../db/prisma.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { valuePortfolio, valueHistory } from '../../../server/src/services/portfolioValuationService.js'
import { simulationConfig } from '../../../server/src/services/simulationService.js'

const num = (v) => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null
}

// One risk evaluation asks for the snapshot several times (gate + four scores); a short
// per-portfolio cache keeps those reads consistent with each other within an evaluation.
const SNAPSHOT_TTL_MS = 5_000
const cache = new Map() // portfolioId -> { at, value }

export function clearRiskSnapshotCache() {
  cache.clear()
}

export async function portfolioRiskSnapshot(portfolioId, {
  prismaClient = prisma, getClient = getBrokerClient, config = simulationConfig(), engine, now = Date.now(), useCache = true,
} = {}) {
  const hit = useCache ? cache.get(portfolioId) : null
  if (hit && now - hit.at < SNAPSHOT_TTL_MS) return hit.value

  const portfolio = await prismaClient.portfolio.findUnique({ where: { id: portfolioId }, select: { userId: true } })
  if (!portfolio?.userId) throw new Error('portfolio_not_found')

  let brokerAccount = null
  if (!config.enabled) {
    const broker = await getClient(portfolio.userId)
    if (!broker) throw new Error('broker_account_unavailable')
    brokerAccount = await broker.getAccount()
    // The broker must report its own equity; it is never reconstructed from partial data.
    if (!(num(brokerAccount?.equity) > 0)) throw new Error('broker_account_unavailable')
  }
  const v = await valuePortfolio(portfolio.userId, {
    prismaClient, config, ...(engine ? { engine } : {}),
    fetchBrokerAccount: async () => brokerAccount,
  })
  if (v.source === 'none') throw new Error('broker_account_unavailable')
  if (!v.valuationComplete) throw new Error(`price_unavailable:${v.unpricedSymbols.join(',')}`)
  if (v.equity === null || !(v.equity > 0) || v.cash === null) throw new Error('portfolio_valuation_unavailable')

  const value = {
    userId: portfolio.userId,
    source: v.source,
    simulated: v.simulated,
    startingCash: v.startingCash,
    cash: v.cash,
    equity: v.equity,
    marketValue: v.marketValue ?? 0, // valuationComplete ⇒ every holding is priced
    buyingPower: v.simulated ? Math.max(0, v.cash) : num(brokerAccount?.buying_power ?? brokerAccount?.buyingPower),
    positions: v.positions.map((p) => ({
      ticker: p.symbol, quantity: p.quantity, avgPrice: p.avgPrice, costBasis: p.costBasis,
      price: p.price, value: p.marketValue, unrealizedPnl: p.unrealizedPnl,
    })),
    realizedPnl: v.realizedPnl,
    unrealizedPnl: v.unrealizedPnl,
    pricesAsOf: v.pricesAsOf,
  }
  cache.set(portfolioId, { at: now, value })
  return value
}

/** Back-compatible account view used by the stress scores. */
export async function brokerAccountSnapshot(portfolioId, opts = {}) {
  const s = await portfolioRiskSnapshot(portfolioId, opts)
  return { cash: s.cash, equity: s.equity, buyingPower: s.buyingPower, simulated: s.simulated, pricesAsOf: s.pricesAsOf }
}

/**
 * Drawdown and the latest one-session loss from the owner's value history (same series as
 * Home's chart). Peak includes starting cash and current equity. Outside the simulator no
 * history is recorded, so both are null and callers keep their previous behaviour.
 */
export async function portfolioRiskHistory(snapshot, { prismaClient = prisma, config = simulationConfig(), engine } = {}) {
  if (!config.enabled) return { drawdown: null, sessionLoss: null, peak: null }
  const h = await valueHistory(snapshot.userId, { prismaClient, config, ...(engine ? { engine } : {}) })
  const values = h.points.map((p) => p.value).filter((v) => v !== null)
  const peak = Math.max(snapshot.startingCash ?? 0, snapshot.equity, ...values)
  const reference = values.length >= 2 ? values[values.length - 2] : snapshot.startingCash
  return {
    peak,
    drawdown: peak > 0 ? Math.max(0, (peak - snapshot.equity) / peak) : 0,
    sessionLoss: reference !== null && reference !== undefined ? Math.max(0, reference - snapshot.equity) : 0,
  }
}
