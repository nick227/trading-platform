import { isResearchBot } from '../../ui/describeBot'
import { get } from '../../api/client'
import { loadBotActivity, toNumberOrNull } from '../../api/services/botDashboardService'
import { normalizeBot } from '../home/homeApi'

const ACTIVITY_BOT_LIMIT = 10

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

const asArray = (v) => (Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [])

/** Site-wide results for one template, from actual bot fills (never a backtest). */
export function normalizeResults(r) {
  if (!r || typeof r !== 'object') return null
  const n = toNumberOrNull
  return {
    bots: n(r.bots) ?? 0,
    runningBots: n(r.runningBots) ?? 0,
    users: n(r.users) ?? 0,
    fills: n(r.fills) ?? 0,
    closedTrades: n(r.closedTrades) ?? 0,
    wins: n(r.wins) ?? 0,
    winRate: n(r.winRate),
    realizedPnl: n(r.realizedPnl),
    unrealizedPnl: n(r.unrealizedPnl),
    totalPnl: n(r.totalPnl),
    capitalInUse: n(r.capitalInUse),
    symbols: Array.isArray(r.symbols) ? r.symbols : [],
    firstSession: r.firstSession ?? null,
    lastSession: r.lastSession ?? null,
    fillSource: r.fillSource ?? null,
    pricesAsOf: r.pricesAsOf ?? null,
  }
}

export function normalizeFeatured(template, platformRow) {
  const config = template?.config && typeof template.config === 'object' ? template.config : {}
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    botType: template.botType,
    available: template.botType === 'rule_based',
    config,
    rules: Array.isArray(template.rules) ? template.rules : [],
    results: normalizeResults(platformRow?.results),
    research: platformRow?.research ?? null,
  }
}

export async function loadBotsPage() {
  const [catalog, platform, bots, evidence] = await Promise.all([
    settle(get('/bots/catalog')),
    settle(get('/strategies/platform')),
    settle(get('/bots')),
    settle(get('/public/strategies')),
  ])

  const templates = catalog.ok
    ? (Array.isArray(catalog.value) ? catalog.value : [...(catalog.value?.ruleBased ?? []), ...(catalog.value?.strategyBased ?? [])])
    : []
  const platformRows = platform.ok ? asArray(platform.value) : []
  const byId = new Map(platformRows.map((p) => [p.id, p]))
  const evidenceById = new Map((evidence.ok ? asArray(evidence.value) : []).map((e) => [e.templateId, e]))
  const featured = templates.map((t) => ({ ...normalizeFeatured(t, byId.get(t.id)), evidence: evidenceById.get(t.id) ?? null }))

  const rawBots = bots.ok ? asArray(bots.value) : []
  const tracked = rawBots.slice(0, ACTIVITY_BOT_LIMIT)
  const activities = await Promise.all(tracked.map((b) => loadBotActivity(b.id, { limit: 40 })))
  const activityById = new Map(tracked.map((b, i) => [b.id, activities[i]]))
  const templateRules = new Map(featured.map((f) => [f.id, f.rules]))
  const myBots = rawBots.map((b) => ({
    ...normalizeBot(b, activityById.get(b.id) ?? null),
    rulesAvailable: Array.isArray(b.rules) || templateRules.has(b.templateId),
    rules: Array.isArray(b.rules) ? b.rules : templateRules.get(b.templateId) ?? [],
    templateName: featured.find((f) => f.id === b.templateId)?.name ?? null,
    fillCount: (activityById.get(b.id)?.executions ?? []).filter((x) => x.filledQuantity > 0).length,
  }))
  const names = new Map(myBots.map((b) => [b.id, b.name]))
  const decisions = tracked
    .flatMap((b, i) => activities[i].timeline.map((item) => ({ ...item, botId: b.id, botName: names.get(b.id), researchBot: isResearchBot(b.config) })))
    .sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))

  return {
    featured,
    featuredError: catalog.ok ? null : 'Featured bots couldn’t be loaded.',
    resultsError: platform.ok ? null : 'Site-wide results couldn’t be loaded.',
    myBots,
    myBotsError: bots.ok ? null : 'Your bots couldn’t be loaded.',
    decisions,
  }
}
