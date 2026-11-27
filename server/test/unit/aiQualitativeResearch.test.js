import { describe, it, expect, vi } from 'vitest'
import { fetchNewsEvidence } from '../../src/services/ai/evidence/newsEvidenceFetcher.js'
import { fetchSecFilingsEvidence } from '../../src/services/ai/evidence/secFilingsEvidenceFetcher.js'
import { createProductionExternalEvidenceRegistry } from '../../src/services/ai/evidence/productionEvidenceFetchers.js'
import { VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION } from '../../src/services/ai/botDefinitions.js'
import { createDefaultStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { createDefaultAiResearchTools } from '../../src/services/ai/researchToolGateway.js'
import { runToolGuidedStockResearch } from '../../src/services/ai/stockTraderReasoningAgent.js'

describe('MR 20 — Genuine Qualitative Research', () => {
  describe('News Evidence Fetcher', () => {
    it('enforces strict point-in-time cutoff and filters future news articles', async () => {
      const mockClient = {
        getNews: vi.fn(async () => [
          {
            id: 'news_valid_1',
            headline: 'Apple reports solid enterprise demand',
            url: 'https://news.provider.com/aapl-demand',
            publishedAt: '2026-11-20T14:00:00Z',
            summary: 'Apple customer orders accelerated in November.',
            symbols: ['AAPL']
          },
          {
            id: 'news_future_leak',
            headline: 'Future leak article after cutoff',
            url: 'https://news.provider.com/future-leak',
            publishedAt: '2026-11-20T17:00:00Z', // After 16:30 cutoff!
            summary: 'Leaked earnings data.',
            symbols: ['AAPL']
          },
          {
            id: 'news_next_day_leak',
            headline: 'Tomorrow article',
            url: 'https://news.provider.com/next-day',
            publishedAt: '2026-11-21T09:00:00Z', // Next day!
            summary: 'Saturday morning summary.',
            symbols: ['AAPL']
          }
        ])
      }

      const rows = await fetchNewsEvidence({
        symbols: ['AAPL'],
        asOfSession: '2026-11-20',
        retrievedCutoff: '2026-11-20T16:30:00.000Z',
        client: mockClient
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('news_valid_1')
      expect(rows[0].title).toBe('Apple reports solid enterprise demand')
      expect(rows[0].publishedAt).toBe('2026-11-20T14:00:00.000Z')
      expect(rows[0].availableAt).toBe('2026-11-20T14:00:00.000Z')
    })

    it('fails gracefully and returns empty array when credentials or client fail', async () => {
      const rows = await fetchNewsEvidence({
        symbols: ['AAPL'],
        asOfSession: '2026-11-20',
        retrievedCutoff: '2026-11-20T16:30:00.000Z',
        env: {} // No API keys
      })
      expect(rows).toEqual([])
    })
  })

  describe('SEC Filings Evidence Fetcher', () => {
    it('retrieves official SEC filings with verified source and sec.gov URLs', async () => {
      const mockSecClient = {
        getFilings: vi.fn(async () => [
          {
            id: 'sec_0000320193-26-000100',
            title: 'AAPL Form 10-K Filing (2026-10-31)',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000100/aapl-20260926.htm',
            publishedAt: '2026-10-31T21:00:00Z',
            filingType: '10-K',
            accession: '0000320193-26-000100',
            issuer: 'AAPL',
            summary: 'Annual report for fiscal year ended September 26, 2026',
            verifiedSource: true
          },
          {
            id: 'sec_future_leak',
            title: 'AAPL Form 8-K Filing (2026-11-25)',
            url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000105/aapl-20261125.htm',
            publishedAt: '2026-11-25T18:00:00Z',
            filingType: '8-K',
            accession: '0000320193-26-000105',
            issuer: 'AAPL',
            summary: 'Future unscheduled event',
            verifiedSource: true
          }
        ])
      }

      const filings = await fetchSecFilingsEvidence({
        symbols: ['AAPL'],
        asOfSession: '2026-11-20',
        retrievedCutoff: '2026-11-20T16:30:00.000Z',
        client: mockSecClient
      })

      expect(filings).toHaveLength(1)
      expect(filings[0].id).toBe('sec_0000320193-26-000100')
      expect(filings[0].filingType).toBe('10-K')
      expect(filings[0].verifiedSource).toBe(true)
      expect(filings[0].url).toContain('sec.gov')
    })
  })

  describe('End-to-End Qualitative Evidence Assembly & Tool Inquiry', () => {
    it('assembles news and filings into research snapshot and executes get_research_evidence tool', async () => {
      expect(VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION.evidenceSources).toEqual(['news', 'filings'])
      expect(VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION.researchTools).toContain('get_research_evidence')

      const mockNewsFetcher = vi.fn(async () => [
        {
          id: 'article_101',
          title: 'Nvidia expands enterprise cloud clusters',
          url: 'https://news.provider.com/nvda-cloud',
          publishedAt: '2026-11-20T11:00:00Z',
          availableAt: '2026-11-20T11:00:00Z',
          retrievedAt: '2026-11-20T16:00:00Z',
          excerpt: 'Nvidia announced new compute agreements across major datacenter providers.'
        }
      ])

      const mockFilingsFetcher = vi.fn(async () => [
        {
          id: 'filing_nvda_10q',
          title: 'NVDA Form 10-Q Filing (2026-11-15)',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/nvda-10q.htm',
          publishedAt: '2026-11-15T21:00:00Z',
          availableAt: '2026-11-15T21:00:00Z',
          retrievedAt: '2026-11-20T16:00:00Z',
          filingType: '10-Q',
          accession: '0001045810-26-000090',
          issuer: 'NVDA',
          summary: 'Quarterly report shows revenue growth in data center segment.',
          verifiedSource: true
        }
      ])

      const evidenceRegistry = createProductionExternalEvidenceRegistry({
        news: mockNewsFetcher,
        filings: mockFilingsFetcher
      })

      const contextRegistry = createDefaultStockTraderContextRegistry()
      const snapshot = await contextRegistry.assemble({
        session: '2026-11-20',
        input: {
          screening: {
            asOfSession: '2026-11-20',
            shortlist: [
              { symbol: 'NVDA', eligible: true, inUniverse: true, indicators: { price: 140.00 } }
            ]
          },
          portfolio: {
            asOfSession: '2026-11-20',
            cash: 10000,
            totalEquity: 10000,
            positions: []
          },
          config: {
            strategyVersion: '2.0.0',
            objective: 'balanced_growth',
            execution: {
              maxPositionPct: 0.20,
              maxOrderNotional: 2000,
              maxOrdersPerCycle: 2
            }
          }
        },
        modules: ['market', 'portfolio', 'objectives', 'risk'],
        evidenceRegistry,
        evidenceSourceIds: VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION.evidenceSources,
        retrievedCutoff: '2026-11-20T16:30:00.000Z',
        maxBytes: 48000
      })

      expect(snapshot.evidence).toBeTruthy()
      expect(snapshot.evidence.records.length).toBe(2)
      const newsRecord = snapshot.evidence.records.find(r => r.sourceId === 'news')
      const filingRecord = snapshot.evidence.records.find(r => r.sourceId === 'filings')
      expect(newsRecord).toBeTruthy()
      expect(newsRecord.quality).toBe('reported')
      expect(filingRecord).toBeTruthy()
      expect(filingRecord.quality).toBe('verified')

      // Now test tool-guided research execution with get_research_evidence
      const mockInvokeModel = vi.fn(async ({ phase }) => {
        if (phase === 'plan') {
          return {
            structured: {
              focus: 'Investigate recent news and SEC filings for NVDA',
              requests: [
                { toolId: 'get_research_evidence', args: { sourceId: 'news' } },
                { toolId: 'get_research_evidence', args: { sourceId: 'filings' } }
              ]
            }
          }
        }
        // Phase 2: final decision citing qualitative evidence
        return {
          structured: {
            marketSummary: 'Market supported by data center growth.',
            decisions: [
              {
                symbol: 'NVDA',
                action: 'BUY',
                confidence: 0.85,
                targetAllocationPct: 0.15,
                thesis: 'Verified 10-Q filing confirms datacenter acceleration, supported by reported cloud partner agreements.',
                evidence: [
                  'Official SEC 10-Q filing (2026-11-15) shows sustained revenue growth',
                  'Reported cloud compute agreements indicate near-term enterprise demand'
                ],
                risks: ['Customer concentration in hyperscalers'],
                exitRule: { takeProfitPct: 8.0, stopLossPct: 4.0 }
              }
            ]
          }
        }
      })

      const researchResult = await runToolGuidedStockResearch({
        snapshot,
        definition: VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION,
        invokeModel: mockInvokeModel,
        toolRegistry: createDefaultAiResearchTools()
      })

      expect(researchResult.investigation.plan.requests).toHaveLength(2)
      expect(researchResult.investigation.results).toHaveLength(2)
      expect(researchResult.investigation.results[0].status).toBe('ok')
      expect(researchResult.investigation.results[0].result.records[0].title).toBe('Nvidia expands enterprise cloud clusters')
      expect(researchResult.investigation.results[1].status).toBe('ok')
      expect(researchResult.investigation.results[1].result.records[0].title).toBe('NVDA Form 10-Q Filing (2026-11-15)')
      expect(researchResult.response.structured.decisions[0].action).toBe('BUY')
      expect(researchResult.response.structured.decisions[0].evidence).toHaveLength(2)
    })
  })
})
