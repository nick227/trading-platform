/**
 * Account Domain Service (P1 — Account, Portfolio, and Brokerage Identity Architecture)
 *
 * Enforces strict separation between:
 *   1. User Identity (`userId`)
 *   2. Brokerage Identity (`BrokerConnection`: `provider` + `environment` + `externalAccountId`)
 *   3. Portfolio Identity (`Portfolio`: `portfolioId` + immutable `environment` + optional `brokerConnectionId`)
 *
 * Non-negotiable invariants:
 * - A user can own multiple independent portfolios (`internal_sim` alongside `alpaca_paper`).
 * - Every bot and every execution belongs to exactly one `portfolioId`.
 * - `Portfolio.environment` and bound external brokerage account identity are immutable after creation.
 * - Rotating, replacing, or disconnecting brokerage credentials NEVER silently redirects existing
 *   portfolios or bots to a different brokerage account or environment. Disconnecting or switching
 *   external accounts transitions affected brokerage portfolios to `halted_credentials` and pauses
 *   their bots while leaving `internal_sim` portfolios and bots untouched.
 * - `alpaca_live` remains strictly disabled (`LIVE_ENVIRONMENT_DISABLED`) while live execution is off.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '../loaders/prisma.js'
import { encrypt, decrypt } from '../utils/encryption.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { DEFAULT_PAPER_ACCOUNT_KIND, BROKERAGE_ACCOUNT_KIND, DEFAULT_PAPER_STARTING_CASH } from './defaultPaperPortfolioService.js'

export const PORTFOLIO_ENVIRONMENTS = Object.freeze({
  INTERNAL_SIM: 'internal_sim',
  ALPACA_PAPER: 'alpaca_paper',
  ALPACA_LIVE: 'alpaca_live'
})

export const PORTFOLIO_STATUSES = Object.freeze({
  ACTIVE: 'active',
  HALTED_CREDENTIALS: 'halted_credentials',
  QUARANTINED_DRIFT: 'quarantined_drift',
  ARCHIVED: 'archived'
})

export class AccountDomainError extends Error {
  constructor(code, message, statusCode = 400, extra = {}) {
    super(message)
    this.name = 'AccountDomainError'
    this.code = code
    this.statusCode = statusCode
    this.extra = extra
  }
}

export function isLiveTradingEnabled(env = process.env) {
  return env?.ALLOW_LIVE_TRADING === 'true'
}

export function normalizePortfolioEnvironment(portfolio) {
  if (!portfolio) return PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM
  if (portfolio.environment && Object.values(PORTFOLIO_ENVIRONMENTS).includes(portfolio.environment)) {
    // Default paper portfolios are always internal_sim even on legacy rows created before P1
    if (portfolio.accountKind === DEFAULT_PAPER_ACCOUNT_KIND) return PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM
    return portfolio.environment
  }
  if (portfolio.accountKind === BROKERAGE_ACCOUNT_KIND) {
    return PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER
  }
  return PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM
}

function deterministicConnectionId(userId, provider, environment, externalAccountId) {
  const digest = createHash('sha256')
    .update(`${userId}:${provider}:${environment}:${externalAccountId}`)
    .digest('hex')
    .slice(0, 20)
  return `bcn_${digest}`
}

function deterministicBrokerPortfolioId(userId, connectionId) {
  const digest = createHash('sha256')
    .update(`${userId}:${connectionId}`)
    .digest('hex')
    .slice(0, 20)
  return `prt_brk_${digest}`
}

/**
 * Creates a new independent user portfolio with an immutable environment.
 */
