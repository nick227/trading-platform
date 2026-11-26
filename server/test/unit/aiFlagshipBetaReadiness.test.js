import { describe, expect, it, vi } from 'vitest'
import {
  evaluateFlagshipAiBetaReadiness, readFlagshipAiBetaReadiness
} from '../../src/services/ai/flagshipBetaReadiness.js'
import {
  upgradeDisabledPlatformStockTraderToAgent
} from '../../src/services/ai/aiStockTraderBotService.js'
import {
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  AI_STOCK_TRADER_PLATFORM_USER_ID,
  AI_STOCK_TRADER_STRATEGY_ID,
  createAiStockTraderAgentConfig,
  createAiStockTraderConfig
} from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const now = new Date('2026-11-26T12:00:00.000Z')
const session = '2026-11-25'
const env = {
  ENABLE_FLAGSHIP_STOCK_TRADER: 'true',
  ENABLE_AI_PAID_CALLS: 'true',
  ENABLE_AI_SCHEDULER: 'true',
  AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS: '500',
  AI_STOCK_TRADER_BOT_BUDGET_CENTS: '250',
  AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL: '5',
  OPENAI_API_KEY: 'fixture_key_never_used',
  AI_STOCK_TRADER_DB_INTEGRATION_ATTESTED: 'true'
}
const bot = () => ({
  id: AI_STOCK_TRADER_PLATFORM_BOT_ID,
  userId: AI_STOCK_TRADER_PLATFORM_USER_ID,
  portfolioId: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  templateId: AI_STOCK_TRADER_STRATEGY_ID,
  enabled: false, config: createAiStockTraderAgentConfig()
})
const portfolio = () => ({
  id: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  userId: AI_STOCK_TRADER_PLATFORM_USER_ID
})
const observations = () => ({
  usageTablesAvailable: true,
  marketSession: session,
  portfolioReconciled: true,
  unresolvedExecutionCount: 0,
  emergencyStopped: false,
  providerSmokeVerifiedAt: '2026-11-26T00:00:00.000Z',
  dbIntegrationAttested: true
})

describe('MR 18 flagship beta preflight and controls', () => {
  it('allows operator enablement only after every independent preflight gate passes', () => {
    const result = evaluateFlagshipAiBetaReadiness({
      bot: bot(), portfolio: portfolio(), env, observations: observations(),
      expectedSession: session, now
    })
    expect(result.readyToEnable).toBe(true)
    expect(result.status).toBe('ready_for_operator_enable')
    expect(result.botEnabled).toBe(false)
    expect(result.blockers).toEqual([])
  })

  it('fails closed for unresolved orders, no smoke, invalid budget and disabled flags', () => {
    const changed = { ...observations(), unresolvedExecutionCount: 1, providerSmokeVerifiedAt: null }
    const result = evaluateFlagshipAiBetaReadiness({
      bot: bot(), portfolio: portfolio(),
      env: { ...env, ENABLE_AI_PAID_CALLS: 'false', AI_STOCK_TRADER_BOT_BUDGET_CENTS: '1' },
      observations: changed, expectedSession: session, now
    })
    expect(result.readyToEnable).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      'explicit_flags', 'budget_for_two_calls',
      'no_unresolved_executions', 'recent_explicit_provider_smoke'
    ]))
  })

  it('blocks a legacy v1 bot until explicit migration and protects paper-only identity', () => {
    const legacy = { ...bot(), config: createAiStockTraderConfig() }
    const result = evaluateFlagshipAiBetaReadiness({
      bot: legacy, portfolio: portfolio(), env,
      observations: observations(), expectedSession: session, now
    })
    expect(result.blockers).toContain('pinned_generalist_v2')
    legacy.config.mode = 'live'
    expect(evaluateFlagshipAiBetaReadiness({
      bot: legacy, portfolio: portfolio(), env,
      observations: observations(), expectedSession: session, now
    }).blockers).toContain('platform_owned_paper_bot')
  })

  it('reads actual observations without initializing a bot, placing orders or calling an LLM', async () => {
    const b = bot()
    const db = {
      bot: { findUnique: vi.fn(async () => b), upsert: vi.fn() },
      portfolio: { findUnique: vi.fn(async () => portfolio()) },
      aiUsageBucket: { count: vi.fn(async () => 0) },
      aiUsageCall: { count: vi.fn(async () => 0) },
      execution: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [])
      },
      user: { findUnique: vi.fn(async () => ({ riskSettings: null })) },
      botEvent: { findMany: vi.fn(async () => [{
        id: 'smoke', metadata: {
          status: 'provider_smoke_verified',
          verifiedAt: observations().providerSmokeVerifiedAt
        }
      }]) }
    }
    const engine = { getDailyBars: vi.fn(async () => ({ bars: [[session,1,1,1,1,100]] })) }
    const result = await readFlagshipAiBetaReadiness({
      prismaClient: db, engine, env, now
    })
    expect(result.readyToEnable).toBe(true)
    expect(db.bot.upsert).not.toHaveBeenCalled()
    expect(db.execution.findMany).toHaveBeenCalled()
  })

  it('explicitly migrates only a disabled paper bot with no executions, preserving its objectives', async () => {
    const legacy = { ...bot(), config: createAiStockTraderConfig({
      universe: { type: 'watchlist', symbols: ['AAPL'] },
      objective: 'capital_preservation'
    }) }
    const db = {
      bot: {
        findUnique: vi.fn(async () => legacy),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      execution: { count: vi.fn(async () => 0) }
    }
    const result = await upgradeDisabledPlatformStockTraderToAgent({ prismaClient: db })
    expect(result).toMatchObject({ upgraded: true, version: '2.0.0' })
    const config = db.bot.updateMany.mock.calls[0][0].data.config
    expect(config.strategyVersion).toBe('2.0.0')
    expect(config.objective).toBe('capital_preservation')
    expect(config.universe.symbols).toEqual(['AAPL'])
    expect(config.research.maxCallsPerCycle).toBe(2)
  })

  it('refuses automatic migration of active or previously executed bots', async () => {
    const active = { ...bot(), enabled: true, config: createAiStockTraderConfig() }
    const db = {
      bot: {
        findUnique: vi.fn(async () => active),
        updateMany: vi.fn()
      },
      execution: { count: vi.fn(async () => 1) }
    }
    await expect(upgradeDisabledPlatformStockTraderToAgent({
      prismaClient: db
    })).rejects.toThrow(/disabled/)
    active.enabled = false
    await expect(upgradeDisabledPlatformStockTraderToAgent({
      prismaClient: db
    })).rejects.toThrow(/Existing paper orders or fills/)
    expect(db.bot.updateMany).not.toHaveBeenCalled()
  })

  it('preflight never treats unavailable schema or stale market evidence as success', async () => {
    const db = {
      bot: { findUnique: vi.fn(async () => bot()) },
      portfolio: { findUnique: vi.fn(async () => portfolio()) },
      execution: { count: vi.fn(async () => 0) },
      user: { findUnique: vi.fn(async () => ({ riskSettings: null })) },
      botEvent: { findMany: vi.fn(async () => []) }
    }
    const engine = { getDailyBars: vi.fn(async () => ({ bars: [] })) }
    const result = await readFlagshipAiBetaReadiness({
      prismaClient: db, engine, env, now
    })
    expect(result.readyToEnable).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      'usage_schema', 'fresh_market_data', 'paper_portfolio_reconciled'
    ]))
  })
})
