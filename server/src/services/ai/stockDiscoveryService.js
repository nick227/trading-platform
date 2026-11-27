/**
 * Autonomous AI Stock Discovery Service.
 *
 * Expands TradeLoom beyond static predefined watchlists by scanning operating
 * companies across all major GICS sectors, computing deterministic relative-strength
 * and opportunity archetypes, and fusing verified point-in-time qualitative evidence
 * (SEC EDGAR filings + licensed financial news) with recorded AI theses.
 *
 * Strictly read-only: never places orders or mutates portfolio state.
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'
import { screenAiStockUniverse, scoreStockBars } from './stockScreener.js'
import { createProductionExternalEvidenceRegistry } from './evidence/productionEvidenceFetchers.js'
import { describeUniverseSymbol, extractDiscoverableCompanySymbols } from './stockUniverseCatalog.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID } from './strategies/aiStockTraderStrategy.js'

const DAY_MS = 86_400_000
const DISCOVERY_CACHE_TTL_MS = 60_000
const discoveryCache = new Map()

const round = (n, d = 2) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : 0

export function resetStockDiscoveryCache() {
  discoveryCache.clear()
}

/**
 * Bridges the narrow live-trading getDailyBars endpoint with Alpha Engine's
 * 150+ symbol daily candles feed while enforcing strict [start..end] session bounds.
 */
export function createBroadBarsEngine(engine) {
  return {
    async getDailyBars(symbol, start, end) {
      if (typeof engine?.getDailyBars === 'function') {
        try {
          const direct = await engine.getDailyBars(symbol, start, end)
          if (Array.isArray(direct?.bars) && direct.bars.length > 0) return direct
        } catch {
          // Fall through to broader research candles endpoint for beyond-watchlist companies
        }
      }
      if (typeof engine?.getCandles === 'function') {
        const res = await engine.getCandles(symbol, '1Y', '1D')
        const candles = Array.isArray(res?.candles) ? res.candles : []
        const byDate = new Map()
        for (const c of candles) {
          const date = typeof c?.t === 'string' ? c.t.slice(0, 10) : ''
          if (!date || date < start || date > end) continue
          const open = Number(c.o)
          const close = Number(c.c)
          const rawHigh = Number(c.h)
          const rawLow = Number(c.l)
          const volume = Number(c.v ?? 0)
          if (![open, close, rawHigh, rawLow, volume].every(Number.isFinite) || open <= 0 || close <= 0) continue
          const high = Math.max(rawHigh, open, close)
          const low = Math.min(rawLow, open, close)
          if (low <= 0) continue
          byDate.set(date, [date, open, high, low, close, Math.max(0, volume)])
        }
        return {
          bars: [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]))
        }
      }
      return { bars: [] }
    }
  }
}

export const OPPORTUNITY_THEMES = Object.freeze({
  momentum_leader: {
    id: 'momentum_leader',
    label: 'Momentum Leader',
    summary: 'Outperforming market benchmark across 5-day and 20-day windows above rising 20d/50d moving averages.'
  },
  volume_breakout: {
    id: 'volume_breakout',
    label: 'Volume Accumulation',
    summary: 'Unusual institutional volume participation paired with constructive price action.'
  },
  emerging_turnaround: {
    id: 'emerging_turnaround',
    label: 'Emerging Inflection',
    summary: 'Near-term 5-day trend acceleration reclaiming the 20-day moving average.'
  },
  steady_compounder: {
    id: 'steady_compounder',
    label: 'Steady Compounder',
    summary: 'Sustained trend above both 20-day and 50-day moving averages with positive relative strength.'
  },
  pullback_watch: {
    id: 'pullback_watch',
    label: 'Pullback in Uptrend',
    summary: 'Longer-term 50-day uptrend intact while consolidating over the past 5 sessions.'
  }
})

export function classifyOpportunityTheme(indicators, spyReturn20dPct = 0) {
  const r5 = Number(indicators?.return5dPct ?? 0)
  const r20 = Number(indicators?.return20dPct ?? 0)
  const ex20 = Number(indicators?.excess20Pct ?? 0)
  const ex50 = Number(indicators?.excess50Pct ?? 0)
  const volRatio = Number(indicators?.volumeRatio ?? 1)
  const rs20 = r20 - spyReturn20dPct

  if (volRatio >= 1.25 && r5 > 0 && ex20 >= 0) return 'volume_breakout'
  if (r20 >= 4 && r5 >= 1 && ex20 > 0 && ex50 > 0 && rs20 > 0) return 'momentum_leader'
  if (r5 >= 1.5 && ex20 > 0 && ex50 <= 2) return 'emerging_turnaround'
  if (ex50 > 1.5 && r5 < 0) return 'pullback_watch'
  return 'steady_compounder'
}

