/**
 * Build a point-in-time paper portfolio exclusively from settled simulated fills.
 * Missing marks, fees and inconsistent FIFO positions must fail closed.
 */
import prisma from '../../loaders/prisma.js'
import { loadBotFills, calculateFifoAccounting } from '../botAccountingService.js'
import { reconcileStockTraderFills } from './stockTraderAccounting.js'

export async function loadStockTraderPaperPortfolio({
  bot,
  screening,
  prismaClient = prisma,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting
}) {
  if (!bot?.id || !screening?.asOfSession || !Array.isArray(screening.shortlist)) {
    throw new Error('Bot and a completed screening snapshot are required')
  }
  const fills = await fillLoader(bot.id, { prismaClient })
  if (!Array.isArray(fills)) throw new Error('Paper fill history unavailable')
  const quotes = Object.fromEntries(screening.shortlist
    .filter(item => item?.indicators?.price != null)
    .map(item => [item.symbol, item.indicators.price]))
  return reconcileStockTraderFills({
    fills, asOfSession: screening.asOfSession,
    allocatedCapital: bot.config?.allocatedAmount,
    quotes, accountant
  })
}
