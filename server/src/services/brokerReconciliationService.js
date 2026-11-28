import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { getUserAlpacaCredentialsOrThrow } from './alpacaClockService.js'
import { simulationConfig } from './simulationService.js'
import { ensureExternalBrokeragePortfolio } from './defaultPaperPortfolioService.js'
import {
  computeNetPositionMapFromExecutions,
  syncExternalUnmanagedPositions
} from './portfolioAccountingService.js'
import { PORTFOLIO_STATUSES } from './accountDomainService.js'

const OVERLAP_MS = 5 * 60 * 1000
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const POSITION_DRIFT_TOLERANCE = 0.000001

function toDateSafe(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapBrokerStatusToExecutionStatus(status) {
  if (status === 'filled') return 'filled'
  if (status === 'partially_filled') return 'partially_filled'
  if (status === 'canceled' || status === 'cancelled' || status === 'rejected' || status === 'expired') return 'cancelled'
  return 'submitted'
}

async function getOrCreateDefaultPortfolioId(userId) {
  const portfolio = await ensureExternalBrokeragePortfolio(userId, {
    prismaClient: prisma,
    generatePortfolioId: () => generateId(ID_PREFIXES.PORTFOLIO)
  })
  return portfolio.id
}

async function fetchAlpacaOrders({ baseUrl, apiKey, apiSecret, after }) {
  const url = new URL(`${baseUrl}/v2/orders`)
  url.searchParams.set('status', 'all')
  url.searchParams.set('direction', 'desc')
  url.searchParams.set('limit', '500')
  if (after) url.searchParams.set('after', after.toISOString())

  const res = await fetch(url.toString(), {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Alpaca ${res.status}: ${text}`)
  }
  const payload = await res.json()
  return Array.isArray(payload) ? payload : []
}

async function fetchAlpacaPositions({ baseUrl, apiKey, apiSecret }) {
  const res = await fetch(`${baseUrl}/v2/positions`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Alpaca ${res.status}: ${text}`)
  }
  const payload = await res.json()
  return Array.isArray(payload) ? payload : []
}

async function upsertOrderAsExecution({ userId, portfolioId, order }) {
  const brokerOrderId = order?.id ? String(order.id) : null
  const clientOrderId = order?.client_order_id ? String(order.client_order_id) : null
  if (!brokerOrderId && !clientOrderId) return null

  const symbol = String(order?.symbol ?? '').toUpperCase()
  const side = String(order?.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy'
  const qty = Number(order?.qty ?? order?.filled_qty ?? 0)
  const fallbackPrice = Number(order?.limit_price ?? order?.stop_price ?? order?.filled_avg_price ?? 0)
  const filledAvgPrice = Number(order?.filled_avg_price)
  const submittedAt = toDateSafe(order?.submitted_at)
  const filledAt = toDateSafe(order?.filled_at)
  const status = String(order?.status ?? 'new')

  const existing = await prisma.execution.findFirst({
    where: {
      userId,
      OR: [
        ...(brokerOrderId ? [{ brokerOrderId }] : []),
        ...(clientOrderId ? [{ clientOrderId }] : [])
      ]
    }
  })

  const patch = {
    brokerOrderId: brokerOrderId ?? undefined,
    clientOrderId: clientOrderId ?? undefined,
    brokerStatus: status,
    status: mapBrokerStatusToExecutionStatus(status),
    submittedAt: submittedAt ?? undefined,
    lastBrokerSyncAt: new Date(),
    filledAt: filledAt ?? undefined,
    filledPrice: Number.isFinite(filledAvgPrice) ? filledAvgPrice : undefined,
    filledQuantity: Number.isFinite(Number(order?.filled_qty)) ? Number(order.filled_qty) : undefined
  }

  if (existing) {
    return prisma.execution.update({
      where: { id: existing.id },
      data: patch
    })
  }

  if (!symbol || !Number.isFinite(qty) || qty <= 0) return null

  return prisma.execution.create({
    data: {
      id: generateId(ID_PREFIXES.EXECUTION),
      userId,
      portfolioId,
      ticker: symbol,
      direction: side,
      quantity: qty,
      price: Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 0.01,
      commission: 0,
      fees: 0,
      origin: 'external',
      sourceType: 'UNKNOWN',
      ...patch
    }
  })
}

function buildLocalPositionMap(executions) {
  return computeNetPositionMapFromExecutions(
    (executions ?? []).map((e) => ({
      ...e,
      filledQuantity: e.filledQuantity ?? e.quantity,
      filledPrice: e.filledPrice ?? e.price ?? 1
    }))
  )
}

function buildBrokerPositionMap(positions) {
  const map = new Map()
  for (const position of positions) {
    const ticker = String(position?.symbol ?? '').toUpperCase()
    if (!ticker) continue
    const qty = Number(position?.qty ?? 0)
    const avgPrice = Number(position?.avg_entry_price ?? 0)
    if (!Number.isFinite(qty)) continue
    map.set(ticker, {
      qty,
      avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0
    })
  }
  return map
}

async function detectPositionDrift(userId) {
  if (simulationConfig().enabled) {
    return { inSync: true, mismatchCount: 0, mismatchDetails: [], positionSource: 'simulated' }
  }

  const [executions, broker] = await Promise.all([
    prisma.execution.findMany({
      where: { userId },
      select: { ticker: true, direction: true, quantity: true, filledQuantity: true, status: true }
    }),
    prisma.brokerAccount.findUnique({ where: { userId } })
  ])

  if (!broker) {
    return { inSync: true, mismatchCount: 0, mismatchDetails: [], positionSource: 'db' }
  }

  const creds = await getUserAlpacaCredentialsOrThrow(userId)
  const brokerPositions = await fetchAlpacaPositions(creds)
  const localMap = buildLocalPositionMap(executions)
  const brokerMap = buildBrokerPositionMap(brokerPositions)

  const symbols = new Set([...localMap.keys(), ...brokerMap.keys()])
  const mismatches = []
  for (const symbol of symbols) {
    const localQty = Number(localMap.get(symbol) ?? 0)
    const brokerEntry = brokerMap.get(symbol)
    if (!brokerEntry && Math.abs(localQty) > POSITION_DRIFT_TOLERANCE) {
      mismatches.push({
        symbol,
        localQty,
        brokerQty: 0,
        brokerAvgPrice: 0
      })
      continue
    }

    const brokerQty = Number(brokerEntry?.qty ?? 0)
    const brokerAvgPrice = Number(brokerEntry?.avgPrice ?? 0)

    if (Math.abs(localQty - brokerQty) <= POSITION_DRIFT_TOLERANCE) continue
    mismatches.push({
      symbol,
      localQty,
      brokerQty,
      brokerAvgPrice
    })
  }

  return {
    inSync: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatchDetails: mismatches,
    positionSource: mismatches.length > 0 ? 'broker' : 'db'
  }
}

export async function getReconcileStatus(userId) {
  const sim = simulationConfig()
  const checkpoint = await prisma.brokerSyncCheckpoint.findUnique({ where: { userId } })
  if (!checkpoint) {
    if (sim.enabled) {
      return {
        synced: true,
        lastSyncStatus: 'ok',
        lastSyncedAt: new Date(),
        lastSyncError: null,
        inSync: true,
        mismatchCount: 0,
        mismatchDetails: [],
        mismatchSymbols: [],
        positionSource: 'simulated',
        sourceOfTruth: {
          executionHistory: 'db',
          positionsEquity: 'simulated',
          stats: 'simulated'
        }
      }
    }
    return {
      synced: false,
      lastSyncStatus: 'never',
      lastSyncedAt: null,
      lastSyncError: null,
      inSync: true,
      mismatchCount: 0,
      mismatchDetails: [],
      mismatchSymbols: [],
      positionSource: 'db',
      sourceOfTruth: {
        executionHistory: 'db',
        positionsEquity: 'alpaca',
        stats: 'hybrid'
      }
    }
  }

  return {
    synced: Boolean(checkpoint.lastSyncedAt),
    lastSyncStatus: checkpoint.lastSyncStatus,
    lastSyncedAt: checkpoint.lastSyncedAt,
    lastSyncError: checkpoint.lastSyncError,
    inSync: checkpoint.inSync,
    mismatchCount: checkpoint.mismatchCount,
    mismatchDetails: Array.isArray(checkpoint.mismatchDetails) ? checkpoint.mismatchDetails : [],
    mismatchSymbols: Array.isArray(checkpoint.mismatchDetails)
      ? checkpoint.mismatchDetails.map((item) => String(item?.symbol ?? '')).filter(Boolean)
      : [],
    positionSource: checkpoint.positionSource,
    sourceOfTruth: {
      executionHistory: 'db',
      positionsEquity: sim.enabled ? 'simulated' : 'alpaca',
      stats: sim.enabled ? 'simulated' : 'hybrid'
    }
  }
}

export async function reconcileBrokerActivity(userId) {
  if (simulationConfig().enabled) {
    const now = new Date()
    const saved = await prisma.brokerSyncCheckpoint.upsert({
      where: { userId },
      update: {
        lastSyncedAt: now,
        lastSyncStatus: 'ok',
        lastSyncError: null,
        inSync: true,
        mismatchCount: 0,
        mismatchDetails: [],
        positionSource: 'simulated'
      },
      create: {
        userId,
        lastSyncedAt: now,
        lastSyncStatus: 'ok',
        lastSyncError: null,
        inSync: true,
        mismatchCount: 0,
        mismatchDetails: [],
        positionSource: 'simulated'
      }
    })
    return {
      imported: 0,
      scannedOrders: 0,
      hasMoreOrders: false,
      lastSyncedAt: saved.lastSyncedAt,
      lastSyncStatus: saved.lastSyncStatus,
      inSync: true,
      mismatchCount: 0,
      positionSource: 'simulated'
    }
  }

  const creds = await getUserAlpacaCredentialsOrThrow(userId)
  const portfolioId = await getOrCreateDefaultPortfolioId(userId)

  const checkpoint = await prisma.brokerSyncCheckpoint.findUnique({ where: { userId } })
  const now = Date.now()
  const baseline = checkpoint?.lastSyncedAt
    ? new Date(checkpoint.lastSyncedAt.getTime() - OVERLAP_MS)
    : new Date(now - LOOKBACK_MS)

  try {
    const orders = await fetchAlpacaOrders({
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      after: baseline
    })

    let imported = 0
    let newestOrderAt = checkpoint?.lastSyncOrderAt ?? null
    const boundedOrders = orders.slice(0, 500)
    for (const order of boundedOrders) {
      const updated = await upsertOrderAsExecution({ userId, portfolioId, order })
      if (updated) imported += 1
      const candidate = toDateSafe(order?.updated_at) ?? toDateSafe(order?.submitted_at)
      if (candidate && (!newestOrderAt || candidate > newestOrderAt)) newestOrderAt = candidate
    }

    const drift = await detectPositionDrift(userId)
    if (typeof prisma.positionLot?.upsert === 'function') {
      const [brokerPositions, localExecs] = await Promise.all([
        fetchAlpacaPositions(creds).catch(() => []),
        prisma.execution.findMany({ where: { userId, portfolioId } }).catch(() => [])
      ])
      await syncExternalUnmanagedPositions({
        portfolioId,
        userId,
        brokerPositions,
        localExecutions: localExecs,
        prismaClient: prisma
      }).catch(() => {})
    }

    // Automated Drift Quarantine (P5):
    // When unexplained brokerage position drift is detected, quarantine the brokerage portfolio
    // so CentralPolicyEngine & ExecutionGateway halt new automated orders until reconciled clean.
    if (typeof prisma.portfolio?.updateMany === 'function') {
      if (!drift.inSync && drift.mismatchCount > 0) {
        await prisma.portfolio.updateMany({
          where: { id: portfolioId, userId, status: PORTFOLIO_STATUSES.ACTIVE },
          data: { status: PORTFOLIO_STATUSES.QUARANTINED_DRIFT }
        }).catch(() => {})
      } else if (drift.inSync) {
        await prisma.portfolio.updateMany({
          where: { id: portfolioId, userId, status: PORTFOLIO_STATUSES.QUARANTINED_DRIFT },
          data: { status: PORTFOLIO_STATUSES.ACTIVE }
        }).catch(() => {})
      }
    }

    const saved = await prisma.brokerSyncCheckpoint.upsert({
      where: { userId },
      update: {
        lastSyncedAt: new Date(),
        lastSyncStatus: 'ok',
        lastSyncError: null,
        lastSyncOrderAt: newestOrderAt,
        inSync: drift.inSync,
        mismatchCount: drift.mismatchCount,
        mismatchDetails: drift.mismatchDetails,
        positionSource: drift.positionSource
      },
      create: {
        userId,
        lastSyncedAt: new Date(),
        lastSyncStatus: 'ok',
        lastSyncError: null,
        lastSyncOrderAt: newestOrderAt,
        inSync: drift.inSync,
        mismatchCount: drift.mismatchCount,
        mismatchDetails: drift.mismatchDetails,
        positionSource: drift.positionSource
      }
    })

    return {
      imported,
      scannedOrders: boundedOrders.length,
      hasMoreOrders: orders.length > boundedOrders.length,
      lastSyncedAt: saved.lastSyncedAt,
      lastSyncStatus: saved.lastSyncStatus,
      inSync: saved.inSync,
      mismatchCount: saved.mismatchCount,
      positionSource: saved.positionSource
    }
  } catch (error) {
    await prisma.brokerSyncCheckpoint.upsert({
      where: { userId },
      update: {
        lastSyncedAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: error.message,
        inSync: false
      },
      create: {
        userId,
        lastSyncedAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: error.message,
        inSync: false
      }
    })
    throw error
  }
}

/**
 * Platform-wide broker fleet status and drift radar for administrator inspection.
 */
export async function getBrokerFleetStatus({ prismaClient = prisma } = {}) {
  const sim = simulationConfig()
  const [accounts, checkpoints, users] = await Promise.all([
    prismaClient.brokerAccount.findMany({
      select: { id: true, userId: true, paper: true, status: true, lastVerifiedAt: true, createdAt: true, updatedAt: true }
    }).catch(() => []),
    prismaClient.brokerSyncCheckpoint.findMany().catch(() => []),
    prismaClient.user.findMany({ select: { id: true, email: true, name: true } }).catch(() => [])
  ])

  const userMap = new Map(users.map((u) => [u.id, u]))
  const checkpointMap = new Map(checkpoints.map((c) => [c.userId, c]))

  const totalConnected = accounts.length
  const paperCount = accounts.filter((a) => a.paper !== false).length
  const liveCount = accounts.filter((a) => a.paper === false).length

  let inSyncCount = 0
  let driftedCount = 0
  const driftedAccounts = []

  for (const acc of accounts) {
    const cp = checkpointMap.get(acc.userId)
    const user = userMap.get(acc.userId)
    const inSync = cp ? cp.inSync : true
    const mismatchCount = cp ? cp.mismatchCount : 0

    if (!inSync || mismatchCount > 0) {
      driftedCount += 1
      driftedAccounts.push({
        userId: acc.userId,
        userEmail: user?.email ?? 'unknown',
        paper: acc.paper !== false,
        lastSyncedAt: cp?.lastSyncedAt ?? null,
        lastSyncStatus: cp?.lastSyncStatus ?? 'pending',
        mismatchCount,
        mismatchDetails: Array.isArray(cp?.mismatchDetails) ? cp.mismatchDetails : [],
        positionSource: cp?.positionSource ?? 'unknown'
      })
    } else {
      inSyncCount += 1
    }
  }

  return {
    timestamp: new Date().toISOString(),
    simulatedMode: sim.enabled,
    fleet: {
      totalAccounts: totalConnected,
      paperAccounts: paperCount,
      liveAccounts: liveCount,
      inSyncAccounts: inSyncCount,
      driftedAccountsCount: driftedCount
    },
    driftedAccounts
  }
}

/**
 * Triggers an on-demand reconciliation sweep across all connected broker accounts.
 */
export async function reconcileBrokerFleet({ prismaClient = prisma } = {}) {
  const accounts = await prismaClient.brokerAccount.findMany({
    where: { status: 'active' },
    select: { userId: true }
  }).catch(() => [])

  const results = {
    total: accounts.length,
    succeeded: 0,
    failed: 0,
    errors: []
  }

  for (const acc of accounts) {
    try {
      await reconcileBrokerActivity(acc.userId)
      results.succeeded += 1
    } catch (err) {
      results.failed += 1
      results.errors.push({ userId: acc.userId, error: err.message })
    }
  }

  return results
}
