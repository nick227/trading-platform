import { describe, it, expect, vi } from 'vitest'
import {
  exitDraftFrom,
  exitConfigFromDraft,
  initCreateDraft,
  initEditDraft,
  validateBuilderDraft,
  buildBotFromDraft,
  buildConfigPatch,
  formatDesiredRules,
  mapServerValidationError,
  createBotConfiguration,
  updateBotConfiguration,
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
    it('initializes draft from an existing bot, including updatedAt for concurrency control', () => {
      const existingBot = {
        id: 'bot_123',
        name: 'My Custom Bot',
        direction: 'buy',
        allocation: 3000,
        maxPerOrder: 600,
        updatedAt: '2026-11-22T23:00:00.000Z',
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
      expect(draft.updatedAt).toBe('2026-11-22T23:00:00.000Z')
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

    it('rejects order size larger than capital', () => {
      const draft = {
        name: 'Valid Name',
        symbolsText: 'AAPL',
        capital: '1000',
        maxPerOrder: '1500',
        triggerType: 'schedule',
        marketHours: { on: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
      }

      const errors = validateBuilderDraft(draft)
      expect(errors.maxPerOrder).toBe('Can’t be more than the bot budget.')
    })
  })

  describe('Transactional Bot Configuration Contract (PR #25)', () => {
    it('buildConfigPatch sends only changed Bot.config fields on edit (patch semantics)', () => {
      const baseConfig = {
        tickers: ['AAPL'],
        direction: 'buy',
        allocatedAmount: 5000,
        maxOrderNotional: 1000,
        capitalMode: 'allocated',
        riskLimits: { maxDrawdownPct: 15 },
        timezone: 'America/New_York',
      }

      // 1. User changes ONLY maxPerOrder from 1000 to 1500
      const draft1 = {
        isEdit: true,
        initialDirection: 'buy',
        symbolsText: 'AAPL',
        direction: 'buy',
        capital: '5000',
        maxPerOrder: '1500',
        triggerType: 'schedule',
      }

      const patch1 = buildConfigPatch(draft1, baseConfig)
      expect(patch1).toEqual({ maxOrderNotional: 1500 })
      // Untouched properties are NOT sent in patch, so server deep-merges them
      expect(patch1.tickers).toBeUndefined()
      expect(patch1.direction).toBeUndefined()
      expect(patch1.allocatedAmount).toBeUndefined()

      // 2. User changes symbols and capital
      const draft2 = {
        isEdit: true,
        initialDirection: 'buy',
        symbolsText: 'MSFT, NVDA',
        direction: 'sell',
        capital: '8000',
        maxPerOrder: '1000',
        triggerType: 'schedule',
      }
      const patch2 = buildConfigPatch(draft2, baseConfig)
      expect(patch2).toEqual({
        tickers: ['MSFT', 'NVDA'],
        direction: 'sell',
        allocatedAmount: 8000,
      })
    })

    it('disabled rules remain persisted with enabled: false while preserving IDs, names, config, and order', () => {
      const originalRules = [
        { id: 'rule_price', type: 'price_threshold', name: 'Price trigger', config: { operator: 'above', price: 400 }, enabled: true },
        { id: 'rule_hours', type: 'market_hours', name: 'Market hours', config: { allowPremarket: false, allowAfterHours: false }, enabled: true },
        { id: 'rule_cd', type: 'cooldown', name: 'Cooldown', config: { windowMs: 86400000 }, enabled: true },
      ]

      // Draft updates trigger price to 420, keeps market hours on, disables cooldown, and adds daily loss
      const draft = {
        direction: 'buy',
        triggerType: 'price_threshold',
        trigger: { operator: 'above', price: '420' },
        marketHours: { on: true, extended: false },
        cooldown: { on: false }, // disabled, NOT explicitly removed
        positionLimit: { on: false },
        dailyLoss: { on: true, maxLoss: '300' },
        fixed: [],
      }

      const desired = formatDesiredRules(draft, originalRules)
      // All 3 original rules are preserved in order, plus the new daily loss
      expect(desired).toHaveLength(4)

      // 1. rule_price: ID preserved, new price, enabled: true
      expect(desired[0]).toEqual({
        id: 'rule_price',
        name: 'Price trigger',
        type: 'price_threshold',
        config: { operator: 'above', price: 420 },
        enabled: true,
      })

      // 2. rule_hours: ID preserved, config preserved, enabled: true
      expect(desired[1]).toEqual({
        id: 'rule_hours',
        name: 'Market hours',
        type: 'market_hours',
        config: { allowPremarket: false, allowAfterHours: false },
        enabled: true,
      })

      // 3. rule_cd: ID preserved, config preserved, enabled: false (Correction 1)
      expect(desired[2]).toEqual({
        id: 'rule_cd',
        name: 'Cooldown',
        type: 'cooldown',
        config: { windowMs: 86400000 },
        enabled: false,
      })

      // 4. new daily_loss: no ID, enabled: true
      expect(desired[3]).toEqual({
        name: 'Daily Loss Limit',
        type: 'daily_loss',
        config: { maxLoss: 300 },
        enabled: true,
      })
    })

    it('only an explicitly removed rule is omitted and deleted', () => {
      const originalRules = [
        { id: 'rule_price', type: 'price_threshold', name: 'Price trigger', config: { operator: 'above', price: 400 }, enabled: true },
        { id: 'rule_hours', type: 'market_hours', name: 'Market hours', config: { allowPremarket: false, allowAfterHours: false }, enabled: true },
        { id: 'rule_cd', type: 'cooldown', name: 'Cooldown', config: { windowMs: 86400000 }, enabled: true },
      ]

      // Draft explicitly removes rule_cd
      const draft = {
        direction: 'buy',
        triggerType: 'price_threshold',
        trigger: { operator: 'above', price: '400' },
        marketHours: { on: true, extended: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
        removedRuleIds: new Set(['rule_cd']),
      }

      const desired = formatDesiredRules(draft, originalRules)
      expect(desired).toHaveLength(2)
      expect(desired.find((r) => r.id === 'rule_cd')).toBeUndefined()
    })

    it('supports all seven BotRule types and preserves IDs and untouched config', () => {
      const allRulesBot = {
        id: 'bot_all_rules',
        config: { tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 },
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
      const built = buildBotFromDraft(draft, allRulesBot)
      expect(built.rules).toHaveLength(7)

      for (let i = 1; i <= 7; i++) {
        expect(built.rules.find((r) => r.id === `r${i}`)).toBeDefined()
      }

      expect(built.rules.find((r) => r.type === 'position_limit').config.maxPositions).toBe(2)
      expect(built.rules.find((r) => r.type === 'daily_loss').config.maxDailyLossPct).toBe(5)
      expect(built.rules.find((r) => r.type === 'trend_filter').config).toEqual({ symbol: 'SPY', regime: 'risk_on' })
      expect(built.rules.find((r) => r.type === 'time_window').config).toEqual({ start: '09:45', end: '15:45', timezone: 'America/New_York' })
    })

    it('createBotConfiguration calls POST /api/bots/configuration with completed starting point rules', async () => {
      const api = { post: vi.fn().mockResolvedValue({ id: 'bot_created_1' }) }

      const template = {
        id: 'tmpl_momentum_buy',
        name: 'Momentum Buy',
        config: { tickers: ['MSFT'], allocatedAmount: 5000, maxOrderNotional: 1000 },
        rules: [
          { type: 'price_threshold', config: {} },
          { type: 'market_hours', config: {} },
        ],
      }

      const draft = {
        isEdit: false,
        name: 'MSFT breakout',
        symbolsText: 'MSFT',
        direction: 'buy',
        capital: '5000',
        maxPerOrder: '1000',
        triggerType: 'price_threshold',
        trigger: { operator: 'above', price: '410' },
        marketHours: { on: true, extended: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
      }

      await createBotConfiguration({
        portfolioId: 'prt_123',
        templateId: 'tmpl_momentum_buy',
        draft,
        originalTemplate: template,
        api,
      })

      expect(api.post).toHaveBeenCalledWith('/bots/configuration', {
        portfolioId: 'prt_123',
        templateId: 'tmpl_momentum_buy',
        name: 'MSFT breakout',
        enabled: true,
        config: {
          tickers: ['MSFT'],
          direction: 'buy',
          allocatedAmount: 5000,
          maxOrderNotional: 1000,
          exit: null, // no exits chosen: removes any template exit
        },
        rules: [
          {
            type: 'price_threshold',
            config: { operator: 'above', price: 410 },
            enabled: true,
          },
          {
            type: 'market_hours',
            config: {},
            enabled: true,
          },
        ],
      })
    })

    it('updateBotConfiguration calls PUT /api/bots/:id/configuration with expectedUpdatedAt and patch', async () => {
      const api = { put: vi.fn().mockResolvedValue({ id: 'bot_1', updatedAt: '2026-11-22T23:50:00.000Z' }) }

      const bot = {
        id: 'bot_1',
        updatedAt: '2026-11-22T23:40:00.000Z',
        config: {
          tickers: ['MSFT'],
          direction: 'buy',
          allocatedAmount: 5000,
          maxOrderNotional: 1000,
        },
        rules: [
          { id: 'r_price', type: 'price_threshold', name: 'Price trigger', config: { operator: 'above', price: 400 }, enabled: true },
        ],
      }

      const draft = {
        isEdit: true,
        initialDirection: 'buy',
        initialTriggerType: 'price_threshold',
        updatedAt: '2026-11-22T23:40:00.000Z',
        name: 'MSFT breakout updated',
        symbolsText: 'MSFT',
        direction: 'buy',
        capital: '5000',
        maxPerOrder: '1500', // only maxOrderNotional changed
        triggerType: 'price_threshold',
        trigger: { operator: 'above', price: '420' },
        marketHours: { on: false },
        cooldown: { on: false },
        positionLimit: { on: false },
        dailyLoss: { on: false },
      }

      await updateBotConfiguration({
        bot,
        draft,
        api,
      })

      expect(api.put).toHaveBeenCalledWith('/bots/bot_1/configuration', {
        expectedUpdatedAt: '2026-11-22T23:40:00.000Z',
        name: 'MSFT breakout updated',
        config: {
          maxOrderNotional: 1500,
        },
        rules: [
          {
            id: 'r_price',
            name: 'Price trigger',
            type: 'price_threshold',
            config: { operator: 'above', price: 420 },
            enabled: true,
          },
        ],
      })
    })

    it('updateBotConfiguration always sends expectedUpdatedAt to prevent blind overwrites (Correction 2)', async () => {
      const api = { put: vi.fn().mockResolvedValue({ id: 'bot_1' }) }
      const bot = { id: 'bot_1', updatedAt: '2026-11-22T23:40:00.000Z', config: {}, rules: [] }
      const draft = { isEdit: true, updatedAt: '2026-11-22T23:40:00.000Z', name: 'Bot', symbolsText: 'AAPL', capital: '1000', maxPerOrder: '500', triggerType: 'schedule', marketHours: { on: false }, cooldown: { on: false }, positionLimit: { on: false }, dailyLoss: { on: false } }

      await updateBotConfiguration({
        bot,
        draft,
        api,
      })

      const callPayload = api.put.mock.calls[0][1]
      expect(callPayload.expectedUpdatedAt).toBe('2026-11-22T23:40:00.000Z')
    })

    it('mapServerValidationError maps INVALID_CONFIG, INVALID_RULE, and STALE_BOT correctly', () => {
      // 1. STALE_BOT
      const staleError = {
        code: 'STALE_BOT',
        serverMessage: 'Bot changed.',
        details: { code: 'STALE_BOT', message: 'This bot changed since it was loaded.', updatedAt: '2026-11-22T23:55:00.000Z' },
      }
      const mappedStale = mapServerValidationError(staleError)
      expect(mappedStale.stale).toBe(true)
      expect(mappedStale.currentUpdatedAt).toBe('2026-11-22T23:55:00.000Z')

      // 2. INVALID_CONFIG field mapping
      const configError = {
        code: 'INVALID_CONFIG',
        details: { code: 'INVALID_CONFIG', field: 'allocatedAmount', message: 'Capital must be greater than 0.' },
      }
      const mappedConfig = mapServerValidationError(configError)
      expect(mappedConfig.fieldErrors.capital).toBe('Capital must be greater than 0.')

      // 3. INVALID_RULE mapping
      const ruleError = {
        code: 'INVALID_RULE',
        details: { code: 'INVALID_RULE', type: 'price_threshold', message: 'Trigger price must be greater than 0.' },
      }
      const mappedRule = mapServerValidationError(ruleError)
      expect(mappedRule.fieldErrors.triggerPrice).toBe('Trigger price must be greater than 0.')
    })
  })
})

describe('lossless saves (integration defects B3/B4)', () => {
  const rules = [
    { id: 'r1', type: 'price_threshold', name: 'Price', config: { direction: 'above', operator: 'above', price: 500 }, enabled: true },
    { id: 'r2', type: 'market_hours', name: 'Hours', config: { allowPremarket: true, allowAfterHours: false }, enabled: true },
    { id: 'r3', type: 'daily_loss', name: 'Loss', config: { maxDailyLossPct: 3 }, enabled: true },
    { id: 'r4', type: 'cooldown', name: 'Hourly', config: { cooldownHours: 1, windowMs: 3_600_000 }, enabled: true },
    { id: 'r5', type: 'cooldown', name: 'Daily', config: { windowMs: 86_400_000 }, enabled: true },
    { id: 'r6', type: 'position_limit', name: 'Pos', config: { maxShares: 100 }, enabled: false },
    { id: 'r7', type: 'time_window', name: 'Window', config: { start: '09:45', end: '15:30' }, enabled: true },
    { id: 'r8', type: 'trend_filter', name: 'Trend', config: { symbol: 'QQQ', confirmationBars: 2 }, enabled: true },
  ]
  const bot = { id: 'b', updatedAt: 't', name: 'B', config: { tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 }, rules }

  it('a no-op edit sends every rule exactly as stored (configs, names, enabled, duplicates)', () => {
    const sent = formatDesiredRules(initEditDraft(bot), rules)
    expect(sent).toEqual(rules.map(({ id, type, name, config, enabled }) => ({ id, type, name, config, enabled })))
    expect(buildConfigPatch(initEditDraft(bot), bot.config)).toEqual({})
  })

  it('editing one field changes only that field of that rule', () => {
    const d = initEditDraft(bot)
    const sent = formatDesiredRules({ ...d, dailyLoss: { ...d.dailyLoss, maxLoss: '250' }, trigger: { ...d.trigger, price: '520' } }, rules)
    expect(sent.find((r) => r.id === 'r3').config).toEqual({ maxDailyLossPct: 3, maxLoss: 250 })
    expect(sent.find((r) => r.id === 'r1').config).toEqual({ direction: 'above', operator: 'above', price: 520 })
    expect(sent.find((r) => r.id === 'r2').config).toEqual({ allowPremarket: true, allowAfterHours: false })
    expect(sent.find((r) => r.id === 'r5').config).toEqual({ windowMs: 86_400_000 })
  })

  it('unchecking keeps the rule (enabled:false); re-checking a disabled rule enables it', () => {
    const d = initEditDraft(bot)
    const sent = formatDesiredRules({ ...d, cooldown: { ...d.cooldown, on: false }, positionLimit: { ...d.positionLimit, on: true } }, rules)
    expect(sent.find((r) => r.id === 'r4')).toMatchObject({ enabled: false, config: { cooldownHours: 1, windowMs: 3_600_000 } })
    expect(sent.find((r) => r.id === 'r5').enabled).toBe(true)
    expect(sent.find((r) => r.id === 'r6')).toMatchObject({ enabled: true, config: { maxShares: 100 } })
  })

  it('research bots keep an absent direction (they follow BUY and SELL research)', () => {
    const research = { ...bot, config: { tickers: ['AAPL'], signalSource: 'alpha_research', research: { minConfidence: 0.45 } }, rules: [] }
    const d = initEditDraft(research)
    expect(d.direction).toBeNull()
    expect(buildConfigPatch({ ...d, research: { ...d.research, minScore: '55' } }, research.config)).toEqual({ research: { minConfidence: 0.55 } })
    expect(buildConfigPatch({ ...d, direction: 'buy' }, research.config)).toMatchObject({ direction: 'buy' })
    const create = initCreateDraft({ id: 'tmpl_alpha_research', config: { tickers: [], signalSource: 'alpha_research' }, rules: [] })
    expect(create.direction).toBeNull()
    expect(buildConfigPatch({ ...create, symbolsText: 'AAPL' }, {})).not.toHaveProperty('direction')
  })

  it('rule bots never get a default direction written on edit', () => {
    const legacy = { ...bot, config: { tickers: ['SPY'] } }
    expect(buildConfigPatch(initEditDraft(legacy), legacy.config)).toEqual({})
  })
})

describe('paper trading symbol list', () => {
  const base = { name: 'B', symbolsText: 'AAPL, TSLA', capital: '1000', maxPerOrder: '500', triggerType: 'schedule', direction: 'buy', cooldown: { on: false }, positionLimit: { on: false }, dailyLoss: { on: false }, marketHours: { on: false } }
  it('flags symbols outside the paper-trading list, naming them and the choices', () => {
    const e = validateBuilderDraft(base, { tradableSymbols: ['SPY', 'AAPL'] })
    expect(e.symbols).toBe('TSLA isn’t available in paper trading. Choose from SPY, AAPL.')
    expect(validateBuilderDraft({ ...base, symbolsText: 'aapl' }, { tradableSymbols: ['SPY', 'AAPL'] }).symbols).toBeUndefined()
    expect(validateBuilderDraft(base, {}).symbols).toBeUndefined()
  })
})

describe('market-aware conditions in the builder', () => {
  const base = { name: 'X', symbolsText: 'SPY', direction: 'buy', capital: '5000', maxPerOrder: '1000', triggerType: 'price_threshold', trigger: { operator: 'above', price: '500' },
    marketHours: { on: false }, cooldown: { on: false }, positionLimit: { on: false }, dailyLoss: { on: false } }
  it('adds the conditions as rules when switched on', () => {
    const rules = formatDesiredRules({ ...base, relVolume: { on: true, minRatio: '2' }, priceChange: { on: true, sessions: '10', operator: 'below', pct: '4' } }, [])
    expect(rules.filter((r) => ['relative_volume', 'price_change'].includes(r.type))).toEqual([
      { name: 'Relative Volume', type: 'relative_volume', config: { minRatio: 2 }, enabled: true },
      { name: 'Price Change', type: 'price_change', config: { sessions: 10, operator: 'below', pct: 4 }, enabled: true },
    ])
  })
  it('edits only what changed on existing rules and keeps a switched-off rule (disabled)', () => {
    const existing = [{ id: 'r1', type: 'price_change', config: { sessions: 5, operator: 'above', pct: 3 }, enabled: true }, { id: 'r2', type: 'relative_volume', config: { minRatio: 1.5 }, enabled: true }]
    const rules = formatDesiredRules({ ...base, priceChange: { on: true, sessions: '5', operator: 'above', pct: '6' }, relVolume: { on: false, minRatio: '1.5' } }, existing)
    expect(rules.find((r) => r.id === 'r1')).toMatchObject({ config: { sessions: 5, operator: 'above', pct: 6 }, enabled: true })
    expect(rules.find((r) => r.id === 'r2')).toMatchObject({ config: { minRatio: 1.5 }, enabled: false })
  })
  it('validates the values', () => {
    expect(validateBuilderDraft({ ...base, relVolume: { on: true, minRatio: '0' } }).relVolume).toMatch(/between 0 and 10/)
    expect(validateBuilderDraft({ ...base, priceChange: { on: true, sessions: '90', operator: 'above', pct: '3' } }).priceChange).toMatch(/1–60/)
    expect(validateBuilderDraft({ ...base, priceChange: { on: false, sessions: '90' } }).priceChange).toBeUndefined()
  })
})

describe('exits in the builder', () => {
  it('reads a template’s exits and writes them back as config.exit.rules', () => {
    const cfg = { exit: { rules: [{ type: 'stop_loss', config: { pct: 8 } }, { type: 'price_change', config: { sessions: 10, operator: 'below', pct: 5 } }] } }
    const e = exitDraftFrom(cfg)
    expect(e).toMatchObject({ stopLoss: { on: true, pct: '8' }, trend: { on: false }, reversal: { on: true, sessions: '10', pct: '5' } })
    expect(exitConfigFromDraft({ direction: 'buy', triggerType: 'price_threshold', exit: e })).toEqual(cfg.exit)
    expect(exitConfigFromDraft({ direction: 'buy', triggerType: 'price_threshold', exit: { ...e, stopLoss: { on: false }, reversal: { on: false } } })).toBeNull()
    expect(exitConfigFromDraft({ direction: 'sell', triggerType: 'price_threshold', exit: e })).toBeNull() // never on sell bots
  })
})
