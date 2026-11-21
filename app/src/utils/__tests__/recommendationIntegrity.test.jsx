import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeConfidence, deriveRowPrice } from '../../features/assets/utils.js'
import { ConfidenceMeter, RiskBadge } from '../../components/ConfidenceBadge.jsx'
import RecommendationPanel from '../../features/orders/components/RecommendationPanel.jsx'

describe('recommendation integrity display', () => {
  it('does not coerce unavailable confidence into zero percent', () => {
    expect(normalizeConfidence(null)).toBeNull()
    expect(normalizeConfidence(undefined)).toBeNull()
    expect(renderToStaticMarkup(<ConfidenceMeter confidence={null} />)).toContain('Success probability unavailable')
    expect(renderToStaticMarkup(<RiskBadge risk={null} />)).toContain('Risk estimate unavailable')
  })
  it('uses reference price independently from entry guidance', () => {
    expect(deriveRowPrice({ referencePrice: 12.5, entryZone: null })).toBe(12.5)
  })
  it('keeps suppressed research useful without an actionable instruction', () => {
    const html = renderToStaticMarkup(<RecommendationPanel selectedStock={{symbol:'TST'}} bootstrapData={{recommendation:{
      action:'BUY', actionable:false, confidence:null, entryZone:null, risk:null, score:0.42,
      explanations:['Ranking input is positive.'], explanationMethodology:'deterministic_score_components'
    }}} />)
    expect(html).toContain('WATCH')
    expect(html).not.toContain('>BUY<')
    expect(html).toContain('Research only')
    expect(html).toContain('0.4200 (not a probability)')
    expect(html).toContain('Deterministic explanation')
    expect(html).not.toContain('0%')
    expect(html).not.toContain('Entry zone')
  })
})
