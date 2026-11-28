import { calculateFifoAccounting } from '../botAccountingService.js'

const isSession = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const closeMap = bars => new Map((Array.isArray(bars) ? bars : [])
  .filter(b => Array.isArray(b) && isSession(b[0]) && finite(Number(b[4])) && Number(b[4]) > 0)
  .map(b => [b[0], Number(b[4])]))
const fillDate = fill => {
  if (isSession(fill?.simSession)) return fill.simSession
  if (!fill?.filledAt) return null
  const date = new Date(fill.filledAt)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : null
}

/**
 * Replays ONLY recorded fills against actual closes for each completed session.
 * A point is omitted when any open holding lacks a dated close.
 * Does not backfill prices, invent fills, or use the latest price for a past day.
 */
export function buildPaperEquityHistory({ fills = [], barsBySymbol = new Map(), spyBars = [],
  allocatedCapital, startSession = null, endSession = null, limit = 120,
  accountant = calculateFifoAccounting } = {}) {
  if (!finite(allocatedCapital) || allocatedCapital <= 0) return { points: [], omittedSessions: 0 }
  const spyCloses = closeMap(spyBars)
  const sessions = [...new Set([...spyCloses.keys(), ...[...barsBySymbol.values()]
    .flatMap(bars => (Array.isArray(bars) ? bars : []).map(bar => bar?.[0]))
    .filter(isSession)])].sort().filter(s => (!startSession || s >= startSession) && (!endSession || s <= endSession))
    .slice(-Math.max(1, Math.min(120, limit)))
  if (!sessions.length) return { points: [], omittedSessions: 0 }
  const closesBySymbol = new Map([...barsBySymbol.entries()].map(([sym, bars]) => [sym, closeMap(bars)]))
  const validFills = (Array.isArray(fills) ? fills : []).filter(f => fillDate(f) !== null)
  const firstSpyClose = spyCloses.get(sessions[0]) ?? null
  const points = []
  let omittedSessions = 0
  for (const session of sessions) {
    const completedFills = validFills.filter(f => fillDate(f) <= session)
    const preliminary = accountant(completedFills)
    const prices = {}
    let missingPrice = false
    for (const symbol of Object.keys(preliminary.openPositions || {})) {
      const price = closesBySymbol.get(symbol)?.get(session)
      if (!finite(price) || price <= 0) { missingPrice = true; break }
      prices[symbol] = price
    }
    if (missingPrice) { omittedSessions++; continue }
    const accounting = accountant(completedFills, { currentPrices: prices })
    const pnl = accounting.hasFills
      ? accounting.performance?.totalPnl : 0
    const fees = accounting.hasFills ? accounting.performance?.fees : 0
    if (!finite(pnl) || !finite(fees)) { omittedSessions++; continue }
    const equity = Number((allocatedCapital + pnl - fees).toFixed(2))
    const spyClose = spyCloses.get(session)
    const spyEquity = firstSpyClose > 0 && spyClose > 0
      ? Number((allocatedCapital * spyClose / firstSpyClose).toFixed(2)) : null
    points.push({ t: session, v: equity, spy: spyEquity })
  }
  return { points, omittedSessions }
}
