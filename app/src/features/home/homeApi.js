import { get } from '../../api/client'
import {
  deriveStatus,
  loadBotActivity,
  normalizeBot as normalizeDashboardBot,
  pauseBot,
  resumeBot,
  toNumberOrNull,
} from '../../api/services/botDashboardService'

export { toNumberOrNull }

// Max bots whose activity is fetched for Home.
export const ACTIVITY_BOT_LIMIT = 10
export const ACTIVITY_ITEM_LIMIT = 5
const PER_BOT_ACTIVITY = 10

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

/** Home's view of a bot: dashboard bot + status + latest activity. */
export function normalizeBot(raw, activity = null) {
  const bot = normalizeDashboardBot(raw ?? {})
  const timeline = activity?.timeline ?? []
  return {
    ...bot,
    running: bot.enabled && !bot.stopped,
    status: deriveStatus(bot, timeline),
    lastActivity: timeline[0] ?? null,
    activityAvailable: activity ? activity.eventsAvailable || activity.executionsAvailable : false,
  }
}

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

  const rawBots = bots.ok ? asArray(bots.value) : []
  const tracked = rawBots.slice(0, ACTIVITY_BOT_LIMIT)
  const activities = await Promise.all(tracked.map((b) => loadBotActivity(b.id, { limit: PER_BOT_ACTIVITY })))
  const activityById = new Map(tracked.map((b, i) => [b.id, activities[i]]))

  const botList = rawBots.map((b) => normalizeBot(b, activityById.get(b.id) ?? null))
  const names = new Map(botList.map((b) => [b.id, b.name]))

  const activity = tracked
    .flatMap((b, i) => activities[i].timeline.map((item) => ({ ...item, botId: b.id, botName: names.get(b.id) })))
    .sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))
    .slice(0, ACTIVITY_ITEM_LIMIT)

  const anyActivitySource = activities.some((a) => a.eventsAvailable || a.executionsAvailable)

  return {
    account: account.ok ? normalizeAccount(account.value) : null,
    today: today.ok ? normalizeToday(today.value) : null,
    bots: botList,
    botsError: bots.ok ? null : 'Could not load your bots.',
    activity,
    activityError: tracked.length > 0 && !anyActivitySource ? 'Could not load recent activity.' : null,
  }
}

export async function setBotRunning(botId, running) {
  return running ? resumeBot(botId) : pauseBot(botId)
}
