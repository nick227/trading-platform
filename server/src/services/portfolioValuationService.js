/**
 * Portfolio valuation — the single authoritative model behind every portfolio figure
 * (account summary, holdings, value history, bot P/L).
 *
 *   cash        = starting cash − Σ(signed fill notional) − fees − commission
 *   holdings    = FIFO lots from broker-reported fills (botAccountingService)
 *   prices      = Alpha Engine daily close, latest known session ("marks")
 *   equity      = cash + Σ quantity × mark          (null when any holding is unpriced)
 *   total P/L   = equity − starting cash             (null when equity is null)
 *
 * Simulator mode counts only simulator replay fills, dated by the replayed session.
 * Unavailable values are null, never 0.
 */
import prisma from '../loaders/prisma.js'
import { calculateFifoAccounting, isBrokerFill } from './botAccountingService.js'
import { currentSimSession, parseSimOrderId, simulationConfig, isSimulatedOrderId } from './simulationService.js'
import { engineClient } from '../clients/engine.js'

const round2 = (n) => Number(n.toFixed(2))

/** Market session a fill belongs to: the simulator session for simulator fills, else the fill date (UTC). */
export function fillSession(exec) {
  const sim = parseSimOrderId(exec?.brokerOrderId)
  if (sim) return sim.session
  const at = new Date(exec?.filledAt ?? exec?.createdAt ?? NaN)
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10)
}

function signedQty(exec) {
  const qty = Number(exec.filledQuantity)
  return String(exec.direction).toLowerCase() === 'sell' ? -qty : qty
}

