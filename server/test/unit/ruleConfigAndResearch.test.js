import { describe, it, expect } from 'vitest'
import { ruleConfigError } from '../../src/utils/ruleConfig.js'
import { symbolResearch } from '../../src/routes/researchRoutes.js'

describe('rule config validation', () => {
  it('rejects an unset or zero trigger price and bad operators', () => {
    expect(ruleConfigError('price_threshold', { operator: 'above', price: 0 })).toMatch(/greater than 0/)
    expect(ruleConfigError('price_threshold', { operator: 'sideways', price: 10 })).toMatch(/above/)
    expect(ruleConfigError('price_threshold', { operator: 'above', price: 725 })).toBeNull()
  })
  it('validates limits and windows', () => {
    expect(ruleConfigError('cooldown', { windowMs: 0 })).not.toBeNull()
    expect(ruleConfigError('cooldown', { cooldownHours: 24 })).toBeNull()
    expect(ruleConfigError('position_limit', {})).not.toBeNull()
    expect(ruleConfigError('position_limit', { maxShares: 100 })).toBeNull()
    expect(ruleConfigError('daily_loss', { maxLoss: -5 })).not.toBeNull()
    expect(ruleConfigError('daily_loss', { maxLoss: 500 })).toBeNull()
    expect(ruleConfigError('time_window', { start: '09:55', end: '09:35' })).not.toBeNull()
    expect(ruleConfigError('time_window', { start: '09:35', end: '09:55' })).toBeNull()
    expect(ruleConfigError('market_hours', { allowPremarket: 'yes' })).not.toBeNull()
    expect(ruleConfigError('market_hours', {})).toBeNull()
    expect(ruleConfigError('teleport', {})).toMatch(/Unknown/)
  })
})

describe('per-symbol research (descriptive input, never advice)', () => {
  const SIM = { enabled: true, session: '2026-11-19' }
  it('returns the latest verified publication with holdout vs baseline, in replay mode for the simulator', async () => {
    let asked = null
    const engine = {
      locateResearchPrediction: async (s, t, opts) => { asked = opts; return { predictionId: 'p1', publicationId: 'pub_1', marketDate: '2026-11-19', rankedAt: 'x', run: { runStatus: 'HEALTHY' }, quality: { holdoutPrecision: 0.487, baselineRate: 0.503, edgeOverBaseline: false, genuineOutOfSample: false } } },
      getPredictionTrace: async () => ({ evidence: { snapshot: { direction: 'BUY', horizon: '5d', confidence: 0.49, strategyId: 'trend_momentum_v1' } } }),
    }
    const r = await symbolResearch('AAPL', { engine, config: SIM })
    expect(asked).toEqual({ mode: 'historical_replay', session: '2026-11-19' })
    expect(r).toMatchObject({ status: 'available', direction: 'BUY', horizon: '5d', score: 0.49, edgeOverBaseline: false, holdout: { hitRate: 0.487, baselineRate: 0.503 } })
  })
  it('distinguishes "nothing published" from "engine unavailable"', async () => {
    expect((await symbolResearch('META', { engine: { locateResearchPrediction: async () => null }, config: SIM })).status).toBe('none')
    expect((await symbolResearch('META', { engine: { locateResearchPrediction: async () => { throw new Error('down') } }, config: SIM })).status).toBe('unavailable')
  })
})
