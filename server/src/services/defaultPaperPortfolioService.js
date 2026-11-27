/**
 * Default Simulated Paper Portfolio Service.
 *
 * Guarantees every registered user receives exactly one $10,000 simulated paper
 * portfolio without requiring external brokerage credentials, enforced at the
 * MySQL level via `Portfolio.defaultPaperUserId @unique`.
 *
 * External Alpaca brokerage accounts and custom portfolios remain strictly
 * separated (`accountKind !== 'default_simulated_paper'`).
 */
import prisma from '../loaders/prisma.js'

export const DEFAULT_PAPER_STARTING_CASH = 10_000
export const DEFAULT_PAPER_ACCOUNT_KIND = 'default_simulated_paper'
export const BROKERAGE_ACCOUNT_KIND = 'brokerage'

export function defaultPaperPortfolioIdForUser(userId) {
  const clean = String(userId ?? '').trim()
  if (!clean) throw new Error('userId is required for default paper portfolio')
  return `prt_paper_${clean}`.slice(0, 191)
}

/**
 * Idempotently provisions or returns the user's unique default simulated paper portfolio.
 * Safe under concurrent calls (handles MySQL P2002 unique race by reading the winner).
 */
export async function ensureDefaultPaperPortfolio(
  userId,
  { prismaClient = prisma, startingCash = DEFAULT_PAPER_STARTING_CASH } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new Error('userId is required to provision default paper portfolio')
  const id = defaultPaperPortfolioIdForUser(uid)

  try {
    return await prismaClient.portfolio.upsert({
      where: { defaultPaperUserId: uid },
      update: {},
      create: {
        id,
        userId: uid,
        defaultPaperUserId: uid,
        accountKind: DEFAULT_PAPER_ACCOUNT_KIND,
        name: 'Simulated Paper Portfolio',
        cashBalance: startingCash,
        totalValue: startingCash
      }
    })
  } catch (err) {
    if (err?.code === 'P2002') {
      const winner = await prismaClient.portfolio.findUnique({
        where: { defaultPaperUserId: uid }
      })
      if (winner) return winner
    }
    throw err
  }
}

/**
 * Looks up the user's default simulated paper portfolio without creating one.
 */
export async function findDefaultPaperPortfolio(userId, { prismaClient = prisma } = {}) {
  const uid = String(userId ?? '').trim()
  if (!uid || typeof prismaClient?.portfolio?.findUnique !== 'function') return null
  try {
    return await prismaClient.portfolio.findUnique({
      where: { defaultPaperUserId: uid }
    })
  } catch {
    return null
  }
}

/**
 * Resolves or creates a separate non-simulated portfolio for external brokerage syncs,
 * ensuring external Alpaca fills never commingle with the simulated paper portfolio.
 */
export async function ensureExternalBrokeragePortfolio(
  userId,
  { prismaClient = prisma, generatePortfolioId } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new Error('userId is required for brokerage portfolio')

  const existing = await prismaClient.portfolio.findFirst({
    where: {
      userId: uid,
      accountKind: { not: DEFAULT_PAPER_ACCOUNT_KIND }
    },
    orderBy: { createdAt: 'asc' }
  })
  if (existing) return existing

  const id = typeof generatePortfolioId === 'function'
    ? generatePortfolioId()
    : `prt_broker_${uid}`.slice(0, 191)

  return prismaClient.portfolio.create({
    data: {
      id,
      userId: uid,
      accountKind: BROKERAGE_ACCOUNT_KIND,
      name: 'Brokerage Portfolio',
      cashBalance: 0,
      totalValue: 0
    }
  })
}
