/**
 * Site-wide results per bot template (featured bot), from actual bot fills only.
 * Aggregate figures — no per-user data. Historical template replays are NOT mixed in.
 *
 *   P/L uses the same FIFO + price marks as the portfolio valuation.
 *   Win rate is reported only with at least MIN_CLOSED_FOR_WIN_RATE closed trades.
 */
import prisma from '../loaders/prisma.js'
import { calculateFifoAccounting, isBrokerFill } from './botAccountingService.js'
import { isSimulatedOrderId, simulationConfig } from './simulationService.js'
import { fillSession, loadPriceMarks } from './portfolioValuationService.js'

export const MIN_CLOSED_FOR_WIN_RATE = 5
const round2 = (n) => Number(n.toFixed(2))

/** Publication-level research summary from a verified decision event (no user data). */
export function researchSummaryFromEvent(event) {
  const meta = event?.metadata
  const ev = meta?.researchEvidence
  if (!ev) return null
  const evaluation = ev.ranking?.evaluation ?? null
  const h = evaluation?.holdout ?? null
  return {
    model: ev.strategyId ?? ev.features?.model_id ?? null,
    publicationId: ev.ranking?.publicationId ?? ev.features?.publicationId ?? null,
    observedAt: ev.observedAt ?? null,
    horizon: ev.horizon ?? null,
    mode: ev.ranking?.mode ?? ev.mode ?? null,
    method: evaluation?.method ?? null,
    edgeOverBaseline: evaluation ? evaluation.edgeOverBaseline === true : null,
    genuineOutOfSample: evaluation ? evaluation.genuineOutOfSample === true : null,
    holdout: h ? {
      hitRate: h.precision ?? null,
      baselineRate: h.baselineRate ?? null,
      samples: h.samples ?? null,
      signals: h.signals ?? null,
      start: h.start ?? null,
      end: h.end ?? null,
    } : null,
    verified: Boolean(meta?.researchTrace?.evidenceSha256),
  }
}

/** Pure aggregation, exported for tests. */
export function aggregateTemplate({ bots, fillsByBot, marks }) {
  let fills = 0, buys = 0, sells = 0, wins = 0, simulatedFills = 0
  let realized = 0, unrealized = 0, fees = 0, capitalInUse = 0
  let unrealizedKnown = true
  const symbols = new Set()
  const sessions = []
  for (const bot of bots) {
    const botFills = (fillsByBot.get(bot.id) ?? []).filter(isBrokerFill)
    if (!botFills.length) continue
    const acc = calculateFifoAccounting(botFills, { currentPrices: marks.prices })
    for (const f of botFills) {
      fills += 1
      symbols.add(String(f.ticker).toUpperCase())
      if (isSimulatedOrderId(f.brokerOrderId)) simulatedFills += 1
      const s = fillSession(f)
      if (s) sessions.push(s)
      if (String(f.direction).toLowerCase() === 'sell') {
        sells += 1
        if ((acc.perExecutionPnl.get(f.id) ?? 0) > 0) wins += 1
      } else buys += 1
    }
    realized += acc.performance?.realizedPnl ?? 0
    fees += acc.performance?.fees ?? 0
    capitalInUse += acc.capitalInUse ?? 0
    if (acc.performance?.unrealizedPnl === null) unrealizedKnown = false
    else unrealized += acc.performance?.unrealizedPnl ?? 0
  }
  sessions.sort()
  const none = fills === 0 // no fills → results are "none yet", not zero
  const unrealizedPnl = none ? null : unrealizedKnown ? round2(unrealized) : null
  return {
    bots: bots.length,
    runningBots: bots.filter((b) => b.enabled).length,
    users: new Set(bots.map((b) => b.userId)).size,
    fills,
    buys,
    closedTrades: sells,
    wins,
    winRate: sells >= MIN_CLOSED_FOR_WIN_RATE ? round2((wins / sells) * 100) : null,
    realizedPnl: none ? null : round2(realized),
    unrealizedPnl,
    totalPnl: unrealizedPnl === null ? null : round2(realized + unrealized),
    fees: none ? null : round2(fees),
    capitalInUse: none ? null : round2(capitalInUse),
    symbols: [...symbols].sort(),
    firstSession: sessions[0] ?? null,
    lastSession: sessions[sessions.length - 1] ?? null,
    fillSource: fills === 0 ? null : simulatedFills === fills ? 'simulator' : simulatedFills === 0 ? 'paper_broker' : 'mixed',
  }
}

export async function getTemplateStats({ prismaClient = prisma, config = simulationConfig() } = {}) {
  const [templates, bots] = await Promise.all([
    prismaClient.botTemplate.findMany({ orderBy: { name: 'asc' } }),
    prismaClient.bot.findMany({ where: { deletedAt: null, templateId: { not: null } }, select: { id: true, userId: true, templateId: true, enabled: true } }),
  ])
  const botIds = bots.map((b) => b.id)
  const rows = botIds.length
    ? await prismaClient.execution.findMany({ where: { botId: { in: botIds }, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } } })
    : []
  const fillRows = config.enabled ? rows.filter((e) => isSimulatedOrderId(e.brokerOrderId)) : rows
  const fillsByBot = new Map()
  for (const f of fillRows) {
    if (!fillsByBot.has(f.botId)) fillsByBot.set(f.botId, [])
    fillsByBot.get(f.botId).push(f)
  }
  const marks = await loadPriceMarks(fillRows.map((f) => f.ticker))

  // Latest verified research decision per template (publication-level evidence only).
  const research = {}
  const researchTemplates = new Set(bots.map((b) => b.templateId))
  for (const templateId of researchTemplates) {
    const ids = bots.filter((b) => b.templateId === templateId).map((b) => b.id)
    const evt = await prismaClient.botEvent.findFirst({
      where: { botId: { in: ids }, type: 'decision_made' },
      orderBy: { createdAt: 'desc' },
    })
    research[templateId] = researchSummaryFromEvent(evt)
  }

  const pricesAsOf = Object.values(marks.sessions).filter(Boolean).sort().pop() ?? null
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    botType: t.botType,
    results: { ...aggregateTemplate({ bots: bots.filter((b) => b.templateId === t.id), fillsByBot, marks }), pricesAsOf },
    research: research[t.id] ?? null,
  }))
}

export default { getTemplateStats, aggregateTemplate, researchSummaryFromEvent }