function sortFills(fills) {
  return [...fills].sort((a, b) => {
    const sa = fillSession(a) ?? ''
    const sb = fillSession(b) ?? ''
    if (sa !== sb) return sa < sb ? -1 : 1
    const ta = new Date(a.filledAt ?? a.createdAt ?? 0).getTime()
    const tb = new Date(b.filledAt ?? b.createdAt ?? 0).getTime()
    if (ta !== tb) return ta - tb
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

/** The fills that belong to a user's portfolio in the current mode. */
export async function loadPortfolioFills(userId, { prismaClient = prisma, config = simulationConfig() } = {}) {
  const rows = await prismaClient.execution.findMany({
    where: { userId, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } },
    orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  const fills = rows.filter(isBrokerFill)
  return sortFills(config.enabled ? fills.filter((e) => isSimulatedOrderId(e.brokerOrderId)) : fills.filter((e) => !isSimulatedOrderId(e.brokerOrderId)))
}

/** Latest known daily close per ticker. Missing prices are omitted (→ unvalued), never guessed. */
export async function loadPriceMarks(tickers, { engine = engineClient } = {}) {
  const unique = [...new Set((tickers ?? []).map((t) => String(t).toUpperCase()))]
  const prices = {}
  const sessions = {}
  await Promise.all(unique.map(async (ticker) => {
    try {
      const sc = await engine.getSessionClose(ticker)
      const close = Number(sc?.close)
      if (Number.isFinite(close) && close > 0) {
        prices[ticker] = close
        sessions[ticker] = sc.session ?? null
      }
    } catch { /* unvalued */ }
  }))
  return { prices, sessions }
}

/** Open quantity per bot per ticker (FIFO), for "which bots hold this". */
export function openQuantityByBot(fills) {
  const byBot = new Map()
  for (const f of fills) {
    if (!f.botId) continue
    if (!byBot.has(f.botId)) byBot.set(f.botId, [])
    byBot.get(f.botId).push(f)
  }
  const out = {} // ticker -> [{ botId, quantity }]
  for (const [botId, botFills] of byBot) {
    const { openPositions } = calculateFifoAccounting(botFills)
    for (const [ticker, pos] of Object.entries(openPositions)) {
      ;(out[ticker] ??= []).push({ botId, quantity: pos.quantity })
    }
  }
  return out
}

/**
 * Pure valuation from fills + marks. `startingCash` null (broker mode) means cash and
 * equity come from the broker instead (`brokerCash`, `brokerEquity`).
 */
export function buildValuation({ fills, marks = { prices: {}, sessions: {} }, startingCash = null, brokerCash = null, source, session = null }) {
  const accounting = calculateFifoAccounting(fills, { currentPrices: marks.prices })
  const botHoldings = openQuantityByBot(fills)

  let cash = null
  if (startingCash !== null) {
    let c = startingCash
    for (const f of fills) c -= signedQty(f) * Number(f.filledPrice) + (Number(f.fees) || 0) + (Number(f.commission) || 0)
    cash = round2(c)
  } else if (brokerCash !== null && Number.isFinite(Number(brokerCash))) {
    cash = round2(Number(brokerCash))
  }

  const lastFillSession = {}
  for (const f of fills) lastFillSession[String(f.ticker).toUpperCase()] = fillSession(f)

  let allPriced = true
  let marketValue = 0
  const positions = Object.values(accounting.openPositions).map((p) => {
    const price = p.currentPrice ?? null
    const value = price !== null ? round2(p.quantity * price) : null
    if (value === null) allPriced = false
    else marketValue += value
    return {
      symbol: p.ticker,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      costBasis: p.costBasis,
      price,
      priceSession: marks.sessions?.[p.ticker] ?? null,
      marketValue: value,
      unrealizedPnl: p.unrealizedPnl ?? null,
      unrealizedPct: p.unrealizedPnl !== null && p.unrealizedPnl !== undefined && p.costBasis > 0 ? Number(((p.unrealizedPnl / p.costBasis) * 100).toFixed(2)) : null,
      firstFilledAt: p.lots?.[0]?.filledAt ?? null,
      lastFillSession: lastFillSession[p.ticker] ?? null,
      bots: botHoldings[p.ticker] ?? [],
    }
  })

  const mv = allPriced ? round2(marketValue) : null
  const equity = cash !== null && mv !== null ? round2(cash + mv) : null
  for (const p of positions) {
    p.weight = equity && p.marketValue !== null ? Number(((p.marketValue / equity) * 100).toFixed(2)) : null
  }
  positions.sort((a, b) => (b.marketValue ?? b.costBasis) - (a.marketValue ?? a.costBasis))

  const sessions = Object.values(marks.sessions ?? {}).filter(Boolean).sort()
  const perf = accounting.performance
  return {
    source,
    simulated: source === 'simulator',
    session,
    startingCash,
    cash,
    marketValue: mv,
    costBasis: round2(positions.reduce((s, p) => s + p.costBasis, 0)),
    equity,
    totalPnl: equity !== null && startingCash !== null ? round2(equity - startingCash) : null,
    totalPnlPct: equity !== null && startingCash ? Number((((equity - startingCash) / startingCash) * 100).toFixed(2)) : null,
    realizedPnl: perf ? perf.realizedPnl : 0,
    unrealizedPnl: perf ? perf.unrealizedPnl : 0,
    fees: perf ? perf.fees : 0,
    fillCount: accounting.fillCount,
    valuationComplete: allPriced,
    unpricedSymbols: positions.filter((p) => p.price === null).map((p) => p.symbol),
    pricesAsOf: sessions.length ? sessions[sessions.length - 1] : null,
    priceSource: 'Alpha Engine daily close (latest known session)',
    positions,
  }
}

/**
 * The user's portfolio valuation in the current mode.
 *   simulator → starting cash + simulator fills
 *   broker    → broker cash; holdings from the user's broker fills
 *   none      → no account
 */
export async function valuePortfolio(userId, { prismaClient = prisma, config = simulationConfig(), engine = engineClient, fetchBrokerAccount = null } = {}) {
  const fills = await loadPortfolioFills(userId, { prismaClient, config })
  const tickers = [...new Set(fills.map((f) => String(f.ticker).toUpperCase()))]
  const marks = await loadPriceMarks(tickers, { engine })
  if (config.enabled) {
    const session = config.mode === 'paper_daily' ? await currentSimSession({ config, engine }).catch(() => null) : config.session
    return { ...buildValuation({ fills, marks, startingCash: config.startingCash, source: 'simulator', session }), simMode: config.mode }
  }
  const broker = fetchBrokerAccount ? await fetchBrokerAccount(userId) : null
  if (!broker) return { ...buildValuation({ fills, marks, source: 'none' }), cash: null, equity: null, totalPnl: null, totalPnlPct: null }
  const v = buildValuation({ fills, marks, brokerCash: broker.cash, source: 'broker' })
  const brokerEquity = Number(broker.equity)
  return { ...v, equity: Number.isFinite(brokerEquity) ? round2(brokerEquity) : v.equity }
}

/**
 * Daily portfolio value series from fills × daily closes — the same model as
 * valuePortfolio, so the last point equals the current equity when closes agree.
 * Starts at the first fill session; earlier sessions are not invented.
 */
export function buildValueSeries({ fills, closesByTicker, startingCash }) {
  if (startingCash === null || !fills.length) return []
  const firstSession = fillSession(fills[0])
  const dates = new Set()
  for (const pts of Object.values(closesByTicker)) for (const p of pts) if (p.t >= firstSession) dates.add(p.t)
  dates.add(firstSession)
  const sorted = [...dates].sort()

  const closeOn = {} // ticker -> sorted points
  for (const [t, pts] of Object.entries(closesByTicker)) closeOn[t] = [...pts].sort((a, b) => (a.t < b.t ? -1 : 1))
  const priceAt = (ticker, date) => {
    const pts = closeOn[ticker] ?? []
    let v = null
    for (const p of pts) { if (p.t <= date) v = p.c; else break }
    return v
  }

  const out = []
  let i = 0
  let cash = startingCash
  const qty = {}
  for (const date of sorted) {
    let fillsToday = 0
    while (i < fills.length && fillSession(fills[i]) <= date) {
      const f = fills[i]
      const t = String(f.ticker).toUpperCase()
      cash -= signedQty(f) * Number(f.filledPrice) + (Number(f.fees) || 0) + (Number(f.commission) || 0)
      qty[t] = (qty[t] ?? 0) + signedQty(f)
      fillsToday += 1
      i += 1
    }
    let value = cash
    let complete = true
    for (const [t, q] of Object.entries(qty)) {
      if (Math.abs(q) < 1e-9) continue
      const px = priceAt(t, date)
      if (px === null) { complete = false; break }
      value += q * px
    }
    out.push({ date, value: complete ? round2(value) : null, cash: round2(cash), fills: fillsToday })
  }
  return out
}

export async function valueHistory(userId, { prismaClient = prisma, config = simulationConfig(), engine = engineClient, range = '3M' } = {}) {
  if (!config.enabled) return { source: 'unavailable', reason: 'Value history is derived from simulator fills; no broker history is stored.', points: [] }
  const fills = await loadPortfolioFills(userId, { prismaClient, config })
  if (!fills.length) return { source: 'simulator', startingCash: config.startingCash, points: [] }
  const tickers = [...new Set(fills.map((f) => String(f.ticker).toUpperCase()))]
  const closesByTicker = {}
  await Promise.all(tickers.map(async (t) => {
    try {
      const h = await engine.getHistory(t, range, '1D')
      const pts = Array.isArray(h?.points) ? h.points : Array.isArray(h?.data?.points) ? h.data.points : []
      closesByTicker[t] = pts.filter((p) => p && p.t && Number(p.c) > 0).map((p) => ({ t: String(p.t).slice(0, 10), c: Number(p.c) }))
    } catch { closesByTicker[t] = [] }
  }))
  return {
    source: 'simulator',
    startingCash: config.startingCash,
    priceSource: 'Alpha Engine daily close',
    points: buildValueSeries({ fills, closesByTicker, startingCash: config.startingCash }),
  }
}

export default { valuePortfolio, valueHistory, buildValuation, buildValueSeries, loadPriceMarks, fillSession }
