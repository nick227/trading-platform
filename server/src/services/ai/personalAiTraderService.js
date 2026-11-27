/**
 * Personal AI Trader Service (MR 2).
 *
 * Strictly structured configuration (risk profile + GICS sectors + approval mode)
 * with zero freeform text inputs (eliminating prompt-injection surface), deterministic
 * risk caps, dedicated per-user monthly token budget governance, and explicit
 * user-facing lifecycle states explaining what happens next at every stage.
 */
import prisma from '../../loaders/prisma.js'
import { DEFAULT_TRADABLE_SYMBOLS } from '../simulationService.js'
import { ensureDefaultPaperPortfolio } from '../defaultPaperPortfolioService.js'
import { COMPANY_DIRECTORY } from './stockUniverseCatalog.js'
import {
  AI_STOCK_TRADER_STRATEGY_ID,
  AI_STOCK_TRADER_AGENT_VERSION,
  createAiStockTraderAgentConfig
} from './strategies/aiStockTraderStrategy.js'
import { createPersonalAiUsageGovernor } from './aiUsageGovernor.js'
import { STOCK_TRADER_ACTIVE_ORDER_STATUSES } from './stockTraderAccounting.js'

export const PERSONAL_TRADER_RISK_PROFILES = Object.freeze({
  conservative: Object.freeze({
    id: 'conservative',
    label: 'Conservative',
    description: 'Smaller position sizes (up to 10% per stock, $1,000 max order) and tighter 3% stop-loss protection.',
    objective: 'capital_preservation',
    maxPositionPct: 0.10,
    maxOrderNotional: 1000,
    maxOrdersPerCycle: 1,
    defaultStopLossPct: 3.0
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    description: 'Moderate position sizing (up to 15% per stock, $1,500 max order) and 4% protective stop-loss threshold.',
    objective: 'balanced_growth',
    maxPositionPct: 0.15,
    maxOrderNotional: 1500,
    maxOrdersPerCycle: 2,
    defaultStopLossPct: 4.0
  }),
  growth: Object.freeze({
    id: 'growth',
    label: 'Growth',
    description: 'Full paper flagship sizing (up to 20% per stock, $2,000 max order) and 5% protective stop-loss room.',
    objective: 'growth',
    maxPositionPct: 0.20,
    maxOrderNotional: 2000,
    maxOrdersPerCycle: 2,
    defaultStopLossPct: 5.0
  })
})

export const PERSONAL_TRADER_APPROVAL_MODES = Object.freeze({
  paper_veto_1s: Object.freeze({
    id: 'paper_veto_1s',
    label: 'Copilot · 1-session review window (Recommended)',
    description: 'AI posts simulated trade proposals with an exchange-calendar deadline; un-vetoed paper proposals queue automatically after 1 NYSE session if price drift stays within 3%.'
  }),
  require_approval: Object.freeze({
    id: 'require_approval',
    label: 'Manual approval required',
    description: 'AI posts trade proposals with thesis and risks, and never queues a paper order unless you click Approve before the exchange deadline.'
  }),
  autopilot: Object.freeze({
    id: 'autopilot',
    label: 'Full paper autopilot',
    description: 'AI queues simulated paper orders automatically within your deterministic risk limits after each market close.'
  })
})

export const ALLOWED_GICS_SECTORS = Object.freeze(
  [...new Set(Object.values(COMPANY_DIRECTORY).map(entry => entry.sector))].sort()
)
const SECTOR_SET = new Set(ALLOWED_GICS_SECTORS)
const TRADABLE_SET = new Set(DEFAULT_TRADABLE_SYMBOLS)

export class PersonalTraderConfigError extends Error {
  constructor(message, field = null) {
    super(message)
    this.name = 'PersonalTraderConfigError'
    this.code = 'INVALID_PERSONAL_TRADER_CONFIG'
    this.field = field
  }
}

export function personalAiBotIdForUser(userId) {
  const clean = String(userId ?? '').trim()
  if (!clean) throw new PersonalTraderConfigError('User ID required')
  return `bot_personal_ai_${clean}`.slice(0, 191)
}

/**
 * Validates strictly structured Personal AI Trader preferences.
 * Rejects any unexpected property or freeform text field.
 */
