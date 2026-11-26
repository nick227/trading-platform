import { describe, expect, it } from 'vitest'
import {
  runAiBotEvaluation, makePassiveBenchmark, validateAiEvaluationDataset,
  buildRecordedAiEvaluationArm
} from '../../src/services/ai/aiBotEvaluationLab.js'

const sessions = [
  { date: '2026-11-20', prices: { AAPL: { open: 100, close: 100 }, SPY: { open: 400, close: 400 } }, regime: 'neutral' },
  { date: '2026-11-23', prices: { AAPL: { open: 110, close: 110 }, SPY: { open: 405, close: 405 } }, regime: 'trend' },
  { date: '2026-11-24', prices: { AAPL: { open: 90, close: 90 }, SPY: { open: 410, close: 410 } }, regime: 'volatile' },
  { date: '2026-11-25', prices: { AAPL: { open: 95, close: 95 }, SPY: { open: 420, close: 420 } }, regime: 'trend' }
]

const signal = (session, action, type = 'ai') => ({
  session, evidenceAsOf: session,
  symbol: 'AAPL', action,
  ...(action === 'BUY' ? { targetAllocationPct: 0.2 } : {}),
  ...(type === 'ai' ? {
    researchEventId: 'research-' + session,
    snapshotFingerprint: 'verified-snapshot-' + session
  } : {})
})

const makeArms = () => [
  makePassiveBenchmark(sessions),
  { id: 'technical_baseline', type: 'deterministic',
    signals: [signal('2026-11-20','BUY','deterministic'), signal('2026-11-23','SELL','deterministic')] },
  { id: 'vanilla_ai', type: 'ai',
    signals: [signal('2026-11-20','BUY'), signal('2026-11-23','SELL')] },
  { id: 'expanded_ai', type: 'ai', signals: [] }
]

