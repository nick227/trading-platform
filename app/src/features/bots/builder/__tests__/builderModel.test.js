import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initCreateDraft,
  initEditDraft,
  validateBuilderDraft,
  buildBotFromDraft,
  saveBotAlgorithm,
} from '../builderModel'

describe('builderModel', () => {
  const sampleTemplate = {
    id: 'tmpl_golden_cross',
    name: 'Golden Cross Hunter',
    description: 'Buys on 50/200 day moving average cross',
    botType: 'rule_based',
    config: {
      direction: 'buy',
      tickers: ['SPY', 'QQQ'],
      allocatedAmount: 5000,
      maxOrderNotional: 1000,
    },
    rules: [
      { id: 'r_mkt', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
      { id: 'r_cd', type: 'cooldown', config: { windowMs: 86400000 } },
      { id: 'r_tf', type: 'trend_filter', config: { symbol: 'SPY' } },
    ],
  }

  const sampleResearchTemplate = {
    id: 'tmpl_alpha_research',
    name: 'Alpha Research Follower',
    botType: 'rule_based',
    config: {
      signalSource: 'alpha_research',
      direction: 'buy',
      tickers: ['SPY'],
      research: {
        minConfidence: 0.65,
        maxPredictionAgeHours: 72,
        maxEntryDriftPct: 4,
        requireEdgeOverBaseline: true,
        tenantId: 'default',
      },
    },
    rules: [{ id: 'r_mkt', type: 'market_hours', config: {} }],
  }

  describe('initCreateDraft', () => {
    it('initializes draft from a rule-based template', () => {
      const draft = initCreateDraft(sampleTemplate, { buyingPower: 10000 })
      expect(draft.isEdit).toBe(false)
      expect(draft.templateId).toBe('tmpl_golden_cross')
      expect(draft.name).toBe('Golden Cross Hunter · SPY')
      expect(draft.symbolsText).toBe('SPY, QQQ')
      expect(draft.capital).toBe('5000')
      expect(draft.maxPerOrder).toBe('1000')
      expect(draft.triggerType).toBe('trend_filter')
      expect(draft.marketHours.on).toBe(true)
      expect(draft.cooldown.on).toBe(true)
      expect(draft.cooldown.hours).toBe('24')
      expect(draft.fixed).toHaveLength(1)
      expect(draft.fixed[0].type).toBe('trend_filter')
    })

    it('respects pinned ticker when provided', () => {
      const draft = initCreateDraft(sampleTemplate, { buyingPower: 10000 }, 'AAPL')
      expect(draft.symbolsText).toBe('AAPL')
      expect(draft.name).toBe('Golden Cross Hunter · AAPL')
    })

    it('initializes draft from research template', () => {
      const draft = initCreateDraft(sampleResearchTemplate, { buyingPower: 10000 })
      expect(draft.triggerType).toBe('alpha_research')
      expect(draft.research).toEqual({
        minScore: '65',
        maxAgeHours: '72',
        maxDriftPct: '4',
        requireEdge: true,
        base: sampleResearchTemplate.config.research,
      })
    })
  })

  describe('initEditDraft', () => {
    it('initializes draft from an existing bot', () => {
      const existingBot = {
        id: 'bot_123',
        name: 'My Custom Bot',
        direction: 'buy',
        allocation: 3000,
        maxPerOrder: 600,
        tickers: ['MSFT'],
        rules: [
          { id: 'r1', type: 'price_threshold', config: { operator: 'above', price: 420 } },
          { id: 'r2', type: 'position_limit', config: { maxShares: 50 } },
          { id: 'r3', type: 'daily_loss', config: { maxLoss: 300 } },
        ],
        config: {
          allocatedAmount: 3000,
          maxOrderNotional: 600,
          tickers: ['MSFT'],
        },
      }

      const draft = initEditDraft(existingBot)
      expect(draft.isEdit).toBe(true)
      expect(draft.botId).toBe('bot_123')
      expect(draft.name).toBe('My Custom Bot')
      expect(draft.symbolsText).toBe('MSFT')
      expect(draft.capital).toBe('3000')
      expect(draft.maxPerOrder).toBe('600')
      expect(draft.triggerType).toBe('price_threshold')
      expect(draft.trigger).toEqual({ operator: 'above', price: '420' })
      expect(draft.positionLimit.on).toBe(true)
      expect(draft.positionLimit.maxShares).toBe('50')
      expect(draft.dailyLoss.on).toBe(true)
      expect(draft.dailyLoss.maxLoss).toBe('300')
    })
  })

  describe('validateBuilderDraft', () => {
    it('validates required fields and numerical bounds', () => {
      const draft = {
        name: '',
        symbolsText: '',
        capital: '-10',
        maxPerOrder: '0',
        triggerType: 'price_threshold',
        trigger: { price: '0' },
        marketHours: { on: false },
        cooldown: { on: true, hours: '0' },
        positionLimit: { on: true, maxShares: '2.5' },
        dailyLoss: { on: true, maxLoss: '-50' },
      }

      const errors = validateBuilderDraft(draft, { buyingPower: 1000 })
      expect(errors.name).toBe('Give your bot a name.')
      expect(errors.symbols).toBe('Add at least one symbol.')
      expect(errors.capital).toMatch(/greater than \$0/)
      expect(errors.maxPerOrder).toMatch(/Must be greater than \$0/)
      expect(errors.triggerPrice).toBe('Enter the price that should trigger an order.')
      expect(errors.cooldown).toBe('Enter more than 0 hours.')
      expect(errors.positionLimit).toBe('Enter a whole number of shares.')
      expect(errors.dailyLoss).toBe('Enter an amount greater than $0.')
    })

    it('rejects capital exceeding buying power', () => {
      const draft = {
        name: 'Valid Name',
        symbolsText: 'SPY',
        capital: '5000',
        maxPerOrder: '1000',
        triggerType: 'schedule',
        marketHours: { on: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
      }

      const errors = validateBuilderDraft(draft, { buyingPower: 2000 })
      expect(errors.capital).toMatch(/more than the cash available/)
    })

    it('rejects maxPerOrder exceeding capital', () => {
      const draft = {
        name: 'Valid Name',
        symbolsText: 'SPY',
        capital: '1000',
        maxPerOrder: '2500',
        triggerType: 'schedule',
        marketHours: { on: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
      }

      const errors = validateBuilderDraft(draft, { buyingPower: 5000 })
      expect(errors.maxPerOrder).toMatch(/more than the bot’s simulated capital/)
    })
  })

  describe('buildBotFromDraft & saveBotAlgorithm', () => {
    it('preserves existing rule IDs and config on build', () => {
      const existingBot = {
        id: 'bot_1',
        config: { riskOnExposure: 1, allocatedAmount: 2000 },
        rules: [
          { id: 'rule_1', type: 'price_threshold', config: { operator: 'above', price: 400 } },
          { id: 'rule_fixed', type: 'trend_filter', config: { symbol: 'SPY' } },
        ],
      }

      const draft = {
        name: 'Updated Name',
        symbolsText: 'SPY, QQQ',
        direction: 'buy',
        capital: '4000',
        maxPerOrder: '1000',
        triggerType: 'price_threshold',
        trigger: { operator: 'below', price: '380' },
        marketHours: { on: true, extended: true },
        cooldown: { on: true, hours: '12' },
        positionLimit: { on: false },
        dailyLoss: { on: false },
        fixed: [{ id: 'rule_fixed', type: 'trend_filter', config: { symbol: 'SPY' } }],
      }

      const built = buildBotFromDraft(draft, existingBot)
      expect(built.name).toBe('Updated Name')
      expect(built.tickers).toEqual(['SPY', 'QQQ'])
      expect(built.config.allocatedAmount).toBe(4000)
      expect(built.config.maxOrderNotional).toBe(1000)

      // Rule 1 should preserve id
      const threshold = built.rules.find((r) => r.type === 'price_threshold')
      expect(threshold.id).toBe('rule_1')
      expect(threshold.config.operator).toBe('below')
      expect(threshold.config.price).toBe(380)

      // Fixed trend filter should be preserved
      const trend = built.rules.find((r) => r.type === 'trend_filter')
      expect(trend.id).toBe('rule_fixed')
    })

    it('diffs rules properly on saveBotAlgorithm', async () => {
      const api = {
        put: vi.fn().mockResolvedValue({}),
        post: vi.fn().mockResolvedValue({}),
        del: vi.fn().mockResolvedValue({}),
      }

      const bot = {
        id: 'bot_1',
        config: {},
        rules: [
          { id: 'r1', type: 'price_threshold', config: { operator: 'above', price: 100 } },
          { id: 'r2', type: 'cooldown', config: { windowMs: 3600000 } },
          { id: 'r_fixed', type: 'trend_filter', config: { symbol: 'SPY' } },
        ],
      }

      // Built bot has changed r1 price, removed r2, added daily_loss, and kept r_fixed
      const builtBot = {
        name: 'New Name',
        config: { tickers: ['SPY'], allocatedAmount: 1000 },
        rules: [
          { id: 'r1', name: 'Price Above', type: 'price_threshold', config: { operator: 'above', price: 120 } },
          { name: 'Daily Loss', type: 'daily_loss', config: { maxLoss: 500 } },
          { id: 'r_fixed', type: 'trend_filter', config: { symbol: 'SPY' } },
        ],
      }

      const res = await saveBotAlgorithm({ bot, builtBot, api })
      expect(res.ok).toBe(true)

      // PUT /bots/bot_1 with name & config
      expect(api.put).toHaveBeenCalledWith('/bots/bot_1', {
        name: 'New Name',
        config: builtBot.config,
      })

      // PUT /bots/bot_1/rules/r1 with new config
      expect(api.put).toHaveBeenCalledWith('/bots/bot_1/rules/r1', {
        config: { operator: 'above', price: 120 },
      })

      // DELETE /bots/bot_1/rules/r2
      expect(api.del).toHaveBeenCalledWith('/bots/bot_1/rules/r2')

      // POST /bots/bot_1/rules for new daily_loss
      expect(api.post).toHaveBeenCalledWith('/bots/bot_1/rules', {
        name: 'Daily Loss',
        type: 'daily_loss',
        config: { maxLoss: 500 },
      })
    })

    it('preserves all engine-supported configuration wholesale on build (Requirement 1 & 2)', () => {
      const complexBot = {
        id: 'bot_complex',
        name: 'Alpha Quant Bot',
        config: {
          tickers: ['SPY', 'QQQ'],
          direction: 'buy',
          allocatedAmount: 10000,
          maxOrderNotional: 2000,
          capitalMode: 'allocated',
          quantity: 25,
          riskLimits: { maxDrawdownPct: 10, maxLeverage: 1 },
          positionSizing: { method: 'fixed_fractional', fraction: 0.05 },
          timezone: 'America/New_York',
          requiredRegime: 'risk_on',
          riskOnExposure: 0.85,
          maxSnapshotAgeHours: 48,
          preferences: { notifyOnOrder: true, executionSpeed: 'normal' },
          arbitraryEngineProperty: { foo: 'bar', nested: [1, 2, 3] },
        },
        rules: [
          { id: 'r_pt', type: 'price_threshold', config: { operator: 'above', price: 500 } },
        ],
      }

      const draft = initEditDraft(complexBot)
      // User only edits capital and order size
      draft.capital = '15000'
      draft.maxPerOrder = '3000'

      const built = buildBotFromDraft(draft, complexBot)

      // Verified: edited fields reflect new values
      expect(built.config.allocatedAmount).toBe(15000)
      expect(built.config.maxOrderNotional).toBe(3000)

      // Verified: every single hidden engine property is preserved verbatim
      expect(built.config.quantity).toBe(25)
      expect(built.config.riskLimits).toEqual({ maxDrawdownPct: 10, maxLeverage: 1 })
      expect(built.config.positionSizing).toEqual({ method: 'fixed_fractional', fraction: 0.05 })
      expect(built.config.timezone).toBe('America/New_York')
      expect(built.config.requiredRegime).toBe('risk_on')
      expect(built.config.riskOnExposure).toBe(0.85)
      expect(built.config.maxSnapshotAgeHours).toBe(48)
      expect(built.config.preferences).toEqual({ notifyOnOrder: true, executionSpeed: 'normal' })
      expect(built.config.arbitraryEngineProperty).toEqual({ foo: 'bar', nested: [1, 2, 3] })
    })

    it('supports all seven BotRule types and preserves IDs and untouched config (Requirement 3)', () => {
      const allRulesBot = {
        id: 'bot_all_rules',
        config: { tickers: ['SPY'] },
        rules: [
          { id: 'r1', type: 'price_threshold', config: { operator: 'above', price: 500 } },
          { id: 'r2', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
          { id: 'r3', type: 'cooldown', config: { windowMs: 86400000 } },
          { id: 'r4', type: 'position_limit', config: { maxShares: 100, maxPositions: 2 } },
          { id: 'r5', type: 'daily_loss', config: { maxLoss: 500, maxDailyLossPct: 5 } },
          { id: 'r6', type: 'trend_filter', config: { symbol: 'SPY', regime: 'risk_on' } },
          { id: 'r7', type: 'time_window', config: { start: '09:45', end: '15:45', timezone: 'America/New_York' } },
        ],
      }

      const draft = initEditDraft(allRulesBot)
      expect(draft.fixed).toHaveLength(2) // trend_filter, time_window

      // Edit only price threshold
      draft.trigger.price = '550'

      const built = buildBotFromDraft(draft, allRulesBot)
      expect(built.rules).toHaveLength(7)

      // Verify all 7 rule types and their IDs are present
      const ruleTypes = built.rules.map((r) => r.type)
      expect(ruleTypes).toContain('price_threshold')
      expect(ruleTypes).toContain('market_hours')
      expect(ruleTypes).toContain('cooldown')
      expect(ruleTypes).toContain('position_limit')
      expect(ruleTypes).toContain('daily_loss')
      expect(ruleTypes).toContain('trend_filter')
      expect(ruleTypes).toContain('time_window')

      for (let i = 1; i <= 7; i++) {
        expect(built.rules.find((r) => r.id === `r${i}`)).toBeDefined()
      }

      // Untouched sub-properties preserved
      expect(built.rules.find((r) => r.type === 'position_limit').config.maxPositions).toBe(2)
      expect(built.rules.find((r) => r.type === 'daily_loss').config.maxDailyLossPct).toBe(5)
      expect(built.rules.find((r) => r.type === 'trend_filter').config).toEqual({ symbol: 'SPY', regime: 'risk_on' })
      expect(built.rules.find((r) => r.type === 'time_window').config).toEqual({ start: '09:45', end: '15:45', timezone: 'America/New_York' })
    })

    it('handles partial save failures explicitly (Requirement 6)', async () => {
      const api = {
        put: vi.fn().mockImplementation(async (path) => {
          if (path.includes('/rules/')) throw new Error('Rule update failed on server')
          return {}
        }),
        post: vi.fn().mockResolvedValue({}),
        del: vi.fn().mockResolvedValue({}),
      }

      const bot = {
        id: 'bot_partial',
        config: { tickers: ['SPY'], allocatedAmount: 1000 },
        rules: [{ id: 'r1', type: 'price_threshold', config: { operator: 'above', price: 100 } }],
      }

      const builtBot = {
        name: 'New Name',
        config: { tickers: ['SPY'], allocatedAmount: 2000 },
        rules: [{ id: 'r1', type: 'price_threshold', config: { operator: 'above', price: 150 } }],
      }

      const res = await saveBotAlgorithm({ bot, builtBot, api })

      // Confirmed: does NOT report success
      expect(res.ok).toBe(false)
      expect(res.partial).toBe(true)
      expect(res.error).toMatch(/Your bot settings were saved, but some rule changes couldn’t be applied/)
    })

    it('verifies load -> edit -> save -> reload round trip equality for all rules and hidden fields (Requirement 9)', async () => {
      // 1. Initial complete bot as stored in DB
      const initialBot = {
        id: 'bot_roundtrip',
        name: 'Long-Short Trend Alpha',
        direction: 'buy',
        allocation: 5000,
        maxPerOrder: 1000,
        tickers: ['SPY', 'QQQ'],
        config: {
          tickers: ['SPY', 'QQQ'],
          direction: 'buy',
          capitalMode: 'allocated',
          allocatedAmount: 5000,
          maxOrderNotional: 1000,
          quantity: 10,
          riskLimits: { maxDrawdownPct: 15 },
          positionSizing: { method: 'equal_weight' },
          timezone: 'America/New_York',
          requiredRegime: 'risk_on',
          riskOnExposure: 0.9,
          maxSnapshotAgeHours: 24,
          preferences: { autoRebalance: true },
        },
        rules: [
          { id: 'r_pt', name: 'Price Threshold', type: 'price_threshold', config: { operator: 'above', price: 450 } },
          { id: 'r_mh', name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
          { id: 'r_cd', name: 'Cooldown', type: 'cooldown', config: { windowMs: 7200000 } }, // 2h
          { id: 'r_pl', name: 'Position Limit', type: 'position_limit', config: { maxShares: 150, maxPositions: 2 } },
          { id: 'r_dl', name: 'Daily Loss', type: 'daily_loss', config: { maxLoss: 300, maxDailyLossPct: 3 } },
          { id: 'r_tf', name: 'Trend Filter', type: 'trend_filter', config: { symbol: 'SPY', regime: 'risk_on' } },
          { id: 'r_tw', name: 'Time Window', type: 'time_window', config: { start: '10:00', end: '15:30' } },
        ],
      }

      // 2. Load into builder draft
      const draft = initEditDraft(initialBot)

      // 3. User edits visible fields:
      // - increases capital to 8000
      // - increases maxPerOrder to 2000
      // - changes trigger price to 460
      // - changes cooldown to 3 hours
      draft.capital = '8000'
      draft.maxPerOrder = '2000'
      draft.trigger.price = '460'
      draft.cooldown.hours = '3'

      // 4. Build bot
      const built = buildBotFromDraft(draft, initialBot)

      // 5. Execute saveBotAlgorithm
      const savedState = { config: null, rules: new Map(initialBot.rules.map((r) => [r.id, { ...r }])) }
      const api = {
        put: vi.fn().mockImplementation(async (path, body) => {
          if (path === `/bots/${initialBot.id}`) {
            savedState.config = body.config
            return { data: { ...initialBot, config: body.config } }
          }
          const ruleId = path.split('/').pop()
          const r = savedState.rules.get(ruleId)
          if (r) r.config = body.config
          return { data: r }
        }),
        del: vi.fn(),
        post: vi.fn(),
      }

      const saveRes = await saveBotAlgorithm({ bot: initialBot, builtBot: built, api })
      expect(saveRes.ok).toBe(true)

      // 6. Reload from saved state
      const reloadedBot = {
        ...initialBot,
        allocation: savedState.config.allocatedAmount,
        maxPerOrder: savedState.config.maxOrderNotional,
        config: savedState.config,
        rules: [...savedState.rules.values()],
      }

      // 7. Verify load -> edit -> save -> reload equality:
      // Intended changes
      expect(reloadedBot.allocation).toBe(8000)
      expect(reloadedBot.maxPerOrder).toBe(2000)
      expect(reloadedBot.rules.find((r) => r.type === 'price_threshold').config.price).toBe(460)
      expect(reloadedBot.rules.find((r) => r.type === 'cooldown').config.windowMs).toBe(3 * 3600000)

      // Preserved engine fields
      expect(reloadedBot.config.quantity).toBe(10)
      expect(reloadedBot.config.riskLimits).toEqual({ maxDrawdownPct: 15 })
      expect(reloadedBot.config.positionSizing).toEqual({ method: 'equal_weight' })
      expect(reloadedBot.config.timezone).toBe('America/New_York')
      expect(reloadedBot.config.requiredRegime).toBe('risk_on')
      expect(reloadedBot.config.riskOnExposure).toBe(0.9)
      expect(reloadedBot.config.maxSnapshotAgeHours).toBe(24)
      expect(reloadedBot.config.preferences).toEqual({ autoRebalance: true })

      // Preserved rules untouched
      expect(reloadedBot.rules.find((r) => r.type === 'trend_filter').config).toEqual({ symbol: 'SPY', regime: 'risk_on' })
      expect(reloadedBot.rules.find((r) => r.type === 'time_window').config).toEqual({ start: '10:00', end: '15:30' })
      expect(reloadedBot.rules.find((r) => r.type === 'position_limit').config.maxPositions).toBe(2)
      expect(reloadedBot.rules.find((r) => r.type === 'daily_loss').config.maxDailyLossPct).toBe(3)
    })

  })
})
