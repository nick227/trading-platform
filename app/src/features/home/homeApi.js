import { get, put } from '../../api/client'

// Max bots whose recent executions are fetched for the activity feed.
export const ACTIVITY_BOT_LIMIT = 10
export const ACTIVITY_ITEM_LIMIT = 5

/** Number or null — never coerces missing values to 0. */
export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  return []
}

export function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    equity: toNumberOrNull(raw.equity),
    cash: toNumberOrNull(raw.cash),
  }
}

export function normalizeToday(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    realizedPnl: toNumberOrNull(raw.pnl),
    trades: toNumberOrNull(raw.trades),
  }
}

export function normalizeBot(raw) {
  const config = raw?.config && typeof raw.config === 'object' ? raw.config : {}
  const tickers = Array.isArray(config.tickers) ? config.tickers.filter(Boolean) : []
  return {
    id: raw.id,
    name: raw.name || 'Untitled bot',
    running: raw.enabled === true,
    strategyName: raw.strategy?.name ?? null,
    botType: raw.botType ?? null,
    // allocatedAmount is what the bot engine sizes orders from (set by /bots/new).
    allocation: toNumberOrNull(config.allocatedAmount ?? config.allocation),
    tickers,
    tradeCount: toNumberOrNull(raw._count?.executions),
    updatedAt: raw.updatedAt ?? null,
  }
}

export function normalizeExecution(raw, botsById) {
  return {
    id: raw.id,
    botId: raw.botId,
    botName: botsById.get(raw.botId)?.name ?? 'Bot',
    ticker: raw.ticker ?? '—',
    direction: raw.direction ?? null,
    quantity: toNumberOrNull(raw.quantity),
    status: raw.status ?? null,
    filledPrice: toNumberOrNull(raw.filledPrice),
    at: raw.filledAt ?? raw.createdAt ?? null,
  }
}

/** Settled value or null, so one failing source doesn't blank the page. */
async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function loadHome() {
  const [account, today, bots] = await Promise.all([
    settle(get('/account')),
    settle(get('/performance/today')),
    settle(get('/bots')),
  ])

  const botList = bots.ok ? asArray(bots.value).map(normalizeBot) : []
  const botsById = new Map(botList.map((b) => [b.id, b]))

  const activityResults = await Promise.all(
    botList
      .slice(0, ACTIVITY_BOT_LIMIT)
      .map((bot) => settle(get('/executions', { botId: bot.id, limit: ACTIVITY_ITEM_LIMIT })))
  )
  const activity = activityResults
    .filter((r) => r.ok)
    .flatMap((r) => asArray(r.value))
    .map((e) => normalizeExecution(e, botsById))
    .sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))
    .slice(0, ACTIVITY_ITEM_LIMIT)

  return {
    account: account.ok ? normalizeAccount(account.value) : null,
    today: today.ok ? normalizeToday(today.value) : null,
    bots: botList,
    botsError: bots.ok ? null : 'Could not load your bots.',
    activity,
    activityError:
      activityResults.length > 0 && activityResults.every((r) => !r.ok)
        ? 'Could not load recent activity.'
        : null,
  }
}

export async function setBotRunning(botId, running) {
  return put(`/bots/${botId}`, { enabled: running })
}
