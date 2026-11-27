import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  discoverAutonomousOpportunities,
  classifyOpportunityTheme,
  selectSectorDiversifiedCandidates,
  resetStockDiscoveryCache
} from '../../src/services/ai/stockDiscoveryService.js'
import { describeUniverseSymbol, extractDiscoverableCompanySymbols } from '../../src/services/ai/stockUniverseCatalog.js'
import { createProductionExternalEvidenceRegistry } from '../../src/services/ai/evidence/productionEvidenceFetchers.js'

function makeBars(endSession, { base = 100, dailyGain = 0.4, recentBoost = 0.8, volume = 1_500_000, lastVolume = 2_200_000 } = {}) {
  const dates = []
  let curr = new Date(endSession + 'T00:00:00Z')
  while (dates.length < 60) {
    const day = curr.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(curr.toISOString().slice(0, 10))
    curr = new Date(curr.getTime() - 86_400_000)
  }
  dates.reverse()
  return dates.map((d, idx) => {
    const step = idx >= 54 ? recentBoost : dailyGain
    const close = Number((base + idx * step).toFixed(2))
    const open = Number((close - 0.25).toFixed(2))
    const high = Number((close + 1.2).toFixed(2))
    const low = Number((open - 0.9).toFixed(2))
    const vol = idx === dates.length - 1 ? lastVolume : volume
    return [d, open, high, low, close, vol]
  })
}