export function validatePersonalTraderInput(rawInput) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new PersonalTraderConfigError('Personal AI Trader configuration must be an object')
  }

  const allowedKeys = new Set(['riskProfile', 'sectors', 'approvalMode', 'enabled'])
  for (const key of Object.keys(rawInput)) {
    if (!allowedKeys.has(key)) {
      throw new PersonalTraderConfigError(`Unsupported or freeform field rejected: ${key}`, key)
    }
  }

  const riskProfileId = String(rawInput.riskProfile ?? '').trim()
  const riskSpec = PERSONAL_TRADER_RISK_PROFILES[riskProfileId]
  if (!riskSpec) {
    throw new PersonalTraderConfigError(
      'riskProfile must be one of: conservative, balanced, growth',
      'riskProfile'
    )
  }

  if (!Array.isArray(rawInput.sectors) || rawInput.sectors.length === 0 || rawInput.sectors.length > ALLOWED_GICS_SECTORS.length) {
    throw new PersonalTraderConfigError(
      'Select at least one GICS sector for your Personal AI Trader',
      'sectors'
    )
  }
  const sectors = []
  const seenSectors = new Set()
  for (const item of rawInput.sectors) {
    if (typeof item !== 'string') {
      throw new PersonalTraderConfigError('Sector selections must be canonical GICS sector strings', 'sectors')
    }
    const trimmed = item.trim()
    if (!SECTOR_SET.has(trimmed)) {
      throw new PersonalTraderConfigError(`Unsupported sector selection: ${trimmed}`, 'sectors')
    }
    if (!seenSectors.has(trimmed)) {
      seenSectors.add(trimmed)
      sectors.push(trimmed)
    }
  }

  const approvalModeId = String(rawInput.approvalMode ?? 'paper_veto_1s').trim()
  if (!PERSONAL_TRADER_APPROVAL_MODES[approvalModeId]) {
    throw new PersonalTraderConfigError(
      'approvalMode must be one of: paper_veto_1s, require_approval, autopilot',
      'approvalMode'
    )
  }

  const enabled = rawInput.enabled === undefined ? true : rawInput.enabled
  if (typeof enabled !== 'boolean') {
    throw new PersonalTraderConfigError('enabled must be a boolean', 'enabled')
  }

  return {
    riskProfile: riskProfileId,
    riskSpec,
    sectors,
    approvalMode: approvalModeId,
    enabled
  }
}

/**
 * Deterministically builds the symbol universe from the user's selected GICS sectors,
 * prioritizing execution-ready tradable symbols in those sectors plus top sector peers
 * (capped at 40 symbols). Always includes SPY only as benchmark reference inside research,
 * while universe symbols are strictly corporate equities from the chosen sectors.
 */
export function buildSectorUniverseSymbols(sectors) {
  const chosen = new Set(sectors)
  const tradableMatches = []
  const extendedMatches = []

  for (const [symbol, meta] of Object.entries(COMPANY_DIRECTORY)) {
    if (!chosen.has(meta.sector)) continue
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) continue
    if (TRADABLE_SET.has(symbol)) {
      tradableMatches.push(symbol)
    } else {
      extendedMatches.push(symbol)
    }
  }

  const combined = [...tradableMatches.sort(), ...extendedMatches.sort()].slice(0, 40)
  // Fallback safety if a sector has only non-watchlist equities: still valid 1-40 ticker array
  return combined.length > 0 ? combined : ['SPY']
}

/**
 * Deterministic lifecycle state resolver — every possible state explains clearly
 * what is happening now and what happens next.
 */