export async function createIndependentPortfolio({
  userId,
  name,
  environment = PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM,
  brokerConnectionId = null,
  startingCash = DEFAULT_PAPER_STARTING_CASH,
  prismaClient = prisma,
  env = process.env
}) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new AccountDomainError('INVALID_USER', 'userId is required', 400)
  const cleanName = String(name ?? '').trim()
  if (!cleanName) throw new AccountDomainError('INVALID_NAME', 'Portfolio name is required', 400)

  if (!Object.values(PORTFOLIO_ENVIRONMENTS).includes(environment)) {
    throw new AccountDomainError('INVALID_ENVIRONMENT', `Unsupported portfolio environment: ${environment}`, 400)
  }

  if (environment === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE && !isLiveTradingEnabled(env)) {
    throw new AccountDomainError(
      'LIVE_ENVIRONMENT_DISABLED',
      'Live brokerage portfolios are disabled while live execution is off.',
      403
    )
  }

  if (environment === PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM) {
    if (brokerConnectionId) {
      throw new AccountDomainError(
        'SIM_PORTFOLIO_FORBIDS_BROKER_CONNECTION',
        'Internal simulated portfolios cannot bind to an external BrokerConnection.',
        400
      )
    }
    const cash = Number.isFinite(Number(startingCash)) && Number(startingCash) >= 0
      ? Number(startingCash)
      : DEFAULT_PAPER_STARTING_CASH
    return prismaClient.portfolio.create({
      data: {
        id: generateId(ID_PREFIXES.PORTFOLIO),
        userId: uid,
        name: cleanName,
        accountKind: 'simulated_custom',
        environment: PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM,
        brokerConnectionId: null,
        status: PORTFOLIO_STATUSES.ACTIVE,
        cashBalance: cash,
        totalValue: cash
      }
    })
  }

  // Brokerage-backed portfolio (`alpaca_paper` or future `alpaca_live`)
  if (!brokerConnectionId) {
    throw new AccountDomainError(
      'BROKER_CONNECTION_REQUIRED',
      'Brokerage portfolios require an explicit brokerConnectionId.',
      400
    )
  }
  const connection = await prismaClient.brokerConnection.findUnique({
    where: { id: String(brokerConnectionId) }
  })
  if (!connection || connection.userId !== uid) {
    throw new AccountDomainError('BROKER_CONNECTION_NOT_FOUND', 'BrokerConnection not found for user.', 404)
  }
  if (connection.environment !== environment) {
    throw new AccountDomainError(
      'ENVIRONMENT_MISMATCH',
      `Portfolio environment (${environment}) does not match BrokerConnection environment (${connection.environment}).`,
      409
    )
  }
  if (connection.status !== 'active') {
    throw new AccountDomainError(
      'BROKER_CONNECTION_INACTIVE',
      'Cannot create an active brokerage portfolio on a disconnected BrokerConnection.',
      409
    )
  }

  return prismaClient.portfolio.create({
    data: {
      id: generateId(ID_PREFIXES.PORTFOLIO),
      userId: uid,
      name: cleanName,
      accountKind: BROKERAGE_ACCOUNT_KIND,
      environment,
      brokerConnectionId: connection.id,
      status: PORTFOLIO_STATUSES.ACTIVE,
      cashBalance: 0,
      totalValue: 0
    }
  })
}

/**
 * Connects or rotates credentials for an external brokerage account while strictly preserving
 * account identity boundaries:
 * - Same `externalAccountId` + `environment`: rotates encrypted keys in-place and reactivates
 *   any `halted_credentials` portfolios bound to this exact connection.
 * - Different `externalAccountId`: marks previous active connections in that environment as
 *   `disconnected`, halts their portfolios + pauses their bots (NEVER redirecting bots!),
 *   and provisions a distinct `BrokerConnection` + dedicated `Portfolio` for the new account.
 */
