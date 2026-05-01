import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { getUserAlpacaCredentialsOrThrow } from './alpacaClockService.js'

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
  const existing = await prisma.portfolio.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  })
  if (existing) return existing.id

  const created = await prisma.portfolio.create({
    data: {
      id: generateId(ID_PREFIXES.PORTFOLIO),
      userId,
      name: 'Main Portfolio'
    },
    select: { id: true }
  })
  return created.id
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
  const map = new Map()
  for (const execution of executions) {
    const status = String(execution?.status ?? '')
    if (status !== 'filled' && status !== 'partially_filled') continue

    const ticker = String(execution?.ticker ?? '').toUpperCase()
    if (!ticker) continue

    const qtyValue = Number(execution?.filledQuantity ?? execution?.quantity ?? 0)
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) continue

    const signed = execution.direction === 'sell' ? -qtyValue : qtyValue
    map.set(ticker, (map.get(ticker) ?? 0) + signed)
  }
  return map
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
  const checkpoint = await prisma.brokerSyncCheckpoint.findUnique({ where: { userId } })
  if (!checkpoint) {
    return {
      synced: false,
      lastSyncStatus: 'never',
      lastSyncedAt: null,
      lastSyncError: null,
      inSync: true,
      mismatchCount: 0,
      mismatchDetails: [],
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
      positionsEquity: 'alpaca',
      stats: 'hybrid'
    }
  }
}

export async function reconcileBrokerActivity(userId) {
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