export function resolvePersonalTraderLifecycle({
  bot = null,
  pendingProposalsCount = 0,
  queuedOrdersCount = 0,
  openPositionsCount = 0,
  env = process.env
} = {}) {
  const spendingEnabled =
    env.ENABLE_USER_AI_TRADERS === 'true' &&
    env.ENABLE_AI_PAID_CALLS === 'true' &&
    Number(env.AI_USER_TRADER_MONTHLY_BUDGET_CENTS) > 0 &&
    Number(env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS) > 0

  if (!bot || bot.deletedAt) {
    return {
      state: 'not_configured',
      badge: 'Not configured',
      headline: 'Your Personal AI Trader is not set up yet.',
      whatHappensNext: 'Complete the 3-step structured setup (risk comfort, sectors, and approval style) to run autonomous paper research on your $10,000 simulated portfolio.',
      spendingGateActive: !spendingEnabled
    }
  }

  if (!bot.enabled) {
    return {
      state: 'paused_by_user',
      badge: 'Paused',
      headline: 'Your Personal AI Trader is paused.',
      whatHappensNext: 'No daily AI research or simulated orders will run until you resume it.',
      spendingGateActive: !spendingEnabled
    }
  }

  if (pendingProposalsCount > 0) {
    return {
      state: 'proposal_pending_review',
      badge: `${pendingProposalsCount} proposal${pendingProposalsCount === 1 ? '' : 's'} to review`,
      headline: `You have ${pendingProposalsCount} simulated AI trade proposal${pendingProposalsCount === 1 ? '' : 's'} awaiting review.`,
      whatHappensNext: 'Review the plain-English thesis, risk checks, and NYSE exchange deadline on your Portfolio page to approve or cancel.',
      spendingGateActive: !spendingEnabled
    }
  }

  if (queuedOrdersCount > 0) {
    return {
      state: 'order_queued_next_open',
      badge: `${queuedOrdersCount} paper order${queuedOrdersCount === 1 ? '' : 's'} queued`,
      headline: `${queuedOrdersCount} simulated paper order${queuedOrdersCount === 1 ? ' is' : 's are'} queued for execution.`,
      whatHappensNext: 'Queued orders fill at the next eligible NYSE session close within your deterministic position and notional limits.',
      spendingGateActive: !spendingEnabled
    }
  }

  if (!spendingEnabled) {
    return {
      state: 'paused_spending_gate',
      badge: 'Saved · Awaiting AI budget activation',
      headline: 'Your Personal AI Trader preferences and $10,000 simulated portfolio are ready.',
      whatHappensNext: 'Scheduled daily LLM calls remain paused until operator AI spending gates (ENABLE_USER_AI_TRADERS and per-user monthly budget) are enabled.',
      spendingGateActive: true
    }
  }

  if (openPositionsCount > 0) {
    return {
      state: 'managing_active_positions',
      badge: 'Active · Managing holdings',
      headline: `Actively monitoring ${openPositionsCount} simulated holding${openPositionsCount === 1 ? '' : 's'} and your selected sectors.`,
      whatHappensNext: 'After each NYSE market close (4:45 PM ET), your Personal AI Trader re-evaluates open theses, protective exits, and new candidates.',
      spendingGateActive: false
    }
  }

  return {
    state: 'awaiting_next_close_research',
    badge: 'Active · Awaiting market close',
    headline: 'Your Personal AI Trader is active and ready for the next market close.',
    whatHappensNext: 'After the next NYSE session close (4:45 PM ET), it screens your chosen sectors and reviews verified SEC filings and news.',
    spendingGateActive: false
  }
}

async function ensureAiStockTraderTemplate(prismaClient) {
  await prismaClient.botTemplate.upsert({
    where: { id: AI_STOCK_TRADER_STRATEGY_ID },
    update: {},
    create: {
      id: AI_STOCK_TRADER_STRATEGY_ID,
      name: 'AI Stock Trader',
      description: 'AI-powered stock discovery and autonomous simulated portfolio decisions.',
      botType: 'strategy_based',
      config: createAiStockTraderAgentConfig(),
      rules: [],
      tags: ['ai', 'stock-trader', 'paper']
    }
  })
}