function buildDiscoveryExplanation({ meta, indicators, rs20dPct, theme, qualitativeItems, aiDecision }) {
  const reasons = []
  const risks = []

  if (!meta.isDefaultWatchlist) {
    reasons.push(`Surfaced autonomously outside the 10-stock default watchlist in ${meta.sector} (${meta.industry}).`)
  } else {
    reasons.push(`Core liquid leader in ${meta.sector} (${meta.industry}).`)
  }

  const rsText = rs20dPct >= 0
    ? `outperforming SPY by +${round(rs20dPct, 2)}% over 20 sessions`
    : `lagging SPY by ${round(rs20dPct, 2)}% over 20 sessions`
  reasons.push(`20-day return of ${indicators.return20dPct >= 0 ? '+' : ''}${round(indicators.return20dPct, 2)}% (${rsText}) with 5-day move of ${indicators.return5dPct >= 0 ? '+' : ''}${round(indicators.return5dPct, 2)}%.`)

  if (indicators.volumeRatio >= 1.2) {
    reasons.push(`Session volume ran ${round(indicators.volumeRatio, 2)}x its 20-day average ($${round(indicators.averageDollarVolume / 1_000_000, 1)}M avg daily dollar liquidity).`)
  } else if (indicators.excess20Pct > 0 && indicators.excess50Pct > 0) {
    reasons.push(`Trading +${round(indicators.excess20Pct, 2)}% above SMA20 and +${round(indicators.excess50Pct, 2)}% above SMA50.`)
  }

  for (const ev of qualitativeItems.slice(0, 2)) {
    if (ev.sourceId === 'filings') {
      reasons.push(`Verified SEC ${ev.filingType || 'filing'} (${ev.publishedAt.slice(0, 10)}): ${ev.summary}`)
    } else if (ev.sourceId === 'news') {
      reasons.push(`Reported catalyst (${ev.publishedAt.slice(0, 10)}): ${ev.title}`)
    }
  }

  if (aiDecision?.thesis) {
    reasons.push(`Latest AI research (${aiDecision.action}): ${aiDecision.thesis}`)
  }

  if (indicators.excess20Pct > 8) {
    risks.push(`Extended +${round(indicators.excess20Pct, 1)}% above 20-day average; vulnerable to mean-reversion pullbacks.`)
  }
  if (qualitativeItems.length === 0) {
    risks.push('Quantitative strength currently lacks a fresh point-in-time SEC filing or news catalyst in the window.')
  }
  if (theme === 'pullback_watch') {
    risks.push('Near-term 5-day momentum is negative; confirm support holds above the 50-day moving average.')
  }
  if (aiDecision?.risks?.length) {
    risks.push(...aiDecision.risks.slice(0, 2))
  }
  if (!risks.length) {
    risks.push('Monitor sector rotation and upcoming earnings/8-K disclosures before sizing a paper position.')
  }

  return { reasons: reasons.slice(0, 5), risks: risks.slice(0, 3) }
}

/**
 * Selects a sector-diversified set of top discovery candidates so one sector
 * cannot monopolize the entire opportunity feed.
 */
export function selectSectorDiversifiedCandidates(rankedItems, { maxCandidates = 24, maxPerSectorInitial = 3 } = {}) {
  const selected = []
  const pickedSymbols = new Set()
  const sectorCounts = new Map()

  for (const item of rankedItems) {
    if (selected.length >= maxCandidates) break
    const count = sectorCounts.get(item.sector) || 0
    if (count >= maxPerSectorInitial) continue
    selected.push(item)
    pickedSymbols.add(item.symbol)
    sectorCounts.set(item.sector, count + 1)
  }

  for (const item of rankedItems) {
    if (selected.length >= maxCandidates) break
    if (pickedSymbols.has(item.symbol)) continue
    selected.push(item)
    pickedSymbols.add(item.symbol)
  }

  return selected
}

