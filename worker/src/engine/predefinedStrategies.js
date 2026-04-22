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

// Import predefined strategies from frontend constants
const RULE_BASED_TEMPLATES = [
  {
    id: 'momentum_crossover',
    name: 'Momentum Crossover',
    rules: [
      {
        id: 'ma_crossover',
        type: 'price_threshold',
        config: {
          indicator: 'SMA_50',
          operator: 'crosses_above',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'rsi_confirmation',
        type: 'price_threshold',
        config: {
          indicator: 'RSI',
          operator: 'greater_than',
          value: 50,
          action: 'confirm_buy'
        }
      },
      {
        id: 'sell_ma_crossunder',
        type: 'price_threshold',
        config: {
          indicator: 'SMA_50',
          operator: 'crosses_below',
          value: 'current_price',
          action: 'sell_signal'
        }
      },
      {
        id: 'market_hours',
        type: 'market_hours',
        config: {
          start: '09:30',
          end: '16:00',
          timezone: 'ET'
        }
      },
      {
        id: 'daily_loss_limit',
        type: 'daily_loss',
        config: {
          maxDailyLoss: 500,
          action: 'stop_trading'
        }
      }
    ]
  },
  {
    id: 'mean_reversion_bollinger',
    name: 'Mean Reversion (Bollinger Bands)',
    rules: [
      {
        id: 'bb_buy_signal',
        type: 'price_threshold',
        config: {
          indicator: 'BOLLINGER_LOWER',
          operator: 'touches_or_crosses_below',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'bb_sell_signal',
        type: 'price_threshold',
        config: {
          indicator: 'BOLLINGER_UPPER',
          operator: 'touches_or_crosses_above',
          value: 'current_price',
          action: 'sell_signal'
        }
      },
      {
        id: 'rsi_oversold',
        type: 'price_threshold',
        config: {
          indicator: 'RSI',
          operator: 'less_than',
          value: 30,
          action: 'confirm_buy'
        }
      },
      {
        id: 'rsi_overbought',
        type: 'price_threshold',
        config: {
          indicator: 'RSI',
          operator: 'greater_than',
          value: 70,
          action: 'confirm_sell'
        }
      },
      {
        id: 'market_hours',
        type: 'market_hours',
        config: {
          start: '09:30',
          end: '16:00',
          timezone: 'ET'
        }
      }
    ]
  },
  {
    id: 'breakout_momentum',
    name: 'Breakout Momentum',
    rules: [
      {
        id: 'breakout_buy',
        type: 'price_threshold',
        config: {
          indicator: 'RESISTANCE_20D',
          operator: 'crosses_above',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'breakdown_sell',
        type: 'price_threshold',
        config: {
          indicator: 'SUPPORT_20D',
          operator: 'crosses_below',
          value: 'current_price',
          action: 'sell_signal'
        }
      },
      {
        id: 'volume_confirmation',
        type: 'price_threshold',
        config: {
          indicator: 'VOLUME_SMA',
          operator: 'greater_than',
          value: '1.5x',
          action: 'confirm_signal'
        }
      },
      {
        id: 'trend_filter',
        type: 'trend_filter',
        config: {
          timeframe: '1h',
          minTrendStrength: 0.6,
          action: 'validate_signal'
        }
      },
      {
        id: 'market_hours',
        type: 'market_hours',
        config: {
          start: '09:30',
          end: '16:00',
          timezone: 'ET'
        }
      }
    ]
  }
]

const STRATEGY_BASED_TEMPLATES = [
  {
    id: 'pairs_trading_spread',
    name: 'Pairs Trading (Statistical Arbitrage)',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Intraday',
      edge: '+3.2% avg return',
      riskLevel: 'medium'
    },
    config: {
      pair: ['SPY', 'QQQ'],
      lookbackPeriod: 20,
      zScoreThreshold: 2.0,
      exitThreshold: 0.5
    }
  },
  {
    id: 'options_flow_sentiment',
    name: 'Options Flow Analysis',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Real-time',
      edge: '+2.8% avg return',
      riskLevel: 'high'
    },
    config: {
      minFlowSize: 1000000,
      sentimentThreshold: 0.7,
      lookbackMinutes: 30
    }
  },
  {
    id: 'sentiment_momentum',
    name: 'Sentiment Analysis',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Hourly',
      edge: '+1.9% avg return',
      riskLevel: 'medium'
    },
    config: {
      sources: ['news', 'social', 'analyst'],
      sentimentThreshold: 0.6,
      momentumPeriod: 14
    }
  }
]

