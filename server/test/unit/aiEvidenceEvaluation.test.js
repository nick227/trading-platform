import { describe, it, expect } from 'vitest'
import {
  runEvidenceBasedEvaluation,
  runAiBotEvaluation,
  makePassiveBenchmark
} from '../../src/services/ai/aiBotEvaluationLab.js'

describe('MR 22 — Evidence-Based Evaluation', () => {
  const sessions = [
    { date: '2026-10-01', prices: { SPY: { open: 400, close: 402 }, AAPL: { open: 150, close: 152 }, NVDA: { open: 120, close: 125 } } },
    { date: '2026-10-02', prices: { SPY: { open: 402, close: 405 }, AAPL: { open: 152, close: 155 }, NVDA: { open: 125, close: 130 } } },
    { date: '2026-10-05', prices: { SPY: { open: 405, close: 403 }, AAPL: { open: 155, close: 153 }, NVDA: { open: 130, close: 135 } } },
    { date: '2026-10-06', prices: { SPY: { open: 403, close: 408 }, AAPL: { open: 153, close: 156 }, NVDA: { open: 135, close: 140 } } },
    { date: '2026-10-07', prices: { SPY: { open: 408, close: 410 }, AAPL: { open: 156, close: 158 }, NVDA: { open: 140, close: 142 } } }
  ]

  const deterministicScreenerArm = {
    id: 'screener_momentum',
    type: 'deterministic',
    signals: [
      { session: '2026-10-01', evidenceAsOf: '2026-10-01', symbol: 'AAPL', action: 'BUY', targetAllocationPct: 0.20 }
    ]
  }

  const aiTechnicalOnlyArm = {
    id: 'ai_technical_only',
    type: 'ai',
    totalModelCostCents: 150, // $1.50 model cost
    signals: [
      {
        session: '2026-10-01',
        evidenceAsOf: '2026-10-01',
        symbol: 'AAPL',
        action: 'BUY',
        targetAllocationPct: 0.20,
        researchEventId: 'ev_tech_1',
        snapshotFingerprint: 'a'.repeat(64),
        evidence: [] // Zero qualitative evidence
      }
    ]
  }

  const aiQualitativeArm = {
    id: 'ai_qualitative',
    type: 'ai',
    totalModelCostCents: 250, // $2.50 model cost
    signals: [
      {
        session: '2026-10-01',
        evidenceAsOf: '2026-10-01',
        symbol: 'NVDA', // AI chooses NVDA over AAPL based on qualitative filings
        action: 'BUY',
        targetAllocationPct: 0.20,
        researchEventId: 'ev_qual_1',
        snapshotFingerprint: 'b'.repeat(64),
        evidence: [
          'Official Form 10-Q filing confirms datacenter acceleration',
          'Licensed financial news reports enterprise compute expansion'
        ]
      }
    ]
  }

  it('runs 4-arm comparative matrix and attributes alpha between qualitative AI and deterministic screener', () => {
    const result = runEvidenceBasedEvaluation({
      sessions,
      deterministicArm: deterministicScreenerArm,
      aiTechnicalOnlyArm,
      aiQualitativeArm,
      initialCapital: 10000,
      datasetLabel: 'q4_2026_test_window'
    })

    expect(result.evaluationType).toBe('multi_arm_evidence_evaluation')
    expect(result.armsMatrix.passive).toBeTruthy()
    expect(result.armsMatrix.deterministicScreener).toBeTruthy()
    expect(result.armsMatrix.aiTechnicalOnly).toBeTruthy()
    expect(result.armsMatrix.aiQualitative).toBeTruthy()

    // NVDA moved from 125 open to 142 close (+13.6% gain on 20% allocation = ~+2.6% portfolio return)
    // AAPL moved from 152 open to 158 close (+3.9% gain on 20% allocation = ~+0.7% portfolio return)
    expect(result.armsMatrix.aiQualitative.totalReturnPct).toBeGreaterThan(result.armsMatrix.deterministicScreener.totalReturnPct)

    // Alpha attribution
    expect(result.alphaAttribution.qualitativeVsScreenerAlphaPctPoints).toBeGreaterThan(0)
    expect(result.alphaAttribution.qualitativeVsTechnicalOnlyAlphaPctPoints).toBeGreaterThan(0)
  })

  it('deducts model provider costs and computes net return after model expenses', () => {
    const result = runEvidenceBasedEvaluation({
      sessions,
      deterministicArm: deterministicScreenerArm,
      aiTechnicalOnlyArm,
      aiQualitativeArm,
      initialCapital: 10000
    })

    const qualArm = result.evaluatedArms.find(a => a.id === 'ai_qualitative')
    expect(qualArm.result.totalModelCost).toBe(2.50)
    expect(qualArm.result.netEquityAfterModelCost).toBe(qualArm.result.finalEquity - 2.50)
    expect(result.alphaAttribution.totalModelExpenses).toBe(4.00) // 1.50 + 2.50
  })

  it('strictly separates reasoning quality from investment return metrics', () => {
    const result = runEvidenceBasedEvaluation({
      sessions,
      deterministicArm: deterministicScreenerArm,
      aiTechnicalOnlyArm,
      aiQualitativeArm,
      initialCapital: 10000
    })

    const qualArm = result.evaluatedArms.find(a => a.id === 'ai_qualitative')
    expect(qualArm.reasoningFidelity).toBeTruthy()
    expect(qualArm.reasoningFidelity.evidenceSupportedDecisionsCount).toBe(1)
    expect(qualArm.reasoningFidelity.explanationDepthScore).toBe(2)
    expect(qualArm.reasoningFidelity.fidelityNotice).toContain('Better natural language explanations or higher evidence citations do not demonstrate superior investment performance')

    const techArm = result.evaluatedArms.find(a => a.id === 'ai_technical_only')
    expect(techArm.reasoningFidelity.evidenceSupportedDecisionsCount).toBe(0)
    expect(techArm.reasoningFidelity.unsupportedDecisionsCount).toBe(1)
  })

  it('flags statistical confidence warning when sample size is insufficient', () => {
    const result = runEvidenceBasedEvaluation({
      sessions, // 5 sessions < 60
      deterministicArm: deterministicScreenerArm,
      aiTechnicalOnlyArm,
      aiQualitativeArm
    })

    expect(result.statisticalConfidence.meetsStatisticalThreshold).toBe(false)
    expect(result.statisticalConfidence.warning).toContain('Sample size is insufficient (N < 60 completed sessions or < 10 closed lots)')
  })
})
