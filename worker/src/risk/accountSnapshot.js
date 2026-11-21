/**
 * The portfolio owner's real account for portfolio-level risk checks: Alpaca's account
 * normally, the internal simulator's account in simulator mode (same broker resolution as
 * the order worker). Fails closed — never substitutes placeholder balances.
 */
import prisma from '../db/prisma.js'
import { getBrokerClient } from '../broker/clientCache.js'

const num = (v) => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null
}

export async function brokerAccountSnapshot(portfolioId, { prismaClient = prisma, getClient = getBrokerClient } = {}) {
  const portfolio = await prismaClient.portfolio.findUnique({ where: { id: portfolioId }, select: { userId: true } })
  if (!portfolio?.userId) throw new Error('portfolio_not_found')
  const broker = await getClient(portfolio.userId)
  if (!broker) throw new Error('broker_account_unavailable')
  const account = await broker.getAccount()
  const equity = num(account?.equity)
  if (equity === null || equity <= 0) throw new Error('broker_account_unavailable')
  return {
    cash: num(account?.cash),
    equity,
    buyingPower: num(account?.buying_power ?? account?.buyingPower),
    simulated: account?.simulated === true,
  }
}
