import { engineClient } from '../../clients/engine.js'
import { DEFAULT_TRADABLE_SYMBOLS, currentSimSession, simulationConfig } from '../simulationService.js'
import { loadBotFills, calculateFifoAccounting } from '../botAccountingService.js'
import prisma from '../../loaders/prisma.js'

function round2(v) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

function computeSma(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null
  const slice = closes.slice(-period)
  const sum = slice.reduce((a, b) => a + b, 0)
  return round2(sum / period)
}

/** Known verified catalysts and company context for the 10 supported symbols. */
export const VERIFIED_CATALYSTS = {
  SPY: 'S&P 500 benchmark index. Reflects broader market risk sentiment, interest rate expectations, and macro liquidity.',
  QQQ: 'Nasdaq 100 tech-heavy benchmark. Driven by semiconductor demand, enterprise software capex, and treasury yields.',
  AAPL: 'Apple Inc. Consumer hardware ecosystem, Apple Intelligence rollout, services revenue growth, and China supply chain dynamics.',
  MSFT: 'Microsoft Corp. Azure cloud enterprise momentum, OpenAI commercial integration, Copilot seat expansion, and corporate software spend.',
  NVDA: 'Nvidia Corp. Leading AI accelerator infrastructure, datacenter GPU demand (Blackwell architecture), hyperscaler capex, and networking margins.',
  AMZN: 'Amazon.com Inc. AWS cloud re-acceleration, retail margin expansion through regional fulfillment, advertising revenue, and capital expenditure.',
  GOOGL: 'Alphabet Inc. Google Cloud profitability, search advertising resilience, Gemini multimodal models, and YouTube subscription growth.',
  JPM: 'JPMorgan Chase & Co. Leading US money-center bank, net interest income resilience, investment banking recovery, and consumer credit quality.',
  XOM: 'Exxon Mobil Corp. Integrated global energy producer, Permian basin production efficiency (Pioneer integration), global refining margins, and oil demand.',
  META: 'Meta Platforms Inc. Digital ad auction efficiency via Advantage+ AI, engagement on Reels, open-source Llama model deployment, and Reality Labs capex.'
}

/**
 * Assembles the point-in-time research context for all 10 symbols and portfolio state.
 * @param {object} options
 * @param {string} [options.botId]
 * @param {string} [options.session] Optional as-of date (YYYY-MM-DD); defaults to current simulator session
 * @param {object} [options.engine] Engine client
 * @param {object} [options.prismaClient] Prisma client
 */
