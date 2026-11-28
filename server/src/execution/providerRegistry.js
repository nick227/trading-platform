/**
 * Execution Provider Registry (P2 — Portfolio-Scoped Provider Resolution)
 *
 * Resolves the authoritative ExecutionProvider for an Execution / Portfolio without relying on
 * global process overrides when operating in multi-tenant mixed mode:
 *   - `alpaca_live` portfolio        -> throws `LiveExecutionDisabledError` (hard containment)
 *   - Explicit `internal_sim` kind   -> `InternalSimulatorProvider` bound to `portfolio.id`
 *   - `alpaca_paper` w/ connection   -> `AlpacaPaperProvider` bound to `portfolio.brokerConnectionId`
 *   - Legacy / test fallback         -> delegates to `getBrokerClient(userId)`
 */
import prisma from '../loaders/prisma.js'
import { simulationConfig } from '../services/simulationService.js'
import {
  DEFAULT_PAPER_ACCOUNT_KIND
} from '../services/defaultPaperPortfolioService.js'
import {
  PORTFOLIO_ENVIRONMENTS,
  PORTFOLIO_STATUSES,
  resolvePortfolioBrokerCredentials
} from '../services/accountDomainService.js'
import { InternalSimulatorProvider } from './providers/InternalSimulatorProvider.js'
import { AlpacaPaperProvider } from './providers/AlpacaPaperProvider.js'
import { AlpacaLiveProvider } from './providers/AlpacaLiveProvider.js'
import { LiveExecutionDisabledError } from './providers/ExecutionProvider.js'

const simCacheByPortfolio = new Map()
const paperCacheByConnection = new Map()
const CACHE_TTL_MS = 60_000

export function clearProviderRegistryCache() {
  simCacheByPortfolio.clear()
  paperCacheByConnection.clear()
}

export function isExplicitInternalSimPortfolio(portfolio) {
  if (!portfolio) return false
  if (portfolio.accountKind === DEFAULT_PAPER_ACCOUNT_KIND || portfolio.accountKind === 'simulated_custom') {
    return true
  }
  return false
}

export async function resolveExecutionProviderForPortfolio({
  userId,
  portfolioId = null,
  portfolio: preloadedPortfolio = null,
  prismaClient = prisma,
  fallbackGetBrokerClient = null,
  engine = null,
  alpacaClientFactory = null
}) {
  // 1. Global replay / paper_daily harness (preserves existing M6 simulation test suites)
  const sim = simulationConfig()
  if (sim.enabled && fallbackGetBrokerClient) {
    return fallbackGetBrokerClient(userId)
  }

  const portfolio = preloadedPortfolio ?? (
    portfolioId && typeof prismaClient?.portfolio?.findUnique === 'function'
      ? await prismaClient.portfolio.findUnique({ where: { id: portfolioId } }).catch(() => null)
      : null
  )

  // 2. Hard live containment: an `alpaca_live` portfolio NEVER resolves an active provider
  if (portfolio?.environment === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE) {
    // Constructing AlpacaLiveProvider throws LiveExecutionDisabledError deterministically
    return new AlpacaLiveProvider()
  }

  // 3. Halted or quarantined portfolios cannot execute
  if (portfolio?.status && portfolio.status !== PORTFOLIO_STATUSES.ACTIVE) {
    const err = new Error(`Portfolio ${portfolio.id} is ${portfolio.status}`)
    err.code = 'PORTFOLIO_NOT_ACTIVE'
    err.portfolioStatus = portfolio.status
    throw err
  }

  // 4. Explicit `internal_sim` portfolio (`default_simulated_paper` or `simulated_custom`)
  //    executes via InternalSimulatorProvider side-by-side with `alpaca_paper` portfolios!
  if (isExplicitInternalSimPortfolio(portfolio)) {
    const cacheKey = `${userId}:${portfolio.id}`
    if (!simCacheByPortfolio.has(cacheKey)) {
      simCacheByPortfolio.set(
        cacheKey,
        new InternalSimulatorProvider(userId, {
          portfolioId: portfolio.id,
          startingCash: Number(portfolio.cashBalance) || 10_000,
          prismaClient,
          ...(engine ? { sessionClose: (t, s) => engine.getSessionClose(t, s) } : {})
        })
      )
    }
    return simCacheByPortfolio.get(cacheKey)
  }

  // 5. Explicit `BrokerConnection`-bound `alpaca_paper` portfolio
  if (portfolio?.brokerConnectionId && typeof prismaClient?.brokerConnection?.findUnique === 'function') {
    const cached = paperCacheByConnection.get(portfolio.brokerConnectionId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.provider
    }
    const creds = await resolvePortfolioBrokerCredentials(portfolio, { prismaClient })
    if (creds.environment === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE) {
      throw new LiveExecutionDisabledError()
    }
    const provider = new AlpacaPaperProvider({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      brokerConnectionId: creds.brokerConnectionId,
      externalAccountId: creds.externalAccountId,
      clientFactory: alpacaClientFactory
    })
    paperCacheByConnection.set(portfolio.brokerConnectionId, { provider, at: Date.now() })
    return provider
  }

  // 6. Legacy / unit-test fallback (`clientCache.getBrokerClient(userId)`)
  if (typeof fallbackGetBrokerClient === 'function') {
    return fallbackGetBrokerClient(userId)
  }
  return null
}