export async function connectOrRotateBrokerAccount({
  userId,
  apiKey,
  apiSecret,
  paper = true,
  verifiedAccount = null,
  prismaClient = prisma,
  env = process.env
}) {
  const uid = String(userId ?? '').trim()
  if (!uid) throw new AccountDomainError('INVALID_USER', 'userId is required', 400)
  if (!apiKey || !apiSecret) throw new AccountDomainError('MISSING_CREDENTIALS', 'apiKey and apiSecret are required', 400)

  const environment = paper !== false
    ? PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER
    : PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE

  if (environment === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE && !isLiveTradingEnabled(env)) {
    throw new AccountDomainError(
      'LIVE_TRADING_DISABLED',
      'Live brokerage execution is disabled. Only Alpaca paper credentials may be connected.',
      403
    )
  }

  const externalAccountId = String(
    verifiedAccount?.account_number ||
    verifiedAccount?.id ||
    `alpaca_${environment}_${uid}`
  ).trim()

  const encryptedApiKey = encrypt(apiKey)
  const encryptedApiSecret = encrypt(apiSecret)
  const now = new Date()
  const connectionId = deterministicConnectionId(uid, 'alpaca', environment, externalAccountId)

  const runUpsert = async (db) => {
    let connection = null
    if (typeof db?.brokerConnection?.findFirst === 'function') {
      // Find any OTHER active connections for this user + environment (different externalAccountId)
      const existingActive = await db.brokerConnection.findMany({
        where: { userId: uid, provider: 'alpaca', environment, status: 'active' }
      })
      for (const other of existingActive) {
        if (other.externalAccountId !== externalAccountId) {
          await haltConnectionPortfoliosAndBots(db, uid, other.id, 'broker_account_switched', now)
          await db.brokerConnection.update({
            where: { id: other.id },
            data: { status: 'disconnected', disconnectedAt: now }
          })
        }
      }

      const existingSame = await db.brokerConnection.findFirst({
        where: { userId: uid, provider: 'alpaca', environment, externalAccountId }
      })
      if (existingSame) {
        connection = await db.brokerConnection.update({
          where: { id: existingSame.id },
          data: {
            encryptedApiKey,
            encryptedApiSecret,
            keyVersion: 1,
            status: 'active',
            lastVerifiedAt: now,
            disconnectedAt: null
          }
        })
      } else {
        connection = await db.brokerConnection.create({
          data: {
            id: connectionId,
            userId: uid,
            provider: 'alpaca',
            environment,
            externalAccountId,
            encryptedApiKey,
            encryptedApiSecret,
            keyVersion: 1,
            status: 'active',
            lastVerifiedAt: now
          }
        })
      }

      // Ensure a dedicated brokerage portfolio exists for THIS exact BrokerConnection
      if (typeof db?.portfolio?.findFirst === 'function') {
        const boundPortfolios = await db.portfolio.findMany({
          where: { userId: uid, brokerConnectionId: connection.id }
        })
        if (boundPortfolios.length > 0) {
          // Restore halted_credentials -> active on key rotation for the SAME external account
          // (Note: bots remain paused until explicitly resumed by the user)
          for (const p of boundPortfolios) {
            if (p.status === PORTFOLIO_STATUSES.HALTED_CREDENTIALS) {
              await db.portfolio.update({
                where: { id: p.id },
                data: { status: PORTFOLIO_STATUSES.ACTIVE }
              })
            }
          }
        } else {
          // Check if there is an unbound legacy brokerage portfolio only when no prior connection existed
          const unboundLegacy = existingActive.length === 0
            ? await db.portfolio.findFirst({
                where: {
                  userId: uid,
                  accountKind: BROKERAGE_ACCOUNT_KIND,
                  brokerConnectionId: null
                }
              })
            : null

          if (unboundLegacy) {
            await db.portfolio.update({
              where: { id: unboundLegacy.id },
              data: {
                environment,
                brokerConnectionId: connection.id,
                status: PORTFOLIO_STATUSES.ACTIVE
              }
            })
          } else {
            await db.portfolio.create({
              data: {
                id: deterministicBrokerPortfolioId(uid, connection.id),
                userId: uid,
                name: `Alpaca Paper Portfolio (${externalAccountId})`,
                accountKind: BROKERAGE_ACCOUNT_KIND,
                environment,
                brokerConnectionId: connection.id,
                status: PORTFOLIO_STATUSES.ACTIVE,
                cashBalance: 0,
                totalValue: 0
              }
            })
          }
        }
      }
    }

    // Maintain legacy BrokerAccount mirror for backward-compatible readers
    let legacyAccount = null
    if (typeof db?.brokerAccount?.upsert === 'function') {
      legacyAccount = await db.brokerAccount.upsert({
        where: { userId: uid },
        update: {
          apiKey: encryptedApiKey,
          apiSecret: encryptedApiSecret,
          paper: environment === PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER,
          status: 'active',
          lastVerifiedAt: now
        },
        create: {
          id: generateId(ID_PREFIXES.BROKER),
          userId: uid,
          broker: 'alpaca',
          apiKey: encryptedApiKey,
          apiSecret: encryptedApiSecret,
          paper: environment === PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER,
          status: 'active',
          lastVerifiedAt: now
        }
      })
    }

    return { connection, legacyAccount }
  }

  if (typeof prismaClient?.$transaction === 'function') {
    return prismaClient.$transaction(runUpsert)
  }
  return runUpsert(prismaClient)
}

