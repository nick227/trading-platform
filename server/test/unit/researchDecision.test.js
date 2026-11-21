/**
 * Research-driven decision policy over verified Alpha Engine traces.
 * Fixtures are produced by Alpha Engine's own build_prediction_trace (see fixtures/alpha-engine).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  evaluateResearchDecision, resolveResearchPolicy, researchDirection, isResearchDriven, RESEARCH_POLICY_DEFAULTS
} from '../../../worker/src/engine/researchDecision.js'
import { verifyResearchTrace } from '../../src/services/researchTraceService.js'

const { traces } = JSON.parse(readFileSync(new URL('../fixtures/alpha-engine/traces.json', import.meta.url), 'utf8'))
const now = new Date('2026-11-20T15:00:00Z') // 30 minutes after the fixtures were observed
const fullRun = { run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'SUCCESS' } }
const policy = { ...RESEARCH_POLICY_DEFAULTS }
const decide = (id, over = {}) => evaluateResearchDecision({ trace: traces[id], located: fullRun, policy, price: traces[id].evidence.snapshot.entryPrice, now, ...over })

describe('Alpha Engine fixtures', () => {
  it('are byte-exact Python canonical JSON that TradeLoom verifies', () => {
    for (const [id, trace] of Object.entries(traces)) {
      expect(verifyResearchTrace(trace, { predictionId: id, tenantId: 'default' })).toBe(true)
    }
    // Python keeps 540.0 and non-ASCII; JSON.stringify would not — the digest must still verify.
    expect(traces.pred_spy_buy.evidence.canonicalJson).toContain('"entryPrice":540.0')
    expect(traces.pred_spy_buy.evidence.canonicalJson).toContain('café ✓')
  })
})

describe('research decision policy', () => {
  it('accepts current, confident research and takes direction and confidence from it', () => {
    const r = decide('pred_spy_buy')
    expect(r).toMatchObject({ decision: 'accepted', reason: 'research_accepted', signal: 'buy', confidence: 0.82 })
    expect(r.context).toMatchObject({ confidenceIsProbability: false, ageHours: 0.5, driftPct: 0, predictionDirection: 'BUY', horizon: '5d' })
  })

  it('maps SELL research to a sell signal', () => {
    expect(decide('pred_iwm_sell')).toMatchObject({ decision: 'accepted', signal: 'sell', confidence: 0.9 })
  })

  it('rejects research below the bot minimum confidence', () => {
    expect(decide('pred_qqq_weak')).toMatchObject({ decision: 'rejected', reason: 'below_min_confidence' })
    expect(decide('pred_qqq_weak', { policy: { ...policy, minConfidence: 0.3 } })).toMatchObject({ decision: 'accepted' })
  })

  it('suppresses stale research', () => {
    expect(decide('pred_dia_stale')).toMatchObject({ decision: 'suppressed', reason: 'stale_prediction' })
  })

  it('rejects research observed in the future (clock skew or bad data)', () => {
    expect(decide('pred_spy_buy', { now: new Date('2026-11-20T14:00:00Z') })).toMatchObject({ decision: 'rejected', reason: 'observed_in_future' })
  })

  it('suppresses research from a non-full tier or degraded run', () => {
    expect(decide('pred_spy_buy', { located: { run: { intelligenceConfidenceTier: 'suppressed' } } })).toMatchObject({ decision: 'suppressed', reason: 'research_tier_not_full' })
    expect(decide('pred_spy_buy', { located: { run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: true } } })).toMatchObject({ decision: 'suppressed', reason: 'degraded_research_run' })
    expect(decide('pred_spy_buy', { located: { run: { intelligenceConfidenceTier: 'full', runStatus: 'FAILED' } } })).toMatchObject({ decision: 'suppressed', reason: 'degraded_research_run' })
  })

  it('rejects when the price has moved away from the research entry', () => {
    expect(decide('pred_spy_buy', { price: 540 * 1.06 })).toMatchObject({ decision: 'rejected', reason: 'entry_price_drift' })
    expect(decide('pred_spy_buy', { price: 540 * 1.04 })).toMatchObject({ decision: 'accepted' })
    expect(decide('pred_spy_buy', { price: null })).toMatchObject({ decision: 'rejected', reason: 'missing_price' })
  })

  it('honours the bot direction filter and horizon allow-list', () => {
    expect(decide('pred_iwm_sell', { configDirection: 'buy' })).toMatchObject({ decision: 'rejected', reason: 'direction_mismatch' })
    expect(decide('pred_spy_buy', { policy: { ...policy, allowedHorizons: ['15d'] } })).toMatchObject({ decision: 'rejected', reason: 'horizon_not_allowed' })
  })

  it('rejects ambiguous direction and missing entry price', () => {
    const t = structuredClone(traces.pred_spy_buy)
    t.evidence.snapshot.direction = 'HOLD'
    expect(evaluateResearchDecision({ trace: t, located: fullRun, policy, price: 540, now })).toMatchObject({ decision: 'rejected', reason: 'ambiguous_research_direction' })
    t.evidence.snapshot.direction = 'BUY'
    t.evidence.snapshot.entryPrice = null
    expect(evaluateResearchDecision({ trace: t, located: fullRun, policy, price: 540, now })).toMatchObject({ decision: 'rejected', reason: 'missing_entry_price' })
  })
})

describe('research policy configuration', () => {
  it('uses defaults and validates overrides', () => {
    expect(resolveResearchPolicy({})).toEqual({ ok: true, policy: RESEARCH_POLICY_DEFAULTS })
    expect(resolveResearchPolicy({ research: { minConfidence: 0.75, allowedHorizons: ['5D'] } }).policy).toMatchObject({ minConfidence: 0.75, allowedHorizons: ['5d'] })
    expect(resolveResearchPolicy({ research: { minConfidence: 2 } })).toEqual({ ok: false, reason: 'invalid_minConfidence' })
    expect(resolveResearchPolicy({ research: { tenantId: '../x' } })).toEqual({ ok: false, reason: 'invalid_tenant' })
    expect(resolveResearchPolicy({ research: { allowedHorizons: [] } })).toEqual({ ok: false, reason: 'invalid_allowedHorizons' })
  })
  it('identifies research-driven bots and directions', () => {
    expect(isResearchDriven({ config: { signalSource: 'alpha_research' } })).toBe(true)
    expect(isResearchDriven({ config: { direction: 'buy' } })).toBe(false)
    expect(researchDirection('UP')).toBe('buy')
    expect(researchDirection('Down')).toBe('sell')
    expect(researchDirection('neutral')).toBe(null)
  })
})

describe('Alpha Research Follower template', () => {
  it('seeds a research-driven bot with a valid, conservative policy and no fixed direction', () => {
    const templates = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))
    const t = templates.find((x) => x.id === 'tmpl_alpha_research')
    expect(t.botType).toBe('rule_based')
    expect(isResearchDriven({ config: t.config })).toBe(true)
    expect(t.config.direction).toBeUndefined()
    expect(resolveResearchPolicy(t.config)).toEqual({ ok: true, policy: { ...RESEARCH_POLICY_DEFAULTS, minConfidence: 0.6, maxPredictionAgeHours: 96, maxEntryDriftPct: 5 } })
    expect(t.rules.map((r) => r.type)).toEqual(['market_hours', 'position_limit'])
  })
})