async function resolveCompletedDiscoverySession(barsEngine, now = new Date(), explicitSession = null) {
  const expected = explicitSession || getExpectedCompletedExchangeSession(now)
  const start = new Date(Date.parse(expected + 'T00:00:00Z') - 14 * DAY_MS).toISOString().slice(0, 10)
  try {
    const spy = await barsEngine.getDailyBars('SPY', start, expected)
    const latestBarSession = spy?.bars?.at(-1)?.[0]
    if (typeof latestBarSession === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(latestBarSession)) {
      return latestBarSession
    }
  } catch {
    // Fallback to calendar session
  }
  return expected
}

function mapEvidenceBySymbol(records = [], candidateSymbols = []) {
  const bySymbol = new Map(candidateSymbols.map(s => [s, []]))
  for (const rec of records) {
    if (rec.sourceId === 'filings') {
      const issuer = rec.content?.data?.issuer
      if (issuer && bySymbol.has(issuer)) {
        bySymbol.get(issuer).push({
          id: rec.id,
          sourceId: 'filings',
          quality: rec.quality,
          filingType: rec.content?.data?.filingType || 'SEC',
          title: rec.title,
          summary: rec.content?.text || rec.title,
          url: rec.url,
          publishedAt: rec.publishedAt
        })
      }
    } else if (rec.sourceId === 'news') {
      const textUpper = `${rec.title} ${ typeof rec.content === 'string' ? rec.content : '' }`.toUpperCase()
      for (const sym of candidateSymbols) {
        const meta = describeUniverseSymbol(sym)
        const companyToken = meta.name.split(/\s+/)[0]?.toUpperCase()
        if (textUpper.includes(sym) || (companyToken && companyToken.length >= 4 && textUpper.includes(companyToken))) {
          bySymbol.get(sym).push({
            id: rec.id,
            sourceId: 'news',
            quality: rec.quality,
            title: rec.title,
            summary: typeof rec.content === 'string' ? rec.content : rec.title,
            url: rec.url,
            publishedAt: rec.publishedAt
          })
        }
      }
    }
  }
  return bySymbol
}

