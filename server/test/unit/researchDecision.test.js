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
// Evidence requirements are tested on their own below; here they're off so each other gate
// can be exercised in isolation (pred_qqq_weak carries staging-like no-edge evidence).
const policy = { ...RESEARCH_POLICY_DEFAULTS, requireEdgeOverBaseline: false, requireOutOfSample: false }
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

describe('seeded bot templates', () => {
  // BotTemplate.id/name/description are Prisma `String` on MySQL → VARCHAR(191).
  // The API pre-deploy seed fails (P2000) if any value is longer.
  it('fit the BotTemplate column limits', () => {
    const templates = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))
    for (const t of templates) {
      for (const col of ['id', 'name', 'description', 'botType']) {
        expect(t[col].length, `${t.id}.${col}`).toBeLessThanOrEqual(191)
      }
    }
  })
})

describe('evidence requirements (edge over baseline, out of sample)', () => {
  const withEval = (edge, oos) => {
    const t = structuredClone(traces.pred_spy_buy)
    t.evidence.snapshot.ranking = { evaluation: { edgeOverBaseline: edge, genuineOutOfSample: oos } }
    return t
  }
  const strict = { ...RESEARCH_POLICY_DEFAULTS }
  const run = (trace) => evaluateResearchDecision({ trace, located: fullRun, policy: strict, price: 540, now })

  it('are both required by default and read from the verified evidence', () => {
    expect(strict).toMatchObject({ requireEdgeOverBaseline: true, requireOutOfSample: true })
    expect(run(withEval(false, false))).toMatchObject({ decision: 'rejected', reason: 'no_edge_over_baseline' })
    expect(run(withEval(true, false))).toMatchObject({ decision: 'rejected', reason: 'not_out_of_sample', context: { edgeOverBaseline: true, genuineOutOfSample: false } })
    expect(run(withEval(null, null))).toMatchObject({ decision: 'rejected', reason: 'no_edge_over_baseline' }) // missing evidence
    expect(run(withEval(true, true))).toMatchObject({ decision: 'accepted', context: { edgeOverBaseline: true, genuineOutOfSample: true } })
  })

  it('weak research like staging’s (48.4% vs 49.9%, not out of sample) is never executable', () => {
    const t = structuredClone(traces.pred_spy_buy)
    t.evidence.snapshot.ranking = structuredClone(traces.pred_qqq_weak.evidence.snapshot.ranking)
    expect(run(t)).toMatchObject({ decision: 'rejected', reason: 'no_edge_over_baseline' })
  })

  it('cannot be switched off through a bot’s configuration (beta lock)', () => {
    const resolved = resolveResearchPolicy({ research: { requireEdgeOverBaseline: false, minConfidence: 0.45 } })
    expect(resolved).toMatchObject({ ok: true, policy: { requireEdgeOverBaseline: true, requireOutOfSample: true, minConfidence: 0.45 } })
    expect(evaluateResearchDecision({ trace: withEval(false, false), located: fullRun, policy: resolved.policy, price: 540, now })).toMatchObject({ decision: 'rejected', reason: 'no_edge_over_baseline' })
    expect(resolveResearchPolicy({ research: { requireEdgeOverBaseline: 'no' } })).toEqual({ ok: false, reason: 'invalid_requireEdgeOverBaseline' })
  })
})
