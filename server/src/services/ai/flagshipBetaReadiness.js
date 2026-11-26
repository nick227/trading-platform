/**
 * Read-only beta preflight and deterministic release-gate assessment.
 * The code merge cannot activate a paid model, scheduler, or real broker.
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'
import { loadStockTraderPaperPortfolio } from './stockTraderPortfolio.js'
import { loadBotFills, calculateFifoAccounting } from '../botAccountingService.js'
import { readEmergencyStop } from '../emergencyStopService.js'
import {
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_STRATEGY_ID,
  AI_STOCK_TRADER_AGENT_VERSION
} from './strategies/aiStockTraderStrategy.js'

const POSITIVE_INT = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
const HOUR = 3600_000

export function evaluateFlagshipAiBetaReadiness({
  bot, portfolio, env = {}, observations = {}, expectedSession, now = new Date()
}) {
  const checks = []
  const check = (id, ok, explanation) => {
    checks.push({ id, passed: ok === true, explanation })
  }
  const config = bot?.config
  check('platform_owned_paper_bot',
    Boolean(bot?.id === AI_STOCK_TRADER_PLATFORM_BOT_ID &&
      bot.templateId === AI_STOCK_TRADER_STRATEGY_ID && config?.mode === 'paper' &&
      !bot.deletedAt && portfolio?.id === bot.portfolioId &&
      portfolio?.userId === bot.userId),
    'Dedicated platform bot and portfolio must be paper-only, owned consistently and not deleted.')
  check('pinned_generalist_v2',
    config?.strategyVersion === AI_STOCK_TRADER_AGENT_VERSION &&
      config?.research?.maxCallsPerCycle === 2,
    'Explicit migration to immutable two-call vanilla v2 is required.')
  check('execution_limits',
    Number(config?.execution?.maxPositionPct) > 0 &&
      Number(config?.execution?.maxPositionPct) <= 0.2 &&
      Number(config?.execution?.maxOrdersPerCycle) >= 1 &&
      Number(config?.execution?.maxOrdersPerCycle) <= 2 &&
      Number(config?.execution?.maxOrderNotional) > 0 &&
      Number(config?.execution?.maxOrderNotional) <= 2000,
    'Code-owned position, notional and order caps must remain enforced.')
  check('explicit_flags',
    env.ENABLE_FLAGSHIP_STOCK_TRADER === 'true' &&
      env.ENABLE_AI_PAID_CALLS === 'true' &&
      env.ENABLE_AI_SCHEDULER === 'true',
    'Flagship, paid API and scheduler flags must be explicitly enabled.')
  const reserve = Number(env.AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL ?? 5)
  check('budget_for_two_calls',
    POSITIVE_INT(reserve) &&
      POSITIVE_INT(env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS) &&
      POSITIVE_INT(env.AI_STOCK_TRADER_BOT_BUDGET_CENTS) &&
      Number(env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS) >= 2 * reserve &&
      Number(env.AI_STOCK_TRADER_BOT_BUDGET_CENTS) >= 2 * reserve,
    'Both durable spending caps must cover at least two reserved provider calls.')
  check('provider_configured',
    typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0,
    'Server-only provider API key must be configured without leaking its value.')
  check('usage_schema',
    observations.usageTablesAvailable === true,
    'The AI usage tables must be verified against the deployed database.')
  check('fresh_market_data',
    observations.marketSession === expectedSession && typeof expectedSession === 'string',
    'The benchmark market feed must contain the latest completed exchange session.')
  check('paper_portfolio_reconciled',
    observations.portfolioReconciled === true,
    'FIFO paper holdings, cash, fees and current marks must reconcile.')
  check('no_unresolved_executions',
    observations.unresolvedExecutionCount === 0,
    'No simulated orders may remain in uncertain processing/reconciliation states.')
  check('emergency_stop_clear',
    observations.emergencyStopped === false,
    'The platform account emergency-stop must be inactive.')
  const smoke = observations.providerSmokeVerifiedAt
    ? new Date(observations.providerSmokeVerifiedAt).getTime() : NaN
  check('recent_explicit_provider_smoke',
    Number.isFinite(smoke) && smoke <= now.getTime() &&
      now.getTime() - smoke <= 24 * HOUR,
    'An explicitly requested, budgeted real-provider smoke test must pass within 24 hours.')
  check('db_integration_attested',
    observations.dbIntegrationAttested === true,
    'An operator must attest real-DB concurrent fill and settlement verification.')
  const blockers = checks.filter(c => !c.passed).map(c => c.id)
  return {
    status: blockers.length ? 'blocked' : 'ready_for_operator_enable',
    readyToEnable: blockers.length === 0,
    botEnabled: bot?.enabled === true,
    expectedSession: expectedSession || null,
    checkedAt: now.toISOString(),
    checks,
    blockers,
    note: 'Preflight does not activate trading, place orders, call the provider, or prove investment performance.'
  }
}

export async function readFlagshipAiBetaReadiness({
  prismaClient = prisma, engine = engineClient,
  now = new Date(), env = process.env
} = {}) {
  const bot = await prismaClient.bot.findUnique({
    where: { id: AI_STOCK_TRADER_PLATFORM_BOT_ID }
  })
  const portfolio = bot
    ? await prismaClient.portfolio.findUnique({ where: { id: bot.portfolioId } })
    : null
  const expectedSession = getExpectedCompletedExchangeSession(now)
  const observations = {
    usageTablesAvailable: false,
    marketSession: null,
    portfolioReconciled: false,
    unresolvedExecutionCount: null,
    emergencyStopped: null,
    providerSmokeVerifiedAt: null,
    dbIntegrationAttested: env.AI_STOCK_TRADER_DB_INTEGRATION_ATTESTED === 'true'
  }

  try {
    if (prismaClient.aiUsageBucket?.count && prismaClient.aiUsageCall?.count) {
      await Promise.all([prismaClient.aiUsageBucket.count(), prismaClient.aiUsageCall.count()])
      observations.usageTablesAvailable = true
    }
  } catch { /* absent migration is a blocking condition */ }

  try {
    const from = new Date(Date.parse(expectedSession + 'T00:00:00Z') - 7 * 86400000)
      .toISOString().slice(0, 10)
    const data = await engine.getDailyBars('SPY', from, expectedSession)
    observations.marketSession = data?.bars?.at(-1)?.[0] || null
  } catch { /* stale or unavailable feed remains blocking */ }

  if (bot) {
    try {
      observations.unresolvedExecutionCount = await prismaClient.execution.count({
        where: {
          botId: bot.id,
          status: { in: ['processing', 'submitted', 'partially_filled', 'needs_reconciliation'] }
        }
      })
    } catch { /* unknown is never interpreted as zero */ }
    try {
      const user = await prismaClient.user.findUnique({
        where: { id: bot.userId }, select: { riskSettings: true }
      })
      observations.emergencyStopped = user ? readEmergencyStop(user.riskSettings).active : null
    } catch { /* unknown remains blocking */ }
    try {
      const historical = await prismaClient.botEvent.findMany({
        where: { botId: bot.id, type: 'signal_hold' },
        orderBy: { createdAt: 'desc' }, take: 30
      })
      const approved = historical.find(event =>
        event.metadata?.status === 'provider_smoke_verified' &&
        typeof event.metadata?.verifiedAt === 'string')
      observations.providerSmokeVerifiedAt = approved?.metadata?.verifiedAt || null
    } catch { /* no smoke evidence remains blocking */ }

    if (observations.marketSession === expectedSession) {
      try {
        const fills = await loadBotFills(bot.id, { prismaClient })
        const account = calculateFifoAccounting(fills)
        const heldSymbols = Object.entries(account.openPositions || {})
          .filter(([,p]) => Number(p.quantity) > 0).map(([symbol]) => symbol)
        const shortlist = await Promise.all(heldSymbols.map(async symbol => {
          const quote = await engine.getSessionClose(symbol, expectedSession)
          if (quote?.session !== expectedSession || !(Number(quote.close) > 0)) {
            throw new Error('Portfolio marks stale')
          }
          return { symbol, indicators: { price: Number(quote.close) } }
        }))
        await loadStockTraderPaperPortfolio({
          bot,
          screening: { asOfSession: expectedSession, shortlist },
          prismaClient, fillLoader: async () => fills
        })
        observations.portfolioReconciled = true
      } catch { /* no imaginary empty portfolio on failure */ }
    }
  }
  return evaluateFlagshipAiBetaReadiness({
    bot, portfolio, env, observations, expectedSession, now
  })
}