export async function discoverAutonomousOpportunities({
  engine = engineClient,
  prismaClient = prisma,
  evidenceRegistry = null,
  session = null,
  sector = null,
  theme = null,
  beyondWatchlistOnly = false,
  limit = 20,
  now = new Date(),
  useCache = true
} = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
  const barsEngine = createBroadBarsEngine(engine)
  const asOfSession = await resolveCompletedDiscoverySession(barsEngine, now, session)
  const cacheKey = `disc:${asOfSession}`

  let baseSnapshot = useCache ? discoveryCache.get(cacheKey) : null
  if (!baseSnapshot || (Date.now() - baseSnapshot.cachedAt) > DISCOVERY_CACHE_TTL_MS) {
    // 1. Dynamically discover tradable operating companies from market engine + catalog
    let rawEngineTickers = []
    if (typeof engine?.getTickers === 'function') {
      try {
        const res = await engine.getTickers()
        rawEngineTickers = Array.isArray(res) ? res : (Array.isArray(res?.tickers) ? res.tickers : [])
      } catch {
        rawEngineTickers = []
      }
    }
    const companySymbols = extractDiscoverableCompanySymbols(rawEngineTickers).slice(0, 250)

    // 2. Compute SPY benchmark regime as-of exact session
    let benchmark = {
      symbol: 'SPY',
      regime: 'unknown',
      return5dPct: 0,
      return20dPct: 0,
      excess20Pct: 0,
      excess50Pct: 0
    }
    try {
      const lookbackStart = new Date(Date.parse(asOfSession + 'T00:00:00Z') - 150 * DAY_MS).toISOString().slice(0, 10)
      const spyBars = await barsEngine.getDailyBars('SPY', lookbackStart, asOfSession)
      const spyScored = scoreStockBars('SPY', spyBars?.bars || [], asOfSession)
      if (spyScored.eligible) {
        const ind = spyScored.indicators
        const regime = ind.excess20Pct > 0 && ind.excess50Pct > 0
          ? 'constructive'
          : ind.excess50Pct < 0
            ? 'defensive'
            : 'consolidating'
        benchmark = {
          symbol: 'SPY',
          price: ind.price,
          regime,
          return5dPct: ind.return5dPct,
          return20dPct: ind.return20dPct,
          excess20Pct: ind.excess20Pct,
          excess50Pct: ind.excess50Pct
        }
      }
    } catch {
      // Keep neutral benchmark fallback
    }

    // 3. Deterministically screen broad company universe across sectors
    const screening = await screenAiStockUniverse({
      engine: barsEngine,
      session: asOfSession,
      symbols: companySymbols,
      shortlistLimit: Math.min(100, companySymbols.length),
      maxConcurrent: 16
    })

    // 4. Enrich all eligible companies with sector metadata & opportunity themes
    const prelimRanked = screening.shortlist
      .filter(item => item.eligible)
      .map(item => {
        const meta = describeUniverseSymbol(item.symbol)
        const rs20dPct = round(item.indicators.return20dPct - benchmark.return20dPct, 2)
        const opportunityTheme = classifyOpportunityTheme(item.indicators, benchmark.return20dPct)
        return {
          symbol: item.symbol,
          name: meta.name,
          sector: meta.sector,
          industry: meta.industry,
          beyondWatchlist: !meta.isDefaultWatchlist,
          quantScore: item.score,
          rs20dPct,
          theme: opportunityTheme,
          themeLabel: OPPORTUNITY_THEMES[opportunityTheme]?.label || opportunityTheme,
          indicators: item.indicators,
          meta
        }
      })

    // 5. Sector breadth & leadership aggregation
    const sectorMap = new Map()
    for (const row of prelimRanked) {
      if (!sectorMap.has(row.sector)) {
        sectorMap.set(row.sector, {
          sector: row.sector,
          eligibleCount: 0,
          beyondWatchlistCount: 0,
          advancing20dCount: 0,
          scoreTotal: 0,
          return20dTotal: 0,
          leaderSymbol: row.symbol,
          leaderScore: row.quantScore
        })
      }
      const bucket = sectorMap.get(row.sector)
      bucket.eligibleCount += 1
      if (row.beyondWatchlist) bucket.beyondWatchlistCount += 1
      if (row.indicators.return20dPct > 0) bucket.advancing20dCount += 1
      bucket.scoreTotal += row.quantScore
      bucket.return20dTotal += row.indicators.return20dPct
      if (row.quantScore > bucket.leaderScore) {
        bucket.leaderScore = row.quantScore
        bucket.leaderSymbol = row.symbol
      }
    }

    const sectors = [...sectorMap.values()]
      .map(b => ({
        sector: b.sector,
        eligibleCount: b.eligibleCount,
        beyondWatchlistCount: b.beyondWatchlistCount,
        breadthPct: round((b.advancing20dCount / b.eligibleCount) * 100, 1),
        avgScore: round(b.scoreTotal / b.eligibleCount, 2),
        avgReturn20dPct: round(b.return20dTotal / b.eligibleCount, 2),
        leaderSymbol: b.leaderSymbol
      }))
      .sort((a, b) => b.avgScore - a.avgScore || b.eligibleCount - a.eligibleCount)

    // 6. Select sector-diversified shortlist for qualitative evidence & AI cross-referencing
    const diversifiedPool = selectSectorDiversifiedCandidates(prelimRanked, {
      maxCandidates: 30,
      maxPerSectorInitial: 4
    })

    // 7. Fetch point-in-time qualitative evidence (SEC filings + news) for diversified pool
    const activeRegistry = evidenceRegistry || createProductionExternalEvidenceRegistry()
    let evidenceSnapshot = { records: [], unavailable: [] }
    try {
      evidenceSnapshot = await activeRegistry.assemble({
        sourceIds: ['news', 'filings'],
        asOfSession,
        maxItems: 40,
        input: {
          screening: {
            shortlist: diversifiedPool.slice(0, 20).map(c => ({ symbol: c.symbol }))
          }
        }
      })
    } catch {
      evidenceSnapshot = { records: [], unavailable: [] }
    }
    const evidenceBySymbol = mapEvidenceBySymbol(
      evidenceSnapshot.records || [],
      diversifiedPool.map(c => c.symbol)
    )

    // 8. Load recent recorded AI decisions for transparent thesis attribution
    const latestAiBySymbol = new Map()
    if (prismaClient?.botEvent?.findMany) {
      try {
        const events = await prismaClient.botEvent.findMany({
          where: { botId: AI_STOCK_TRADER_PLATFORM_BOT_ID, type: 'decision_made' },
          orderBy: { createdAt: 'desc' },
          take: 15
        })
        for (const ev of events) {
          const decs = ev.metadata?.decision?.decisions
          if (ev.metadata?.status !== 'completed' || !Array.isArray(decs)) continue
          for (const d of decs) {
            if (d?.symbol && !latestAiBySymbol.has(d.symbol)) {
              latestAiBySymbol.set(d.symbol, {
                asOfSession: ev.metadata.decision.asOfSession,
                action: d.action,
                confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : null,
                thesis: d.thesis || null,
                risks: Array.isArray(d.risks) ? d.risks : []
              })
            }
          }
        }
      } catch {
        // Non-fatal if DB unavailable in unit contexts
      }
    }

    // 9. Combine deterministic score + transparent qualitative catalyst indicator
    const enrichedPool = diversifiedPool.map(row => {
      const qualitativeItems = evidenceBySymbol.get(row.symbol) || []
      const aiDecision = latestAiBySymbol.get(row.symbol) || null
      const verifiedFilingsCount = qualitativeItems.filter(i => i.sourceId === 'filings').length
      const reportedNewsCount = qualitativeItems.filter(i => i.sourceId === 'news').length
      // Bounded catalyst bonus: rewards verified point-in-time disclosures without overriding weak technicals
      const qualitativeBonus = round(Math.min(8, verifiedFilingsCount * 2.5 + reportedNewsCount * 1.5), 2)
      const discoveryScore = round(row.quantScore + qualitativeBonus, 2)
      const { reasons, risks } = buildDiscoveryExplanation({
        meta: row.meta,
        indicators: row.indicators,
        rs20dPct: row.rs20dPct,
        theme: row.theme,
        qualitativeItems,
        aiDecision
      })

      return {
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        industry: row.industry,
        beyondWatchlist: row.beyondWatchlist,
        theme: row.theme,
        themeLabel: row.themeLabel,
        discoveryScore,
        quantScore: row.quantScore,
        qualitativeBonus,
        rs20dPct: row.rs20dPct,
        indicators: row.indicators,
        qualitativeEvidence: qualitativeItems.slice(0, 4),
        evidenceCounts: {
          filings: verifiedFilingsCount,
          news: reportedNewsCount,
          total: qualitativeItems.length
        },
        latestAiDecision: aiDecision,
        whyItMatters: reasons,
        risksToWatch: risks
      }
    }).sort((a, b) => b.discoveryScore - a.discoveryScore || b.quantScore - a.quantScore || a.symbol.localeCompare(b.symbol))

    baseSnapshot = {
      cachedAt: Date.now(),
      payload: {
        asOfSession,
        methodology: 'autonomous-cross-sector-discovery-v1',
        universeScanned: screening.universeSize,
        eligibleCompaniesCount: screening.eligibleCount,
        beyondWatchlistCount: prelimRanked.filter(r => r.beyondWatchlist).length,
        sectorsCount: sectors.length,
        benchmark,
        sectors,
        themes: Object.values(OPPORTUNITY_THEMES),
        allCandidates: enrichedPool
      }
    }
    if (useCache) discoveryCache.set(cacheKey, baseSnapshot)
  }

  const full = baseSnapshot.payload
  let filtered = full.allCandidates
  if (sector && sector !== 'all') {
    filtered = filtered.filter(c => c.sector.toLowerCase() === String(sector).trim().toLowerCase())
  }
  if (theme && theme !== 'all') {
    filtered = filtered.filter(c => c.theme === String(theme).trim())
  }
  if (beyondWatchlistOnly) {
    filtered = filtered.filter(c => c.beyondWatchlist)
  }

  return {
    asOfSession: full.asOfSession,
    methodology: full.methodology,
    simulatedOnly: true,
    universeScanned: full.universeScanned,
    eligibleCompaniesCount: full.eligibleCompaniesCount,
    beyondWatchlistCount: full.beyondWatchlistCount,
    sectorsCount: full.sectorsCount,
    benchmark: full.benchmark,
    sectors: full.sectors,
    themes: full.themes,
    discoveries: filtered.slice(0, safeLimit)
  }
}
