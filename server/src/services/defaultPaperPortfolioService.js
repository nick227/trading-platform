/**
 * Default Simulated Paper Portfolio Service.
 *
 * Guarantees every registered user receives exactly one $10,000 simulated paper
 * portfolio without requiring external brokerage credentials, enforced at the
 * MySQL level via `DefaultPaperPortfolio` (`userId` PRIMARY KEY + `portfolioId` UNIQUE).
 *
 * Uses an additive 1:1 join table rather than adding a UNIQUE index onto the
 * existing non-empty `Portfolio` table so Railway's `prisma db push --skip-generate`
 * (without `--accept-data-loss`) deploys cleanly with zero data-loss warnings.
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
 * Provisions or returns the user's unique default simulated paper portfolio inside a DB transaction.
 * Safe under concurrent calls (catches MySQL P2002 primary/unique key race and reads the winner).
 */
export async function ensureDefaultPaperPortfolio(
  userId,
  { prismaClient = prisma, startingCash = DEFAULT_PAPER_STARTING_CASH } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new Error('userId is required to provision default paper portfolio')
  const id = defaultPaperPortfolioIdForUser(uid)

  const readExisting = async (db) => {
    if (typeof db?.defaultPaperPortfolio?.findUnique === 'function') {
      const link = await db.defaultPaperPortfolio.findUnique({
        where: { userId: uid },
        include: { portfolio: true }
      })
      if (link?.portfolio) return link.portfolio
    }
    return null
  }

  const existing = await readExisting(prismaClient)
  if (existing) return existing

  const createInClient = async (db) => {
    const portfolio = await db.portfolio.upsert({
      where: { id },
      update: { accountKind: DEFAULT_PAPER_ACCOUNT_KIND },
      create: {
        id,
        userId: uid,
        accountKind: DEFAULT_PAPER_ACCOUNT_KIND,
        name: 'Simulated Paper Portfolio',
        cashBalance: startingCash,
        totalValue: startingCash
      }
    })
    if (typeof db?.defaultPaperPortfolio?.create === 'function') {
      await db.defaultPaperPortfolio.create({
        data: {
          userId: uid,
          portfolioId: portfolio.id
        }
      })
    }
    return portfolio
  }

  try {
    if (typeof prismaClient?.$transaction === 'function') {
      return await prismaClient.$transaction(async (tx) => {
        const current = await readExisting(tx)
        if (current) return current
        return createInClient(tx)
      })
    }
    return await createInClient(prismaClient)
  } catch (err) {
    if (err?.code === 'P2002') {
      const winner = await readExisting(prismaClient)
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
  if (!uid) return null
  try {
    if (typeof prismaClient?.defaultPaperPortfolio?.findUnique === 'function') {
      const link = await prismaClient.defaultPaperPortfolio.findUnique({
        where: { userId: uid },
        include: { portfolio: true }
      })
      if (link?.portfolio) return link.portfolio
    }
    if (typeof prismaClient?.portfolio?.findFirst === 'function') {
      return await prismaClient.portfolio.findFirst({
        where: { userId: uid, accountKind: DEFAULT_PAPER_ACCOUNT_KIND }
      })
    }
    return null
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