// Execute predefined rule-based strategy
export async function executeRuleBasedStrategy(bot, tick, context) {
  const template = RULE_BASED_TEMPLATES.find(t => t.id === bot.templateId)
  if (!template) {
    throw new Error(`Unknown rule-based template: ${bot.templateId}`)
  }

  const results = []
  
  // Evaluate each rule in the template
  for (const rule of template.rules) {
    try {
      const result = await evaluateRule(rule, bot, tick, context)
      results.push({
        ruleId: rule.id,
        ruleType: rule.type,
        result,
        action: rule.config.action
      })
    } catch (error) {
      console.error(`Rule evaluation failed for ${rule.id}:`, error)
      results.push({
        ruleId: rule.id,
        ruleType: rule.type,
        result: { blocked: true, error: error.message },
        action: rule.config.action
      })
    }
  }

  // Determine overall signal
  return determineSignal(results)
}

// Execute predefined strategy-based algorithm
// TODO: data-fetching helpers (getHistoricalData, getOptionsFlowData, getSentimentData) are
// stubs returning empty/zero values. Until real implementations are wired up, all strategy-based
// bots will produce 'hold' signals and should not be enabled in production.
export async function executeStrategyBasedAlgorithm(bot, tick, context) {
  throw new Error(
    `Strategy-based algorithms are not yet implemented. ` +
    `Bot ${bot.id} with strategyId "${bot.strategyId}" cannot be executed until the ` +
    `data-fetching helpers in predefinedStrategies.js are implemented.`
  )
}

// Evaluate individual rule
async function evaluateRule(rule, bot, tick, context) {
  const { type, config } = rule
  
  switch (type) {
    case 'market_hours':
      return evaluateMarketHours(config, tick.timestamp)
    
    case 'price_threshold':
      return await evaluatePriceThreshold(config, bot, tick, context)
    
    case 'cooldown':
      return await evaluateCooldown(config, bot, tick)
    
    case 'position_limit':
      return await evaluatePositionLimit(config, bot, context)
    
    case 'daily_loss':
      return await evaluateDailyLoss(config, bot, context)
    
    case 'trend_filter':
      return await evaluateTrendFilter(config, bot, tick)
    
    case 'time_window':
      return await evaluateTimeWindow(config, bot, tick)
    
    default:
      throw new Error(`Unknown rule type: ${type}`)
  }
}

// Determine overall signal from rule results
function determineSignal(results) {
  const buySignals = results.filter(r => r.result.signal === 'buy')
  const sellSignals = results.filter(r => r.result.signal === 'sell')
  const blockedRules = results.filter(r => r.result.blocked)
  
  // If any critical rule is blocked, no signal
  const criticalBlocked = blockedRules.filter(r => 
    r.action === 'stop_trading' || r.action === 'block_all'
  )
  if (criticalBlocked.length > 0) {
    return { signal: 'hold', reason: 'Critical rule blocked', blockedRules: criticalBlocked }
  }
  
  // Count confirmations
  const buyConfirmations = buySignals.filter(r => r.action.includes('confirm')).length
  const sellConfirmations = sellSignals.filter(r => r.action.includes('confirm')).length
  
  // Determine signal with confidence
  if (buySignals.length > 0 && buyConfirmations >= 1) {
    return {
      signal: 'buy',
      confidence: Math.min(0.9, 0.5 + (buyConfirmations * 0.2)),
      rules: buySignals,
      confirmations: buyConfirmations
    }
  }
  
  if (sellSignals.length > 0 && sellConfirmations >= 1) {
    return {
      signal: 'sell',
      confidence: Math.min(0.9, 0.5 + (sellConfirmations * 0.2)),
      rules: sellSignals,
      confirmations: sellConfirmations
    }
  }
  
  return { signal: 'hold', reason: 'Insufficient confirmations', results }
}

// Pairs Trading Strategy
async function executePairsTrading(bot, tick, context, config) {
  const { pair, lookbackPeriod, zScoreThreshold, exitThreshold } = config
  
  // Get historical price data for both assets
  const asset1Data = await getHistoricalData(pair[0], lookbackPeriod)
  const asset2Data = await getHistoricalData(pair[1], lookbackPeriod)
  
  // Calculate spread and z-score
  const spread = calculateSpread(asset1Data, asset2Data)
  const zScore = calculateZScore(spread, lookbackPeriod)
  
  // Generate signal based on z-score
  let signal = 'hold'
  let confidence = 0
  let reason = ''
  
  if (zScore > zScoreThreshold) {
    signal = 'sell' // Short the overperforming asset
    confidence = Math.min(0.9, Math.abs(zScore) / zScoreThreshold)
    reason = `Z-score ${zScore.toFixed(2)} above threshold`
  } else if (zScore < -zScoreThreshold) {
    signal = 'buy' // Buy the underperforming asset
    confidence = Math.min(0.9, Math.abs(zScore) / zScoreThreshold)
    reason = `Z-score ${zScore.toFixed(2)} below threshold`
  } else if (Math.abs(zScore) < exitThreshold) {
    signal = 'hold'
    confidence = 0.9
    reason = `Z-score ${zScore.toFixed(2)} within exit threshold`
  }
  
  return {
    signal,
    confidence,
    reason,
    metadata: {
      zScore,
      spread: spread[spread.length - 1],
      pair,
      strategy: 'pairs_trading'
    }
  }
}

