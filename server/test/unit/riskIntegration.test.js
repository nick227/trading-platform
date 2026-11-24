/** Bot → risk engine integration: real inputs only, explicit approve / restrict / reject semantics. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ session: null, regime: null }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: {} }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: {} }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock('../../../worker/src/market/dataStream.js', () => ({ subscribe() {}, unsubscribe() {} }))
vi.mock('../../src/clients/engine.js', () => ({ engineClient: {
  getSessionClose: vi.fn(async (t, s) => { h.session = s ?? null; return { ticker: t, session: s ?? '2026-11-20', close: 100, volume: 3_000_000, avgVolume20: 2_000_000 } }),
  getRegime: vi.fn(async () => h.regime),
} }))

const { resolveRiskOutcome, riskPolicyConfig } = await import('../../../worker/src/risk/riskOutcome.js')
const { riskGateService } = await import('../../../worker/src/risk/services/RiskGateService.js')
const { riskDecisionMatrix } = await import('../../../worker/src/risk/services/RiskDecisionMatrix.js')
const { executionConfidenceService } = await import('../../../worker/src/risk/services/ExecutionConfidenceService.js')
const { marketDataFor } = await import('../../../worker/src/engine/botEngine.js')

beforeEach(() => {
  vi.restoreAllMocks()
  delete process.env.BROKER_MODE; delete process.env.SIM_REPLAY_SESSION
  h.regime = null
})

describe('resolveRiskOutcome', () => {
  const ev = (decision, extra = {}) => ({ approved: decision === 'approve', decision, reason: `${decision}_reason`, adjustedQuantity: 4, failedChecks: [], ...extra })
  it('approve trades the requested size; reject never trades', () => {
    expect(resolveRiskOutcome(ev('approve'), { quantity: 9 })).toMatchObject({ proceed: true, quantity: 9, basis: 'approved' })
    expect(resolveRiskOutcome(ev('reject'), { quantity: 9, restrictMode: 'reduce' })).toMatchObject({ proceed: false, basis: 'rejected' })
  })
  it('restrict is not approval: blocked by default, reduced size only when explicitly enabled', () => {
    expect(resolveRiskOutcome(ev('restrict'), { quantity: 9 })).toMatchObject({ proceed: false, basis: 'restricted_blocked', verdict: { adjustedQuantity: 4 } })
    expect(resolveRiskOutcome(ev('restrict'), { quantity: 9, restrictMode: 'reduce' })).toMatchObject({ proceed: true, quantity: 4, basis: 'restricted_reduced' })
    expect(resolveRiskOutcome(ev('restrict', { failedChecks: [{ type: 'risk_per_trade' }] }), { quantity: 9, restrictMode: 'reduce' }).proceed).toBe(false)
    expect(resolveRiskOutcome(ev('restrict', { adjustedQuantity: 0 }), { quantity: 9, restrictMode: 'reduce' }).proceed).toBe(false)
  })
  it('a test scenario exists only inside the enabled simulator, and keeps the verdict', () => {
    expect(riskPolicyConfig({ SIM_TEST_SCENARIO: 'p0-demo' })).toEqual({ restrictMode: 'block', testScenario: null })
    expect(riskPolicyConfig({ SIM_TEST_SCENARIO: 'p0-demo', RISK_RESTRICT_MODE: 'reduce' }, { simulationEnabled: true })).toEqual({ restrictMode: 'reduce', testScenario: 'p0-demo' })
    expect(riskPolicyConfig({ RISK_RESTRICT_MODE: 'yes' }).restrictMode).toBe('block')
    const r = resolveRiskOutcome(ev('reject'), { quantity: 9, testScenario: 'p0-demo' })
    expect(r).toMatchObject({ proceed: true, quantity: 9, basis: 'simulator_test_scenario', verdict: { decision: 'reject', approved: false } })
  })
})

describe('risk gate inputs', () => {
  it('never fabricates a signal or regime, and passes real market data through', async () => {
    const spy = vi.spyOn(riskDecisionMatrix, 'evaluateTradeRequest').mockResolvedValue({ decision: 'approve', reason: 'all_scores_healthy', positionMultiplier: 1, scores: {} })
    vi.spyOn(riskGateService, 'getPortfolioState').mockResolvedValue({ totalValue: 100000, cashBalance: 100000, dailyLoss: 0, drawdown: 0, totalExposure: 0, positions: [] })
    vi.spyOn(riskGateService, 'getRiskSettings').mockResolvedValue(riskGateService.getDefaultRiskSettings())
    vi.spyOn(riskGateService, 'checkConcurrentTrades').mockResolvedValue({ type: 'concurrent_trades', passed: true })
    await riskGateService.evaluateExecutionRisk({ portfolioId: 'p', ticker: 'AAPL', direction: 'buy', quantity: 2, price: 100 })
    expect(spy.mock.calls[0][1]).toEqual({ ticker: 'AAPL', direction: 'buy' })
    await riskGateService.evaluateExecutionRisk({ portfolioId: 'p', ticker: 'AAPL', direction: 'buy', quantity: 2, price: 100,
      signal: { confidence: 0.49, botId: 'b' }, marketData: { volume: 3e6, avgVolume: 2e6, regime: 'bear' } })
    expect(spy.mock.calls[1][1]).toEqual({ ticker: 'AAPL', direction: 'buy', confidence: 0.49, botId: 'b', regime: 'bear' })
    expect(spy.mock.calls[1][2]).toMatchObject({ ticker: 'AAPL', price: 100, volume: 3e6, avgVolume: 2e6 })
  })
})

describe('scoring with real inputs', () => {
  const healthy = { operational: 95, exposure: 88, stress: 75 }
  const decide = async (signal, md) => {
    vi.spyOn(executionConfidenceService, 'scoreBotWinRate').mockResolvedValue(50)
    const e = await executionConfidenceService.calculateExecutionConfidence(signal, 'p', md)
    return { score: e.score, ...riskDecisionMatrix.applyDecisionMatrix({ ...healthy, execution: e.score }, signal, 'p') }
  }
  it('weak research (0.49) is not approved even with good liquidity', async () => {
    const r = await decide({ confidence: 0.49 }, { price: 100, volume: 3e6, avgVolume: 2e6, spread: 0.01 })
    expect(r.action).not.toBe('approve')
  })
  it('strong research with good real market data can be approved', async () => {
    const r = await decide({ confidence: 0.85, regime: 'bull' }, { price: 100, volume: 3e6, avgVolume: 2e6, spread: 0.01 })
    expect(r).toMatchObject({ action: 'approve' })
    expect(r.score).toBeGreaterThanOrEqual(75)
  })
})

describe('marketDataFor', () => {
  it('uses real volume and regime; spread only from a real two-sided quote', async () => {
    h.regime = { regime: 'risk_on' }
    const md = await marketDataFor('MSFT', { last: 100, bid: 99.98, ask: 100.02 })
    expect(md).toMatchObject({ ticker: 'MSFT', price: 100, volume: 3e6, avgVolume: 2e6, regime: 'bull' })
    expect(md.spread).toBeCloseTo(0.04, 6)
    expect(h.session).toBe(null)
    const flat = await marketDataFor('AMD', { last: 50, bid: 50, ask: 50 })
    expect(flat.spread).toBeUndefined()
  })
  it('in replay, reads the replay session and omits the (non point-in-time) regime', async () => {
    process.env.BROKER_MODE = 'simulated'; process.env.SIM_REPLAY_SESSION = '2026-11-19'
    h.regime = { regime: 'risk_on' }
    const md = await marketDataFor('NFLX', { last: 100, bid: 100, ask: 100 })
    expect(h.session).toBe('2026-11-19')
    expect(md).toMatchObject({ session: '2026-11-19', volume: 3e6 })
    expect(md.regime).toBeUndefined()
  })
})

describe('simulator scoring: unknown inputs are not applicable (thresholds unchanged)', () => {
  const healthy = { operational: 95, exposure: 88, stress: 75 }
  const decide = async (signal, md, unknownAsNotApplicable = true) => {
    vi.spyOn(executionConfidenceService, 'scoreBotWinRate').mockResolvedValue(unknownAsNotApplicable ? null : 50)
    const e = await executionConfidenceService.calculateExecutionConfidence(signal, 'p', md, { unknownAsNotApplicable })
    return { score: e.score, notApplicable: e.notApplicable, ...riskDecisionMatrix.applyDecisionMatrix({ ...healthy, execution: e.score }, signal, 'p') }
  }
  const dailyClose = (volume, avgVolume) => ({ price: 484.52, volume, avgVolume }) // daily data: no spread

  it('a rule-based bot on a liquid daily close is approved on its real inputs', async () => {
    const r = await decide({ botId: 'b' }, dailyClose(47e6, 28e6))
    expect(r).toMatchObject({ action: 'approve', score: 85 })
    expect(r.notApplicable.sort()).toEqual(['botWinRate', 'regimeFit', 'signalConfidence', 'spreadQuality'])
  })

  it('the same bot on a thin day is still restricted (liquidity is a real input)', async () => {
    expect((await decide({ botId: 'b' }, dailyClose(20e6, 28e6))).action).not.toBe('approve')
  })

  it('weak research stays rejected/restricted; strong research can be approved', async () => {
    expect((await decide({ botId: 'b', confidence: 0.49 }, dailyClose(47e6, 28e6))).action).not.toBe('approve')
    expect((await decide({ botId: 'b', confidence: 0.85 }, dailyClose(47e6, 28e6))).action).toBe('approve')
  })

  it('with no real input at all the score stays neutral and the order is restricted', async () => {
    const r = await decide({ botId: 'b' }, {})
    expect(r.score).toBe(50)
    expect(r.action).not.toBe('approve')
  })

  it('outside the simulator nothing changes: unknown inputs still count as 50', async () => {
    const r = await decide({ botId: 'b' }, dailyClose(47e6, 28e6), false)
    expect(r.score).toBe(59)
    expect(r.action).not.toBe('approve')
  })
})

describe('bot win rate comes from closed trades (FIFO realized P&L), not Execution.pnl', () => {
  const now = new Date()
  const f = (id, direction, qty, price) => ({ id, ticker: 'SPY', direction, status: 'filled', filledQuantity: qty, filledPrice: price, fees: 0, pnl: 0, brokerOrderId: `simdaily_2026-11-23_${id}`, filledAt: now, createdAt: now })
  const score = (fills, nullWhenUnknown = true) => executionConfidenceService.scoreBotWinRate('b', 'p', { nullWhenUnknown, loadFills: async () => fills })

  it('an accumulation bot with only buys has an unknown win rate (the overnight SPY case), not 0%', async () => {
    vi.restoreAllMocks()
    expect(await score([f('b1', 'buy', 1, 689.81), f('b2', 'buy', 1, 722.29)])).toBeNull()
    expect(await score([f('b1', 'buy', 1, 689.81)], false)).toBe(50)
  })
  it('counts realized wins and losses on sells', async () => {
    vi.restoreAllMocks()
    expect(await score([f('b1', 'buy', 2, 100), f('s1', 'sell', 1, 110), f('s2', 'sell', 1, 120)])).toBe(90)
    expect(await score([f('b1', 'buy', 2, 100), f('s1', 'sell', 1, 90), f('s2', 'sell', 1, 95)])).toBe(30)
  })
  it('the overnight case now approves on liquidity alone (75 meets the threshold)', async () => {
    vi.restoreAllMocks()
    vi.spyOn(executionConfidenceService, 'scoreBotWinRate').mockImplementation((botId, pid, opts) => executionConfidenceService.constructor.prototype.scoreBotWinRate.call(executionConfidenceService, botId, pid, { ...opts, loadFills: async () => [f('b1', 'buy', 1, 689.81)] }))
    const e = await executionConfidenceService.calculateExecutionConfidence({ botId: 'b' }, 'p', { price: 722.29, volume: 87055065, avgVolume: 58295275 }, { unknownAsNotApplicable: true })
    expect(e.score).toBe(75)
    expect(riskDecisionMatrix.applyDecisionMatrix({ operational: 95, exposure: 88, stress: 75, execution: e.score }, {}, 'p').action).toBe('approve')
  })
})