async function haltConnectionPortfoliosAndBots(db, userId, brokerConnectionId, reason, now = new Date()) {
  if (typeof db?.portfolio?.findMany !== 'function') return { portfoliosHalted: 0, botsPaused: 0 }
  const portfolios = await db.portfolio.findMany({
    where: { userId, brokerConnectionId }
  })
  let botsPaused = 0
  for (const p of portfolios) {
    await db.portfolio.update({
      where: { id: p.id },
      data: { status: PORTFOLIO_STATUSES.HALTED_CREDENTIALS }
    })
    if (typeof db?.bot?.findMany === 'function') {
      const enabledBots = await db.bot.findMany({
        where: { userId, portfolioId: p.id, enabled: true, deletedAt: null }
      })
      for (const b of enabledBots) {
        await db.bot.update({
          where: { id: b.id },
          data: { enabled: false }
        })
        botsPaused += 1
        if (typeof db?.botEvent?.create === 'function') {
          await db.botEvent.create({
            data: {
              id: `evt_${randomUUID()}`,
              botId: b.id,
              portfolioId: p.id,
              type: 'bot_paused',
              detail: `Paused because brokerage credentials were disconnected (${reason})`,
              metadata: { reason, brokerConnectionId, haltedAt: now.toISOString() }
            }
          })
        }
      }
    }
  }
  return { portfoliosHalted: portfolios.length, botsPaused }
}

/**
 * Disconnects a user's external brokerage connection(s):
 * - Marks `BrokerConnection` disconnected and removes active legacy `BrokerAccount` credentials.
 * - Transitions bound brokerage portfolios to `halted_credentials` and pauses their bots.
 * - Leaves `internal_sim` portfolios and `internal_sim` bots untouched!
 */
export async function disconnectUserBrokerConnections(
  userId,
  { brokerConnectionId = null, prismaClient = prisma } = {}
) {
  const uid = String(userId ?? '').trim()
  if (!uid) return { deleted: false }
  const now = new Date()

  const runDisconnect = async (db) => {
    let found = false
    let portfoliosHalted = 0
    let botsPaused = 0

    if (typeof db?.brokerConnection?.findMany === 'function') {
      const connections = await db.brokerConnection.findMany({
        where: {
          userId: uid,
          status: 'active',
          ...(brokerConnectionId ? { id: String(brokerConnectionId) } : {})
        }
      })
      for (const conn of connections) {
        found = true
        const halted = await haltConnectionPortfoliosAndBots(db, uid, conn.id, 'user_disconnected_credentials', now)
        portfoliosHalted += halted.portfoliosHalted
        botsPaused += halted.botsPaused
        await db.brokerConnection.update({
          where: { id: conn.id },
          data: {
            status: 'disconnected',
            disconnectedAt: now,
            encryptedApiKey: '',
            encryptedApiSecret: ''
          }
        })
      }
    }

    if (typeof db?.brokerAccount?.findUnique === 'function') {
      const legacy = await db.brokerAccount.findUnique({ where: { userId: uid } })
      if (legacy) {
        found = true
        if (typeof db.brokerAccount.delete === 'function') {
          await db.brokerAccount.delete({ where: { userId: uid } })
        } else if (typeof db.brokerAccount.deleteMany === 'function') {
          await db.brokerAccount.deleteMany({ where: { userId: uid } })
        }
      }
    }

    if (!found) return null
    return { deleted: true, portfoliosHalted, botsPaused }
  }

  if (typeof prismaClient?.$transaction === 'function') {
    return prismaClient.$transaction(runDisconnect)
  }
  return runDisconnect(prismaClient)
}