export async function getPersonalAiTraderState(
  userId,
  { prismaClient = prisma, env = process.env, now = () => new Date() } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new PersonalTraderConfigError('User authentication required')

  const paperPortfolio = await ensureDefaultPaperPortfolio(uid, { prismaClient })
  const botId = personalAiBotIdForUser(uid)
  const bot = await prismaClient.bot.findUnique({ where: { id: botId } })

  let queuedOrdersCount = 0
  let openPositionsCount = 0
  let pendingProposalsCount = 0

  if (bot && !bot.deletedAt) {
    const [activeOrders, fills] = await Promise.all([
      prismaClient.execution.count({
        where: { botId: bot.id, status: { in: [...STOCK_TRADER_ACTIVE_ORDER_STATUSES] } }
      }),
      prismaClient.execution.findMany({
        where: { botId: bot.id, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } },
        select: { ticker: true, direction: true, filledQuantity: true }
      })
    ])
    queuedOrdersCount = activeOrders
    const netBySymbol = new Map()
    for (const f of fills) {
      const sym = String(f.ticker).toUpperCase()
      const signed = String(f.direction).toLowerCase() === 'sell' ? -Number(f.filledQuantity) : Number(f.filledQuantity)
      netBySymbol.set(sym, (netBySymbol.get(sym) || 0) + signed)
    }
    openPositionsCount = [...netBySymbol.values()].filter(q => q > 1e-6).length

    if (typeof prismaClient.copilotProposal?.count === 'function') {
      pendingProposalsCount = await prismaClient.copilotProposal.count({
        where: {
          userId: uid,
          botId: bot.id,
          status: { in: ['pending_approval', 'pending_veto'] }
        }
      }).catch(() => 0)
    }
  }

  const period = now().toISOString().slice(0, 7)
  const userBucket = await prismaClient.aiUsageBucket.findUnique({
    where: { id: `user_trader:${uid}:${period}` }
  }).catch(() => null)
  const configuredUserCapCents = Number(env.AI_USER_TRADER_MONTHLY_BUDGET_CENTS) || 0

  const lifecycle = resolvePersonalTraderLifecycle({
    bot,
    pendingProposalsCount,
    queuedOrdersCount,
    openPositionsCount,
    env
  })

  const mandate = bot?.config?.personalMandate || null

  return {
    configured: Boolean(bot && !bot.deletedAt && mandate),
    portfolio: {
      id: paperPortfolio.id,
      name: paperPortfolio.name,
      accountKind: paperPortfolio.accountKind,
      startingCash: Number(paperPortfolio.cashBalance) || 10_000,
      simulated: true
    },
    bot: bot && !bot.deletedAt ? {
      id: bot.id,
      name: bot.name,
      enabled: bot.enabled,
      portfolioId: bot.portfolioId,
      strategyVersion: bot.config?.strategyVersion || AI_STOCK_TRADER_AGENT_VERSION,
      personalMandate: mandate,
      execution: bot.config?.execution || null,
      universeSymbolsCount: bot.config?.universe?.symbols?.length || 0,
      universeSymbols: bot.config?.universe?.symbols || []
    } : null,
    lifecycle,
    budgetStatus: {
      period,
      monthlyCapCents: configuredUserCapCents,
      spentCents: userBucket?.spentCents ?? 0,
      reservedCents: userBucket?.reservedCents ?? 0,
      spendingEnabled: !lifecycle.spendingGateActive
    },
    options: {
      riskProfiles: Object.values(PERSONAL_TRADER_RISK_PROFILES),
      sectors: ALLOWED_GICS_SECTORS,
      approvalModes: Object.values(PERSONAL_TRADER_APPROVAL_MODES)
    }
  }
}

export async function configurePersonalAiTrader(
  userId,
  rawInput,
  { prismaClient = prisma, env = process.env, now = () => new Date() } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new PersonalTraderConfigError('User authentication required')

  const validated = validatePersonalTraderInput(rawInput)
  const paperPortfolio = await ensureDefaultPaperPortfolio(uid, { prismaClient })
  await ensureAiStockTraderTemplate(prismaClient)

  const symbols = buildSectorUniverseSymbols(validated.sectors)
  const baseAgentConfig = createAiStockTraderAgentConfig({
    objective: validated.riskSpec.objective,
    universe: {
      type: 'curated',
      symbols,
      dynamicDiscovery: { enabled: true, maxPromotions: 5 }
    },
    research: { cadence: 'daily' }
  })

  const config = {
    ...baseAgentConfig,
    allocatedAmount: Number(paperPortfolio.cashBalance) || 10_000,
    execution: {
      maxPositionPct: validated.riskSpec.maxPositionPct,
      maxOrderNotional: validated.riskSpec.maxOrderNotional,
      maxOrdersPerCycle: validated.riskSpec.maxOrdersPerCycle
    },
    personalMandate: {
      version: '1.0.0',
      ownerScope: 'personal_paper',
      riskProfile: validated.riskProfile,
      sectors: validated.sectors,
      approvalMode: validated.approvalMode,
      defaultStopLossPct: validated.riskSpec.defaultStopLossPct,
      updatedAt: now().toISOString()
    }
  }

  const botId = personalAiBotIdForUser(uid)
  await prismaClient.bot.upsert({
    where: { id: botId },
    update: {
      name: `Personal AI Trader (${validated.riskSpec.label})`,
      enabled: validated.enabled,
      portfolioId: paperPortfolio.id,
      deletedAt: null,
      config
    },
    create: {
      id: botId,
      userId: uid,
      portfolioId: paperPortfolio.id,
      templateId: AI_STOCK_TRADER_STRATEGY_ID,
      botType: 'strategy_based',
      name: `Personal AI Trader (${validated.riskSpec.label})`,
      enabled: validated.enabled,
      config
    }
  })

  return getPersonalAiTraderState(uid, { prismaClient, env, now })
}

export function buildPersonalUsageGovernorForUser(userId, options = {}) {
  return createPersonalAiUsageGovernor({ userId, ...options })
}