describe('MR 17 point-in-time AI evaluation laboratory', () => {
  it('fills decisions next session at open and compares identical strategy arms fairly', () => {
    const report = runAiBotEvaluation({
      sessions, arms: makeArms(), initialCapital: 10000, feePerOrder: 1, slippageBps: 0
    })
    const technical = report.evaluatedArms.find(a => a.id === 'technical_baseline')
    const vanilla = report.evaluatedArms.find(a => a.id === 'vanilla_ai')
    expect(vanilla.fills).toHaveLength(2)
    expect(vanilla.fills[0]).toMatchObject({
      decisionSession: '2026-11-20', fillSession: '2026-11-23',
      symbol: 'AAPL', action: 'BUY', simulatedFillPrice: 110, quantity: 18
    })
    expect(vanilla.fills[1]).toMatchObject({
      decisionSession: '2026-11-23', fillSession: '2026-11-24',
      action: 'SELL', simulatedFillPrice: 90, quantity: 18
    })
    expect(vanilla.result.realizedPnl).toBe(-362)
    expect(vanilla.result.finalEquity).toBe(9638)
    expect(vanilla.result.maxDrawdownPct).toBeGreaterThan(0)
    expect(vanilla.result).toEqual(technical.result)
    expect(report.comparisons.find(r => r.armId === 'vanilla_ai').returnDifferencePctPoints).toBe(0)
    expect(report.evaluatedArms.find(a => a.id === 'expanded_ai').result.finalEquity).toBe(10000)
    expect(report.mode).toBe('research_only')
  })

  it('enforces next-open chronology and rejects future evidence or fabricated provenance-free AI signals', () => {
    const malformed = makeArms()
    malformed[2].signals[0].evidenceAsOf = '2026-11-23'
    expect(() => runAiBotEvaluation({ sessions, arms: malformed })).toThrow(/future-informed/)
    malformed[2].signals[0].evidenceAsOf = '2026-11-20'
    malformed[2].signals[0].researchEventId = ''
    expect(() => runAiBotEvaluation({ sessions, arms: malformed })).toThrow(/immutable research/)
  })

  it('rejects missing observed opening prices instead of substituting the close', () => {
    const missing = sessions.map(r => ({ ...r, prices: { ...r.prices } }))
    delete missing[1].prices.AAPL
    expect(() => runAiBotEvaluation({
      sessions: missing, arms: makeArms()
    })).toThrow(/Missing next-open fill price/)
  })

  it('uses the same fees and slippage assumptions across all research arms', () => {
    const a = runAiBotEvaluation({
      sessions, arms: makeArms(), feePerOrder: 0, slippageBps: 0
    })
    const b = runAiBotEvaluation({
      sessions, arms: makeArms(), feePerOrder: 2, slippageBps: 50
    })
    const technicalA = a.evaluatedArms.find(r => r.id === 'technical_baseline')
    const technicalB = b.evaluatedArms.find(r => r.id === 'technical_baseline')
    const vanillaB = b.evaluatedArms.find(r => r.id === 'vanilla_ai')
    expect(technicalB.result.finalEquity).toBeLessThan(technicalA.result.finalEquity)
    expect(technicalB.result.finalEquity).toBe(vanillaB.result.finalEquity)
    expect(technicalB.result.totalFees).toBe(4)
  })

  it('allows a passive reference but enforces a 20% cap for AI and deterministic stock proposals', () => {
    expect(makePassiveBenchmark(sessions).signals[0].targetAllocationPct).toBe(1)
    const invalid = makeArms()
    invalid[2].signals[0].targetAllocationPct = 0.5
    expect(() => validateAiEvaluationDataset({
      sessions, arms: invalid, initialCapital: 10000
    })).toThrow(/future-informed/)
  })

  it('keeps end-of-dataset signals pending rather than inventing next-session fills', () => {
    const arms = [{
      id: 'test_ai', type: 'ai',
      signals: [signal('2026-11-25','BUY')]
    }]
    const result = runAiBotEvaluation({ sessions, arms })
    expect(result.evaluatedArms[0].result.completedFills).toBe(0)
    expect(result.evaluatedArms[0].result.pendingSignals).toBe(1)
    expect(result.evaluatedArms[0].result.totalReturnPct).toBe(0)
  })

  it('extracts only verified recorded AI decisions created before next market open', () => {
    const event = {
      id: 'req_stock_recorded_1', botId: 'bot-1', type: 'decision_made',
      createdAt: '2026-11-20T22:00:00.000Z',
      metadata: {
        status: 'completed', fingerprint: 'b'.repeat(64),
        snapshot: {
          asOfSession: '2026-11-20', fingerprint: 'a'.repeat(64),
          context: {
            market: { asOf: '2026-11-20' },
            portfolio: { asOf: '2026-11-20' }
          }
        },
        decision: {
          asOfSession: '2026-11-20',
          actionable: [{ symbol: 'AAPL', action: 'BUY', targetAllocationPct: 0.2 }]
        }
      }
    }
    const arm = buildRecordedAiEvaluationArm({
      id: 'verified_agent', botId: 'bot-1', events: [event], sessions
    })
    expect(arm.signals[0]).toMatchObject({
      session: '2026-11-20', symbol: 'AAPL', researchEventId: event.id,
      snapshotFingerprint: 'a'.repeat(64)
    })
    const replay = runAiBotEvaluation({ sessions, arms: [arm] })
    expect(replay.evaluatedArms[0].fills[0].fillSession).toBe('2026-11-23')
    expect(() => buildRecordedAiEvaluationArm({
      id: 'bad', botId: 'other', events: [event], sessions
    })).toThrow(/foreign/)
    expect(() => buildRecordedAiEvaluationArm({
      id: 'late', botId: 'bot-1',
      events: [{ ...event, createdAt: '2026-11-23T16:00:00.000Z' }], sessions
    })).toThrow(/after its intended next opening/)
  })

  it('produces stable replay fingerprints with explicit caveats', () => {
    const a = runAiBotEvaluation({ sessions, arms: makeArms(), datasetLabel: 'test_fixture' })
    const b = runAiBotEvaluation({ sessions, arms: makeArms(), datasetLabel: 'test_fixture' })
    expect(a.datasetFingerprint).toBe(b.datasetFingerprint)
    expect(a.limitations.some(s => s.includes('Out-of-sample'))).toBe(true)
    expect(a.comparisons.every(r => r.interpretation.includes('not_predictive_validation'))).toBe(true)
  })
})