export async function assembleAiResearchContext({
  botId = null,
  session = null,
  asOfSession: asOfSessionParam = null,
  engine = engineClient,
  prismaClient = prisma,
  symbols = DEFAULT_TRADABLE_SYMBOLS
} = {}) {
  const sim = simulationConfig()
  let asOfSession = session || asOfSessionParam
  if (!asOfSession) {
    try {
      asOfSession = await currentSimSession({ config: sim, engine })
    } catch {
      asOfSession = '2026-11-20' // fallback to latest known completed session
    }
  }

  // Lookback range for bars: 45 calendar days is ~30 trading bars
  const asOfDate = new Date(`${asOfSession}T00:00:00Z`)
  const lookbackStart = new Date(asOfDate.getTime() - 45 * 86_400_000).toISOString().slice(0, 10)

  // 1. Fetch market data & compute technical indicators for each symbol
  const symbolContexts = await Promise.all(symbols.map(async (sym) => {
    try {
      const barsRes = await engine.getDailyBars(sym, lookbackStart, asOfSession)
      const bars = Array.isArray(barsRes?.bars) ? barsRes.bars : []
      if (!bars.length) {
        return { symbol: sym, available: false, error: 'No bars returned' }
      }

      // Bar format: [date, open, high, low, close, volume]
      const closes = bars.map(b => b[4])
      const volumes = bars.map(b => b[5])
      const latestBar = bars[bars.length - 1]
      const currentPrice = round2(latestBar[4])
      const latestVolume = latestBar[5]

      const sma20 = computeSma(closes, 20)
      const sma50 = computeSma(closes, 50)
      
      const price5dAgo = closes.length >= 6 ? closes[closes.length - 6] : closes[0]
      const return5dPct = price5dAgo > 0 ? round2(((currentPrice - price5dAgo) / price5dAgo) * 100) : 0

      const price20dAgo = closes.length >= 21 ? closes[closes.length - 21] : closes[0]
      const return20dPct = price20dAgo > 0 ? round2(((currentPrice - price20dAgo) / price20dAgo) * 100) : 0

      const avgVolume20 = volumes.length >= 20 
        ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
        : Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length)

      const volumeRatio = avgVolume20 > 0 ? round2(latestVolume / avgVolume20) : 1.0

      // Regime from engine if available
      let regime = 'unknown'
      try {
        const regRes = await engine.getRegime(sym)
        if (regRes?.regime) regime = regRes.regime
      } catch {
        // regime fallback
      }

      const catalyst = VERIFIED_CATALYSTS[sym] ?? null

      return {
        symbol: sym,
        available: true,
        asOfDate: latestBar[0],
        currentPrice,
        volume: latestVolume,
        avgVolume20,
        volumeRatio,
        sma20,
        sma50,
        priceVsSma20Pct: sma20 ? round2(((currentPrice - sma20) / sma20) * 100) : null,
        return5dPct,
        return20dPct,
        regime,
        catalyst
      }
    } catch (err) {
      return { symbol: sym, available: false, error: err.message }
    }
  }))

  // 2. Fetch current simulated bot portfolio context
  let portfolioContext = {
    allocatedCapital: 10_000,
    cash: 10_000,
    positions: [],
    totalEquity: 10_000
  }

  if (botId) {
    try {
      const fills = await loadBotFills(botId, { prismaClient })
      const accounting = calculateFifoAccounting(fills)
      
      // Calculate bot cash and positions
      const heldPositions = []
      let investedCost = 0
      let unrealizedTotal = 0

      const openPositions = accounting.openPositions || accounting.positions || {}
      for (const [sym, pos] of Object.entries(openPositions)) {
        if (pos.quantity > 0) {
          const symData = symbolContexts.find(s => s.symbol === sym)
          const avgCost = pos.avgPrice ?? pos.averageCost ?? 0
          const markPrice = symData?.currentPrice ?? avgCost
          const marketValue = round2(pos.quantity * markPrice)
          const cost = round2(pos.quantity * avgCost)
          const unrealizedPnl = round2(marketValue - cost)
          const unrealizedPnlPct = cost > 0 ? round2((unrealizedPnl / cost) * 100) : 0
          
          investedCost += cost
          unrealizedTotal += unrealizedPnl

          heldPositions.push({
            symbol: sym,
            quantity: pos.quantity,
            averageCost: round2(avgCost),
            marketValue,
            unrealizedPnl,
            unrealizedPnlPct
          })
        }
      }

      // Read bot config for allocated amount
      const bot = await prismaClient.bot.findUnique({ where: { id: botId } })
      const allocatedAmount = Number(bot?.config?.allocatedAmount) || 10_000
      const availableCash = round2(Math.max(0, allocatedAmount - investedCost + (accounting.realizedPnl || 0)))
      const totalEquity = round2(availableCash + heldPositions.reduce((s, p) => s + p.marketValue, 0))

      portfolioContext = {
        allocatedCapital: allocatedAmount,
        cash: availableCash,
        positions: heldPositions,
        totalEquity,
        realizedPnl: round2(accounting.realizedPnl || 0),
        unrealizedPnl: round2(unrealizedTotal)
      }
    } catch (err) {
      // Keep default portfolio context if lookup fails
    }
  }

  return {
    asOfSession,
    symbols: symbolContexts,
    portfolio: portfolioContext
  }
}
