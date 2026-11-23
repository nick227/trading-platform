import { isResearchBot } from '../../ui/describeBot'
import { get, getPage } from '../../api/client'
import {
  deriveStatus,
  loadBotActivity,
  normalizeBot as normalizeDashboardBot,
  normalizeExecution,
  toNumberOrNull,
} from '../../api/services/botDashboardService'

export { toNumberOrNull }

// Bots whose activity is fetched for Home (one request pair per bot).
export const ACTIVITY_BOT_LIMIT = 10
const PER_BOT_ACTIVITY = 40
export const TRANSACTIONS_PAGE = 15

function asArray(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  return []
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Server valuation → Home's portfolio model. Unavailable stays null. */
export function normalizeValuation(raw) {
  const v = raw?.data ?? raw
  if (!v || typeof v !== 'object') return null
  const n = toNumberOrNull
  return {
    source: v.source ?? null,
    simulated: v.simulated === true,
    session: v.session ?? null,
    startingCash: n(v.startingCash),
    cash: n(v.cash),
    marketValue: n(v.marketValue),
    equity: n(v.equity),
    totalPnl: n(v.totalPnl),
    totalPnlPct: n(v.totalPnlPct),
    realizedPnl: n(v.realizedPnl),
    unrealizedPnl: n(v.unrealizedPnl),
    fillCount: n(v.fillCount) ?? 0,
    valuationComplete: v.valuationComplete !== false,
    unpricedSymbols: Array.isArray(v.unpricedSymbols) ? v.unpricedSymbols : [],
    pricesAsOf: v.pricesAsOf ?? null,
    priceSource: v.priceSource ?? null,
    positions: (Array.isArray(v.positions) ? v.positions : []).map((p) => ({
      symbol: p.symbol,
      quantity: n(p.quantity),
      avgPrice: n(p.avgPrice),
      costBasis: n(p.costBasis),
      price: n(p.price),
      priceSession: p.priceSession ?? null,
      marketValue: n(p.marketValue),
      unrealizedPnl: n(p.unrealizedPnl),
      unrealizedPct: n(p.unrealizedPct),
      weight: n(p.weight),
      bots: Array.isArray(p.bots) ? p.bots : [],
    })),
  }
}

export function normalizeHistory(raw) {
  const h = raw?.data ?? raw
  const points = Array.isArray(h?.points) ? h.points : []
  return {
    source: h?.source ?? null,
    reason: h?.reason ?? null,
    startingCash: toNumberOrNull(h?.startingCash),
    points: points.map((p) => ({ t: p.date, v: toNumberOrNull(p.value), fills: p.fills ?? 0 })),
  }
}

/** Home's view of a bot: dashboard bot + status + latest activity. */
export function normalizeBot(raw, activity = null) {
  const bot = normalizeDashboardBot(raw ?? {})
  const timeline = activity?.timeline ?? []
  const lastMeaningful = timeline.find((i) => !['evaluation', 'skip'].includes(i.category)) ?? timeline[0] ?? null
  return {
    ...bot,
    rulesAvailable: Array.isArray(raw?.rules),
    openPositions: raw?.openPositions && typeof raw.openPositions === 'object' ? raw.openPositions : {},
    running: bot.enabled && !bot.stopped,
    status: deriveStatus(bot, timeline),
    lastActivity: lastMeaningful,
    activityAvailable: activity ? activity.eventsAvailable || activity.executionsAvailable : false,
  }
}

export async function loadTransactions(after = null) {
  const page = await getPage('/executions', { limit: TRANSACTIONS_PAGE, ...(after ? { after } : {}) })
  const rows = asArray(page)
  return {
    items: rows.map((x) => ({ ...normalizeExecution(x), botId: x.botId ?? null })),
    nextCursor: page?.pagination?.nextCursor ?? null,
    hasMore: Boolean(page?.pagination?.hasMore),
  }
}

export async function loadHome() {
  const [valuation, history, bots] = await Promise.all([
    settle(get('/account/valuation')),
    settle(get('/account/value-history', { range: '3M' })),
    settle(get('/bots')),
  ])

  const rawBots = bots.ok ? asArray(bots.value) : []
  const tracked = rawBots.slice(0, ACTIVITY_BOT_LIMIT)
  const activities = await Promise.all(tracked.map((b) => loadBotActivity(b.id, { limit: PER_BOT_ACTIVITY })))
  const activityById = new Map(tracked.map((b, i) => [b.id, activities[i]]))
  const botList = rawBots.map((b) => normalizeBot(b, activityById.get(b.id) ?? null))
  const names = new Map(botList.map((b) => [b.id, b.name]))

  const activity = tracked
    .flatMap((b, i) => activities[i].timeline.map((item) => ({ ...item, botId: b.id, botName: names.get(b.id), researchBot: isResearchBot(b.config) })))
    .sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))
  const anyActivitySource = activities.some((a) => a.eventsAvailable || a.executionsAvailable)

  return {
    valuation: valuation.ok ? normalizeValuation(valuation.value) : null,
    valuationError: valuation.ok ? null : 'Your portfolio value couldn’t be loaded.',
    history: history.ok ? normalizeHistory(history.value) : null,
    bots: botList,
    botNames: names,
    botsError: bots.ok ? null : 'Your bots couldn’t be loaded.',
    activity,
    activityError: tracked.length > 0 && !anyActivitySource ? 'Recent activity couldn’t be loaded.' : null,
  }
}

/** Daily closes for a symbol (Alpha Engine via the API), for the holding chart. */
export async function loadPriceHistory(symbol, range = '3M') {
  const res = await get(`/engine/history/${encodeURIComponent(symbol)}`, { range, interval: '1D' })
  const pts = Array.isArray(res?.points) ? res.points : Array.isArray(res?.data?.points) ? res.data.points : []
  return pts.filter((p) => p && p.t && Number(p.c) > 0).map((p) => ({ t: String(p.t).slice(0, 10), v: Number(p.c) }))
}
