/**
 * Build a fresh point-in-time portfolio snapshot from actual simulated fills.
 * Never substitute an imaginary empty $10k portfolio on accounting failure.
 */
import prisma from '../../loaders/prisma.js'
import { loadBotFills, calculateFifoAccounting } from '../botAccountingService.js'

export async function loadStockTraderPaperPortfolio({
  bot,
  screening,
  prismaClient = prisma,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting
}) {
  if (!bot?.id || !screening?.asOfSession) throw new Error('Bot and screening are required')
  const capital = Number(bot.config?.allocatedAmount)
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('Invalid paper capital allocation')
  const fills = await fillLoader(bot.id, { prismaClient })
  if (!Array.isArray(fills)) throw new Error('Paper fills unavailable')

  const accounting = accountant(fills)
  const realizedPnl = accounting?.performance?.realizedPnl ?? (accounting?.hasFills === false ? 0 : undefined)
  if (!accounting || !Number.isFinite(Number(realizedPnl)) || realizedPnl === undefined) {
    throw new Error('Paper accounting unavailable')
  }
  const positionsBySymbol = accounting.openPositions || accounting.positions || {}
  const quotes = new Map(screening.shortlist.map(row => [row.symbol, row]))
  const positions = []
  let investedCost = 0

  for (const [symbol, position] of Object.entries(positionsBySymbol)) {
    const quantity = Number(position.quantity)
    if (!(quantity > 0)) continue
    const averageCost = Number(position.avgPrice ?? position.averageCost)
    const currentPrice = Number(quotes.get(symbol)?.indicators?.price)
    if (!Number.isFinite(averageCost) || averageCost <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error(`Missing valid paper position mark: ${symbol}`)
    }
    const cost = quantity * averageCost
    investedCost += cost
    positions.push({
      symbol, quantity, averageCost, marketValue: Number((quantity * currentPrice).toFixed(2)),
      unrealizedPnl: Number((quantity * (currentPrice - averageCost)).toFixed(2))
    })
  }

  positions.sort((a, b) => a.symbol.localeCompare(b.symbol))
  const cash = Number((capital - investedCost + Number(realizedPnl)).toFixed(2))
  if (!Number.isFinite(cash) || cash < -0.01) throw new Error('Paper cash reconciliation failed')
  return {
    asOfSession: screening.asOfSession,
    allocatedCapital: capital,
    cash: Math.max(0, cash),
    totalEquity: Number((Math.max(0, cash) + positions.reduce((sum, p) => sum + p.marketValue, 0)).toFixed(2)),
    realizedPnl: Number(realizedPnl),
    positions
  }
}
