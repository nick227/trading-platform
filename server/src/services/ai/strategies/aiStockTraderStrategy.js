/**
 * Flagship AI Stock Trader — immutable strategy identity and beta defaults.
 *
 * Registration is data-only: adding this strategy does not schedule a job,
 * call a model, or grant trading authority.
 */
import { DEFAULT_TRADABLE_SYMBOLS } from '../../simulationService.js'

export const AI_STOCK_TRADER_STRATEGY_ID = 'tmpl_ai_stock_trader'
export const AI_STOCK_TRADER_VERSION = '1.0.0'
export const AI_STOCK_TRADER_AGENT_VERSION = '2.0.0'
export const AI_STOCK_TRADER_PLATFORM_BOT_ID = 'bot_platform_ai_stock_trader_v1'
export const AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID = 'port_platform_ai_stock_trader_v1'
export const AI_STOCK_TRADER_PLATFORM_USER_ID = 'usr_platform_canonical'

export const AI_STOCK_TRADER_DEFAULTS = Object.freeze({
  strategyId: AI_STOCK_TRADER_STRATEGY_ID,
  strategyVersion: AI_STOCK_TRADER_VERSION,
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'paper',
  objective: 'balanced_growth',
  universe: {
    type: 'curated',
    symbols: [...DEFAULT_TRADABLE_SYMBOLS],
    dynamicDiscovery: Object.freeze({
      enabled: false,
      maxPromotions: 5
    })
  },
  research: {
    cadence: 'daily',
    contextModules: ['market', 'portfolio', 'objectives', 'risk'],
    maxCallsPerCycle: 1
  },
  execution: {
    maxPositionPct: 0.20,
    maxOrderNotional: 2000,
    maxOrdersPerCycle: 2
  },
  allocatedAmount: 10000
})

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/

function normalizeDynamicDiscovery(raw) {
  if (raw === undefined) {
    return {
      enabled: AI_STOCK_TRADER_DEFAULTS.universe.dynamicDiscovery.enabled,
      maxPromotions: AI_STOCK_TRADER_DEFAULTS.universe.dynamicDiscovery.maxPromotions
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid dynamicDiscovery configuration')
  }
  for (const k of Object.keys(raw)) {
    if (!['enabled', 'maxPromotions'].includes(k)) {
      throw new Error(`Unsupported dynamicDiscovery override: ${k}`)
    }
  }
  const enabled = raw.enabled ?? false
  if (typeof enabled !== 'boolean') {
    throw new Error('dynamicDiscovery.enabled must be a boolean')
  }
  const maxPromotions = raw.maxPromotions ?? AI_STOCK_TRADER_DEFAULTS.universe.dynamicDiscovery.maxPromotions
  if (!Number.isInteger(maxPromotions) || maxPromotions < 1 || maxPromotions > 15) {
    throw new Error('dynamicDiscovery.maxPromotions must be an integer between 1 and 15')
  }
  return { enabled, maxPromotions }
}

/**
 * Reject unsupported configuration instead of silently weakening safety limits.
 */
export function createAiStockTraderConfig(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('AI stock trader overrides must be an object')
  }
  const allowed = new Set(['objective', 'universe', 'research'])
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key)) throw new Error(`Unsupported AI stock trader override: ${key}`)
  }

  const sourceUniverse = overrides.universe ?? AI_STOCK_TRADER_DEFAULTS.universe
  if (!sourceUniverse || typeof sourceUniverse !== 'object' || Array.isArray(sourceUniverse)) {
    throw new Error('AI stock trader universe must be curated or watchlist')
  }
  for (const k of Object.keys(sourceUniverse)) {
    if (!['type', 'symbols', 'dynamicDiscovery'].includes(k)) {
      throw new Error(`Unsupported AI stock trader universe override: ${k}`)
    }
  }
  if (!['curated', 'watchlist'].includes(sourceUniverse.type)) {
    throw new Error('AI stock trader universe must be curated or watchlist')
  }
  if (!Array.isArray(sourceUniverse.symbols) || !sourceUniverse.symbols.length || sourceUniverse.symbols.length > 100) {
    throw new Error('AI stock trader universe must contain 1–100 symbols')
  }
  const symbols = [...new Set(sourceUniverse.symbols.map(s => String(s).trim().toUpperCase()))]
  if (symbols.some(s => !TICKER.test(s))) throw new Error('Invalid ticker symbol in AI stock trader universe')
  const dynamicDiscovery = normalizeDynamicDiscovery(sourceUniverse.dynamicDiscovery)

  const research = overrides.research ?? {}
  if (Object.keys(research).some(k => !['cadence'].includes(k))) {
    throw new Error('Unsupported AI stock trader research override')
  }
  const cadence = research.cadence ?? AI_STOCK_TRADER_DEFAULTS.research.cadence
  if (!['daily', 'weekly'].includes(cadence)) throw new Error('Unsupported research cadence')

  const objective = overrides.objective ?? AI_STOCK_TRADER_DEFAULTS.objective
  if (!['balanced_growth', 'capital_preservation', 'growth'].includes(objective)) {
    throw new Error('Unsupported investment objective')
  }

  return {
    ...AI_STOCK_TRADER_DEFAULTS,
    objective,
    universe: { type: sourceUniverse.type, symbols, dynamicDiscovery },
    research: {
      ...AI_STOCK_TRADER_DEFAULTS.research,
      contextModules: [...AI_STOCK_TRADER_DEFAULTS.research.contextModules],
      cadence
    },
    execution: { ...AI_STOCK_TRADER_DEFAULTS.execution }
  }
}

/** Opt-in autonomous two-pass research configuration; legacy v1 stays replayable. */
export function createAiStockTraderAgentConfig(overrides = {}) {
  const original = createAiStockTraderConfig(overrides)
  return {
    ...original,
    strategyVersion: AI_STOCK_TRADER_AGENT_VERSION,
    research: { ...original.research, maxCallsPerCycle: 2 }
  }
}