/**
 * Resolves decrypted credentials strictly for a specific `Portfolio` (never blindly by `userId`
 * when `brokerConnectionId` is bound), enforcing environment and active status checks.
 */
export async function resolvePortfolioBrokerCredentials(
  portfolio,
  { prismaClient = prisma, env = process.env } = {}
) {
  if (!portfolio) return null
  const environment = normalizePortfolioEnvironment(portfolio)
  if (environment === PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM) {
    return { mode: 'internal_sim', simulated: true, paper: true, environment }
  }
  if (environment === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE && !isLiveTradingEnabled(env)) {
    throw new AccountDomainError(
      'LIVE_TRADING_DISABLED',
      'Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.',
      403
    )
  }
  if (portfolio.status && portfolio.status !== PORTFOLIO_STATUSES.ACTIVE) {
    throw new AccountDomainError(
      'PORTFOLIO_NOT_ACTIVE',
      `Portfolio ${portfolio.id} is not active (status: ${portfolio.status}).`,
      409,
      { portfolioStatus: portfolio.status }
    )
  }

  if (portfolio.brokerConnectionId && typeof prismaClient?.brokerConnection?.findUnique === 'function') {
    const conn = await prismaClient.brokerConnection.findUnique({
      where: { id: portfolio.brokerConnectionId }
    })
    if (!conn || conn.userId !== portfolio.userId || conn.status !== 'active' || !conn.encryptedApiKey) {
      throw new AccountDomainError(
        'BROKER_CREDENTIALS_DISCONNECTED',
        'Brokerage credentials for this portfolio are disconnected or invalid.',
        403
      )
    }
    const apiKey = decrypt(conn.encryptedApiKey)
    const apiSecret = decrypt(conn.encryptedApiSecret)
    const paper = conn.environment === PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER
    return {
      mode: conn.environment,
      simulated: false,
      paper,
      environment: conn.environment,
      brokerConnectionId: conn.id,
      externalAccountId: conn.externalAccountId,
      apiKey,
      apiSecret,
      baseUrl: paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
    }
  }

  // Fallback for pre-P1 legacy brokerage portfolios without brokerConnectionId
  if (typeof prismaClient?.brokerAccount?.findUnique === 'function') {
    const legacy = await prismaClient.brokerAccount.findUnique({ where: { userId: portfolio.userId } })
    if (!legacy?.apiKey || !legacy?.apiSecret || legacy.status === 'disabled') {
      throw new AccountDomainError('BROKER_NOT_CONFIGURED', 'Alpaca credentials not configured', 403)
    }
    const paper = legacy.paper !== false
    if (!paper && !isLiveTradingEnabled(env)) {
      throw new AccountDomainError('LIVE_TRADING_DISABLED', 'Live trading is disabled.', 403)
    }
    return {
      mode: paper ? PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER : PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE,
      simulated: false,
      paper,
      environment: paper ? PORTFOLIO_ENVIRONMENTS.ALPACA_PAPER : PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE,
      brokerConnectionId: null,
      externalAccountId: null,
      apiKey: decrypt(legacy.apiKey),
      apiSecret: decrypt(legacy.apiSecret),
      baseUrl: paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
    }
  }

  throw new AccountDomainError('BROKER_NOT_CONFIGURED', 'Brokerage credentials not configured', 403)
}