describe('Autonomous Stock Discovery Service', () => {
  beforeEach(() => {
    resetStockDiscoveryCache()
  })

  it('excludes index and volatility ETFs while expanding across corporate sectors', () => {
    const companies = extractDiscoverableCompanySymbols(['SPY', 'UVXY', 'TLT', 'LLY', 'ETN', 'ISRG', 'ACME'])
    expect(companies).not.toContain('SPY')
    expect(companies).not.toContain('UVXY')
    expect(companies).not.toContain('TLT')
    expect(companies).toContain('LLY')
    expect(companies).toContain('ETN')
    expect(companies).toContain('ISRG')
    expect(companies).toContain('ACME')

    expect(describeUniverseSymbol('LLY')).toMatchObject({
      symbol: 'LLY',
      sector: 'Healthcare',
      isDefaultWatchlist: false
    })
    expect(describeUniverseSymbol('NVDA').isDefaultWatchlist).toBe(true)
  })

  it('classifies opportunity themes deterministically from point-in-time indicators', () => {
    expect(classifyOpportunityTheme({
      return5dPct: 3.5, return20dPct: 8.2, excess20Pct: 4.1, excess50Pct: 9.0, volumeRatio: 1.55
    }, 1.2)).toBe('volume_breakout')

    expect(classifyOpportunityTheme({
      return5dPct: 2.1, return20dPct: 9.5, excess20Pct: 3.0, excess50Pct: 7.5, volumeRatio: 1.05
    }, 2.0)).toBe('momentum_leader')

    expect(classifyOpportunityTheme({
      return5dPct: -1.8, return20dPct: 4.0, excess20Pct: -0.5, excess50Pct: 4.2, volumeRatio: 0.9
    }, 1.0)).toBe('pullback_watch')
  })

  it('enforces sector diversity before backfilling remaining slots', () => {
    const ranked = [
      { symbol: 'NVDA', sector: 'Technology' },
      { symbol: 'AMD', sector: 'Technology' },
      { symbol: 'AMAT', sector: 'Technology' },
      { symbol: 'ORCL', sector: 'Technology' },
      { symbol: 'LLY', sector: 'Healthcare' },
      { symbol: 'ETN', sector: 'Industrials' }
    ]
    const picked = selectSectorDiversifiedCandidates(ranked, { maxCandidates: 4, maxPerSectorInitial: 2 })
    expect(picked.map(p => p.symbol)).toEqual(['NVDA', 'AMD', 'LLY', 'ETN'])
  })

  it('discovers beyond-watchlist companies across sectors and attaches verified qualitative evidence', async () => {
    const session = '2026-11-25'
    const symbolSpecs = {
      SPY: { base: 500, dailyGain: 0.2, recentBoost: 0.25, lastVolume: 1_500_000 },
      LLY: { base: 780, dailyGain: 0.9, recentBoost: 1.8, lastVolume: 2_800_000 },
      ETN: { base: 310, dailyGain: 0.6, recentBoost: 1.1, lastVolume: 2_100_000 },
      ISRG: { base: 490, dailyGain: 0.7, recentBoost: 1.2, lastVolume: 1_900_000 },
      NVDA: { base: 130, dailyGain: 0.4, recentBoost: 0.6, lastVolume: 1_700_000 }
    }

    const mockEngine = {
      getTickers: vi.fn(async () => ({ tickers: ['SPY', 'UVXY', 'LLY', 'ETN', 'ISRG', 'NVDA'] })),
      getDailyBars: vi.fn(async (symbol) => {
        const spec = symbolSpecs[symbol]
        if (!spec) return { bars: [] }
        return { bars: makeBars(session, spec) }
      })
    }

    const mockEvidence = createProductionExternalEvidenceRegistry({
      news: async () => [{
        id: 'lly_news_1',
        title: 'Eli Lilly LLY expands manufacturing capacity for metabolic therapies',
        url: 'https://news.provider.com/lly-capacity',
        publishedAt: '2026-11-24T14:00:00Z',
        availableAt: '2026-11-24T14:00:00Z',
        retrievedAt: '2026-11-25T16:30:00Z',
        excerpt: 'New facility production ramp supports global supply.'
      }],
      filings: async () => [{
        id: 'sec_0000059478-26-000120',
        title: 'LLY Form 8-K Filing (2026-11-23)',
        url: 'https://www.sec.gov/Archives/edgar/data/59478/000005947826000120/lly-8k.htm',
        publishedAt: '2026-11-23T21:00:00Z',
        availableAt: '2026-11-23T21:00:00Z',
        retrievedAt: '2026-11-25T16:30:00Z',
        filingType: '8-K',
        accession: '0000059478-26-000120',
        issuer: 'LLY',
        summary: 'Results of clinical supply expansion',
        verifiedSource: true
      }]
    })

    const mockPrisma = {
      botEvent: {
        findMany: vi.fn(async () => [])
      }
    }

    const fullResult = await discoverAutonomousOpportunities({
      engine: mockEngine,
      prismaClient: mockPrisma,
      evidenceRegistry: mockEvidence,
      session,
      useCache: false
    })

    expect(fullResult.asOfSession).toBe(session)
    expect(fullResult.eligibleCompaniesCount).toBe(4) // LLY, ETN, ISRG, NVDA (SPY & UVXY excluded as ETFs)
    expect(fullResult.beyondWatchlistCount).toBe(3)
    expect(fullResult.sectors.map(s => s.sector)).toContain('Healthcare')
    expect(fullResult.sectors.map(s => s.sector)).toContain('Industrials')

    const lly = fullResult.discoveries.find(d => d.symbol === 'LLY')
    expect(lly).toBeTruthy()
    expect(lly.beyondWatchlist).toBe(true)
    expect(lly.qualitativeBonus).toBeGreaterThan(0)
    expect(lly.evidenceCounts).toEqual({ filings: 1, news: 1, total: 2 })
    expect(lly.whyItMatters.some(line => line.includes('outside the 10-stock default watchlist'))).toBe(true)
    expect(lly.whyItMatters.some(line => line.includes('Verified SEC 8-K'))).toBe(true)

    const beyondOnly = await discoverAutonomousOpportunities({
      engine: mockEngine,
      prismaClient: mockPrisma,
      evidenceRegistry: mockEvidence,
      session,
      beyondWatchlistOnly: true,
      useCache: false
    })
    expect(beyondOnly.discoveries.map(d => d.symbol)).not.toContain('NVDA')
    expect(beyondOnly.discoveries.map(d => d.symbol)).toContain('LLY')
  })
})