// Options Flow Strategy
async function executeOptionsFlow(bot, tick, context, config) {
  const { minFlowSize, sentimentThreshold, lookbackMinutes } = config
  
  // Get recent options flow data
  const optionsFlow = await getOptionsFlowData(tick.symbol, lookbackMinutes)
  
  // Calculate sentiment score
  const sentimentScore = calculateOptionsSentiment(optionsFlow, minFlowSize)
  
  // Generate signal
  let signal = 'hold'
  let confidence = 0
  let reason = ''
  
  if (sentimentScore > sentimentThreshold) {
    signal = 'buy'
    confidence = Math.min(0.9, sentimentScore)
    reason = `Bullish options flow: ${sentimentScore.toFixed(2)}`
  } else if (sentimentScore < (1 - sentimentThreshold)) {
    signal = 'sell'
    confidence = Math.min(0.9, 1 - sentimentScore)
    reason = `Bearish options flow: ${sentimentScore.toFixed(2)}`
  } else {
    signal = 'hold'
    confidence = 0.8
    reason = `Neutral options flow: ${sentimentScore.toFixed(2)}`
  }
  
  return {
    signal,
    confidence,
    reason,
    metadata: {
      sentimentScore,
      flowSize: optionsFlow.reduce((sum, flow) => sum + flow.size, 0),
      flowCount: optionsFlow.length,
      strategy: 'options_flow'
    }
  }
}

// Sentiment Analysis Strategy
async function executeSentimentAnalysis(bot, tick, context, config) {
  const { sources, sentimentThreshold, momentumPeriod } = config
  
  // Get sentiment data from multiple sources
  const sentimentData = await getSentimentData(tick.symbol, sources)
  
  // Calculate overall sentiment
  const overallSentiment = calculateOverallSentiment(sentimentData)
  
  // Get price momentum
  const momentum = await calculatePriceMomentum(tick.symbol, momentumPeriod)
  
  // Generate combined signal
  let signal = 'hold'
  let confidence = 0
  let reason = ''
  
  const bullishSentiment = overallSentiment > sentimentThreshold
  const bearishSentiment = overallSentiment < (1 - sentimentThreshold)
  const positiveMomentum = momentum > 0
  
  if (bullishSentiment && positiveMomentum) {
    signal = 'buy'
    confidence = Math.min(0.9, (overallSentiment + Math.abs(momentum)) / 2)
    reason = `Bullish sentiment + positive momentum`
  } else if (bearishSentiment && !positiveMomentum) {
    signal = 'sell'
    confidence = Math.min(0.9, ((1 - overallSentiment) + Math.abs(momentum)) / 2)
    reason = `Bearish sentiment + negative momentum`
  } else {
    signal = 'hold'
    confidence = 0.7
    reason = `Conflicting signals or neutral sentiment`
  }
  
  return {
    signal,
    confidence,
    reason,
    metadata: {
      overallSentiment,
      momentum,
      sources: sentimentData.map(s => s.source),
      strategy: 'sentiment_analysis'
    }
  }
}

// Helper functions
async function getHistoricalData(symbol, period) {
  // Implementation would fetch historical price data
  // For now, return mock data
  return []
}

function calculateSpread(asset1Data, asset2Data) {
  // Calculate price spread between two assets
  return []
}

function calculateZScore(spread, period) {
  // Calculate z-score of spread
  return 0
}

async function getOptionsFlowData(symbol, minutes) {
  // Get options flow data for recent period
  return []
}

function calculateOptionsSentiment(flowData, minSize) {
  // Calculate sentiment from options flow
  return 0.5
}

async function getSentimentData(symbol, sources) {
  // Get sentiment data from multiple sources
  return []
}

function calculateOverallSentiment(sentimentData) {
  // Calculate overall sentiment score
  return 0.5
}

async function calculatePriceMomentum(symbol, period) {
  // Calculate price momentum
  return 0
}

export {
  RULE_BASED_TEMPLATES,
  STRATEGY_BASED_TEMPLATES
}
