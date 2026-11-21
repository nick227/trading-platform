// Predefined Strategy Execution Engine
// Integrates with the frontend strategy definitions

import { evaluateMarketHours } from './rules/marketHours.js'
import { evaluatePriceThreshold } from './rules/priceThreshold.js'
import { evaluateCooldown } from './rules/cooldown.js'
import { evaluatePositionLimit } from './rules/positionLimit.js'
import { evaluateDailyLoss } from './rules/dailyLoss.js'
import { evaluateTrendFilter } from './rules/trendFilter.js'
import { evaluateTimeWindow } from './rules/timeWindow.js'
import { priceCache } from '../market/priceCache.js'

// Import predefined strategies matching the starter catalog templates
const RULE_BASED_TEMPLATES = [
  {
    id: 'tmpl_momentum_buy',
    name: 'Momentum Buy',
    rules: [
      {
        id: 'market_hours',
        type: 'market_hours',
        config: { allowPremarket: false, allowAfterHours: false }
      },
      {
        id: 'price_above',
        type: 'price_threshold',
        config: { direction: 'above', operator: 'above', price: 0 }
      },
      {
        id: 'position_limit',
        type: 'position_limit',
        config: { maxShares: 100, maxQuantity: 100 }
      },
      {
        id: 'cooldown',
        type: 'cooldown',
        config: { windowMs: 3600000 }
      }
    ]
  },
  {
    id: 'tmpl_dca_accumulator',
    name: 'DCA Accumulator',
    rules: [
      {
        id: 'market_hours',
        type: 'market_hours',
        config: { allowPremarket: false, allowAfterHours: false }
      },
      {
        id: 'position_limit',
        type: 'position_limit',
        config: { maxShares: 500, maxQuantity: 500 }
      },
      {
        id: 'cooldown',
        type: 'cooldown',
        config: { windowMs: 86400000 }
      }
    ]
  },
  {
    id: 'tmpl_momentum_sell',
    name: 'Momentum Sell',
    rules: [
      {
        id: 'market_hours',
        type: 'market_hours',
        config: { allowPremarket: false, allowAfterHours: false }
      },
      {
        id: 'price_below',
        type: 'price_threshold',
        config: { direction: 'below', operator: 'below', price: 0 }
      },
      {
        id: 'cooldown',
        type: 'cooldown',
        config: { windowMs: 3600000 }
      }
    ]
  },
  {
    id: 'tmpl_loss_guard',
    name: 'Loss Guard',
    rules: [
      {
        id: 'market_hours',
        type: 'market_hours',
        config: { allowPremarket: false, allowAfterHours: false }
      },
      {
        id: 'daily_loss',
        type: 'daily_loss',
        config: { maxLoss: 500 }
      },
      {
        id: 'position_limit',
        type: 'position_limit',
        config: { maxShares: 100, maxQuantity: 100 }
      },
      {
        id: 'cooldown',
        type: 'cooldown',
        config: { windowMs: 1800000 }
      }
    ]
  },
  {
    id: 'tmpl_spy_trend_filter',
    name: 'SPY Trend Filter',
    rules: [
      {
        id: 'time_window',
        type: 'time_window',
        config: { start: '09:35', end: '09:55', timezone: 'America/New_York' }
      },
      {
        id: 'cooldown',
        type: 'cooldown',
        config: { cooldownHours: 24, windowMs: 86400000 }
      },
      {
        id: 'position_limit',
        type: 'position_limit',
        config: { maxPositions: 1, maxQuantity: 100, maxShares: 100 }
      },
      {
        id: 'daily_loss',
        type: 'daily_loss',
        config: { maxLoss: 500, maxDailyLossPct: 3 }
      },
      {
        id: 'trend_filter',
        type: 'trend_filter',
        config: { symbol: 'SPY', confirmationBars: 2, maxSnapshotAgeHours: 90, side: 'buy' }
      }
    ]
  },
  // Legacy aliases
  {
    id: 'momentum_crossover',
    name: 'Momentum Crossover',
    rules: [
      { id: 'market_hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
      { id: 'daily_loss', type: 'daily_loss', config: { maxLoss: 500 } }
    ]
  },
  {
    id: 'mean_reversion_bollinger',
    name: 'Mean Reversion',
    rules: [
      { id: 'market_hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } }
    ]
  },
  {
    id: 'breakout_momentum',
    name: 'Breakout Momentum',
    rules: [
      { id: 'market_hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } }
    ]
  }
]

const STRATEGY_BASED_TEMPLATES = []

// Execute predefined rule-based strategy
export async function executeRuleBasedStrategy(bot, tick, context) {
  // Persisted rules in MariaDB take precedence
  const rules = (bot.rules && bot.rules.length > 0)
    ? bot.rules
    : (RULE_BASED_TEMPLATES.find(t => t.id === bot.templateId)?.rules ?? [])

  if (rules.length === 0) {
    throw new Error(`No rules defined for rule-based bot ${bot.id}`)
  }

  const ticker = tick?.symbol ?? bot.config?.tickers?.[0]
  const side = bot.config?.direction ?? 'buy'

  for (const rule of rules) {
    const result = await evaluateRule(rule, bot, ticker, context?.positions ?? [], { side })
    if (!result.pass) {
      return { signal: 'hold', confidence: 0, reason: `Rule ${rule.name || rule.type} blocked: ${result.reason}` }
    }
  }

  return { signal: side, confidence: 0.8, reason: 'All rules passed' }
}

export async function executeStrategyBasedAlgorithm(bot, tick, context) {
  throw new Error(
    `Strategy-based algorithms are not yet implemented. ` +
    `Bot ${bot.id} with strategyId "${bot.strategyId}" cannot be executed.`
  )
}

async function evaluateRule(rule, bot, ticker, positions, ctx = {}) {
  const side = typeof ctx?.side === 'string' ? ctx.side.toLowerCase() : null
  switch (rule.type) {
    case 'market_hours':
      return evaluateMarketHours(rule.config)
    case 'price_threshold':
      return evaluatePriceThreshold(rule.config, ticker)
    case 'cooldown':
      return evaluateCooldown(rule.config, bot.id, ticker)
    case 'position_limit':
      return evaluatePositionLimit(rule.config, ticker, positions)
    case 'daily_loss':
      return evaluateDailyLoss(rule.config, bot.portfolioId)
    case 'trend_filter':
      return evaluateTrendFilter({ ...rule.config, side })
    case 'time_window':
      return evaluateTimeWindow(rule.config)
    default:
      return { pass: true }
  }
}

export {
  RULE_BASED_TEMPLATES,
  STRATEGY_BASED_TEMPLATES
}
