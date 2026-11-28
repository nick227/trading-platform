/**
 * Authoritative Portfolio Accounting Service (P3 — Fixed-Point Ledger, Owned Lots & Snapshots)
 *
 * Single source of truth for:
 * 1. Exact fixed-point cash & FIFO position reconstruction (`BigInt` micro-units via `domain/money.js`).
 * 2. Ownership-separated position lots (`bot` vs `manual_platform` vs `external_unmanaged`) so
 *    external brokerage shares count toward portfolio equity and concentration risk, while bots
 *    are strictly forbidden from selling `external_unmanaged` or another bot's shares.
 * 3. External cash-flow ledger (`PortfolioCashEntry`: deposits, withdrawals, dividends, initial funding)
 *    so ACH withdrawals never trigger phantom `EquityPeak` drawdowns.
 * 4. Authoritative daily equity history (`PortfolioDailySnapshot`).
 */
import { randomUUID } from 'node:crypto'
import prisma from '../loaders/prisma.js'
import {
  MICROS_SCALE,
  microsTo4Decimals,
  microsToDecimalString,
  microsToDollars,
  mulMicros,
  toMicros
} from '../domain/money.js'
import { calculateFifoAccounting, isBrokerFill } from './botAccountingService.js'

export const LOT_OWNER_TYPES = Object.freeze({
  BOT: 'bot',
  MANUAL_PLATFORM: 'manual_platform',
  EXTERNAL_UNMANAGED: 'external_unmanaged'
})

export const CASH_ENTRY_TYPES = Object.freeze({
  INITIAL_FUNDING: 'initial_funding',
  FILL_DEBIT: 'fill_debit',
  FILL_CREDIT: 'fill_credit',
  FEE: 'fee',
  EXTERNAL_DEPOSIT: 'external_deposit',
  EXTERNAL_WITHDRAWAL: 'external_withdrawal',
  DIVIDEND: 'dividend',
  ADJUSTMENT: 'adjustment'
})

export function resolveExecutionLotOwner(exec) {
  if (!exec) return { ownerType: LOT_OWNER_TYPES.MANUAL_PLATFORM, ownerId: 'manual' }
  if (exec.origin === 'external' || exec.sourceType === 'EXTERNAL_UNMANAGED') {
    return { ownerType: LOT_OWNER_TYPES.EXTERNAL_UNMANAGED, ownerId: 'external' }
  }
  if (exec.botId) {
    return { ownerType: LOT_OWNER_TYPES.BOT, ownerId: String(exec.botId) }
  }
  return { ownerType: LOT_OWNER_TYPES.MANUAL_PLATFORM, ownerId: String(exec.userId || 'manual') }
}

/**
 * Exact fixed-point net position map (`Map<SYMBOL, number>`) from filled executions.
 * Replaces ad-hoc floating-point position loops in reconciliation and simulator services.
 */
export function computeNetPositionMapFromExecutions(executions = []) {
  const mapMicros = new Map()
  for (const execution of executions) {
    const status = String(execution?.status ?? '')
    if (status && status !== 'filled' && status !== 'partially_filled') continue
    if (!isBrokerFill(execution)) continue
    const ticker = String(execution.ticker ?? '').toUpperCase()
    if (!ticker) continue
    const qtyMicros = toMicros(execution.filledQuantity ?? execution.quantity ?? 0)
    if (qtyMicros <= 0n) continue
    const signed = String(execution.direction).toLowerCase() === 'sell' ? -qtyMicros : qtyMicros
    mapMicros.set(ticker, (mapMicros.get(ticker) ?? 0n) + signed)
  }
  const out = new Map()
  for (const [ticker, micros] of mapMicros.entries()) {
    out.set(ticker, microsTo4Decimals(micros))
  }
  return out
}

/**
 * Computes ownership-partitioned open positions across a portfolio (`bot:<id>`, `manual_platform`,
 * and `external_unmanaged` lots), guaranteeing bots can never sell `external_unmanaged` holdings.
 */
export function computeOwnedPortfolioLots({ executions = [], externalUnmanagedLots = [] } = {}) {
  const byOwnerKey = new Map()
  for (const exec of executions) {
    if (!isBrokerFill(exec)) continue
    const { ownerType, ownerId } = resolveExecutionLotOwner(exec)
    const key = `${ownerType}:${ownerId}`
    if (!byOwnerKey.has(key)) byOwnerKey.set(key, { ownerType, ownerId, fills: [] })
    byOwnerKey.get(key).fills.push(exec)
  }

  const buckets = {}
  const sellableByBot = {} // symbol -> { [botId]: qty }

  for (const [key, group] of byOwnerKey.entries()) {
    const acc = calculateFifoAccounting(group.fills)
    buckets[key] = {
      ownerType: group.ownerType,
      ownerId: group.ownerId,
      openPositions: acc.openPositions
    }
    if (group.ownerType === LOT_OWNER_TYPES.BOT) {
      for (const [sym, pos] of Object.entries(acc.openPositions)) {
        if (!sellableByBot[sym]) sellableByBot[sym] = {}
        sellableByBot[sym][group.ownerId] = pos.quantity
      }
    }
  }

  // Merge external unmanaged PositionLot rows (e.g., pre-existing Alpaca shares not in Execution history)
  const unmanagedPositions = {}
  for (const lot of externalUnmanagedLots) {
    const remMicros = toMicros(lot.remainingQtyMicros ?? lot.quantity ?? 0)
    if (remMicros <= 0n) continue
    const sym = String(lot.symbol ?? '').toUpperCase()
    const unitMicros = toMicros(lot.unitCostMicros ?? lot.avgPrice ?? 0)
    const cur = unmanagedPositions[sym] ?? { qtyMicros: 0n, costMicros: 0n }
    cur.qtyMicros += remMicros
    cur.costMicros += mulMicros(remMicros, unitMicros)
    unmanagedPositions[sym] = cur
  }

  if (Object.keys(unmanagedPositions).length > 0) {
    const existingExternal = buckets['external_unmanaged:external']?.openPositions ?? {}
    const mergedExternal = { ...existingExternal }
    for (const [sym, u] of Object.entries(unmanagedPositions)) {
      const prev = mergedExternal[sym]
      const totalQtyMicros = u.qtyMicros + (prev ? toMicros(prev.quantity) : 0n)
      const totalCostMicros = u.costMicros + (prev ? toMicros(prev.costBasis) : 0n)
      mergedExternal[sym] = {
        ticker: sym,
        quantity: microsTo4Decimals(totalQtyMicros),
        costBasis: microsToDollars(totalCostMicros),
        avgPrice: totalQtyMicros > 0n
          ? microsTo4Decimals((totalCostMicros * MICROS_SCALE) / totalQtyMicros)
          : 0,
        ownerType: LOT_OWNER_TYPES.EXTERNAL_UNMANAGED
      }
    }
    buckets['external_unmanaged:external'] = {
      ownerType: LOT_OWNER_TYPES.EXTERNAL_UNMANAGED,
      ownerId: 'external',
      openPositions: mergedExternal
    }
  }

  return {
    buckets,
    sellableByBot,
    getBotSellableQuantity(botId, symbol) {
      return sellableByBot[String(symbol).toUpperCase()]?.[String(botId)] ?? 0
    }
  }
}

/**
 * Records an external cash flow (`external_deposit`, `external_withdrawal`, `dividend`, `initial_funding`)
 * idempotently by `externalActivityId`.
 */
export async function recordPortfolioCashFlow({
  portfolioId,
  userId,
  entryType,
  amount,
  externalActivityId = null,
  executionId = null,
  effectiveAt = new Date(),
  metadata = null,
  prismaClient = prisma
}) {
  if (!Object.values(CASH_ENTRY_TYPES).includes(entryType)) {
    throw new Error(`Unsupported cash entry type: ${entryType}`)
  }
  const rawMicros = toMicros(amount)
  const signedMicros = entryType === CASH_ENTRY_TYPES.EXTERNAL_WITHDRAWAL || entryType === CASH_ENTRY_TYPES.FILL_DEBIT || entryType === CASH_ENTRY_TYPES.FEE
    ? (rawMicros > 0n ? -rawMicros : rawMicros)
    : rawMicros

  if (externalActivityId && typeof prismaClient?.portfolioCashEntry?.findUnique === 'function') {
    const existing = await prismaClient.portfolioCashEntry.findUnique({
      where: { externalActivityId: String(externalActivityId) }
    })
    if (existing) return existing
  }

  return prismaClient.portfolioCashEntry.create({
    data: {
      id: `pce_${randomUUID()}`,
      portfolioId: String(portfolioId),
      userId: String(userId),
      entryType,
      amountMicros: signedMicros,
      amountDecimal: microsToDecimalString(signedMicros, 4),
      executionId,
      externalActivityId: externalActivityId ? String(externalActivityId) : null,
      effectiveAt: new Date(effectiveAt),
      metadata
    }
  })
}

/**
 * Computes net external cash flows (`deposits - withdrawals`) for a portfolio since `sinceDate`
 * so `DrawdownStressService` never mistakes an ACH withdrawal for a trading drawdown.
 */
export async function getNetExternalCashFlowsSince(
  portfolioId,
  sinceDate = null,
  { prismaClient = prisma } = {}
) {
  if (!portfolioId || typeof prismaClient?.portfolioCashEntry?.findMany !== 'function') {
    return 0
  }
  try {
    const entries = await prismaClient.portfolioCashEntry.findMany({
      where: {
        portfolioId: String(portfolioId),
        entryType: { in: [CASH_ENTRY_TYPES.EXTERNAL_DEPOSIT, CASH_ENTRY_TYPES.EXTERNAL_WITHDRAWAL] },
        ...(sinceDate ? { effectiveAt: { gt: new Date(sinceDate) } } : {})
      }
    })
    let sumMicros = 0n
    for (const e of entries) {
      sumMicros += BigInt(e.amountMicros ?? toMicros(e.amountDecimal ?? 0))
    }
    return microsToDollars(sumMicros)
  } catch {
    return 0
  }
}

/**
 * Syncs pre-existing / unmanaged brokerage holdings (`brokerQty > localPlatformQty`) as
 * `PositionLot` rows with `ownerType = 'external_unmanaged'` so portfolio valuation and
 * concentration risk see the full brokerage position while bots cannot liquidate them.
 */
export async function syncExternalUnmanagedPositions({
  portfolioId,
  userId,
  brokerPositions = [],
  localExecutions = [],
  prismaClient = prisma
}) {
  if (!portfolioId || typeof prismaClient?.positionLot?.upsert !== 'function') return []
  const localMap = computeNetPositionMapFromExecutions(
    localExecutions.filter((e) => e.origin !== 'external')
  )
  const synced = []
  const now = new Date()

  for (const pos of brokerPositions) {
    const symbol = String(pos?.symbol ?? '').toUpperCase()
    if (!symbol) continue
    const brokerQtyMicros = toMicros(pos?.qty ?? pos?.quantity ?? 0)
    const localQtyMicros = toMicros(localMap.get(symbol) ?? 0)
    const unmanagedMicros = brokerQtyMicros - localQtyMicros
    const externalPositionKey = `extpos:${portfolioId}:${symbol}`

    if (unmanagedMicros > 100n) {
      const avgCostMicros = toMicros(pos?.avg_entry_price ?? pos?.avgPrice ?? 0)
      const lot = await prismaClient.positionLot.upsert({
        where: { externalPositionKey },
        update: {
          remainingQtyMicros: unmanagedMicros,
          unitCostMicros: avgCostMicros,
          status: 'open'
        },
        create: {
          id: `lot_${randomUUID()}`,
          portfolioId: String(portfolioId),
          userId: String(userId),
          symbol,
          ownerType: LOT_OWNER_TYPES.EXTERNAL_UNMANAGED,
          ownerId: 'external',
          externalPositionKey,
          openedAt: now,
          initialQtyMicros: unmanagedMicros,
          remainingQtyMicros: unmanagedMicros,
          unitCostMicros: avgCostMicros,
          feesMicros: 0n,
          status: 'open'
        }
      })
      synced.push(lot)
    } else {
      await prismaClient.positionLot.updateMany({
        where: { externalPositionKey },
        data: { remainingQtyMicros: 0n, status: 'closed' }
      }).catch(() => {})
    }
  }
  return synced
}

/**
 * Idempotently backfills `PortfolioCashEntry` and `PositionLot` records from persisted `Execution`
 * fills + portfolio initial funding so existing simulated & Flagship track records remain continuous.
 */
export async function backfillPortfolioLedgerFromExecutions(
  portfolioId,
  { prismaClient = prisma } = {}
) {
  const portfolio = await prismaClient.portfolio.findUnique({ where: { id: String(portfolioId) } })
  if (!portfolio) return { cashEntriesCreated: 0, lotsCreated: 0 }

  let cashEntriesCreated = 0
  let lotsCreated = 0

  // 1. Seed initial funding cash entry for simulated portfolios if non-zero
  const startingCashMicros = toMicros(portfolio.cashBalance ?? 0)
  if (startingCashMicros > 0n) {
    const initActivityId = `init_funding:${portfolio.id}`
    const existingInit = await prismaClient.portfolioCashEntry.findUnique({
      where: { externalActivityId: initActivityId }
    })
    if (!existingInit) {
      await recordPortfolioCashFlow({
        portfolioId: portfolio.id,
        userId: portfolio.userId,
        entryType: CASH_ENTRY_TYPES.INITIAL_FUNDING,
        amount: startingCashMicros,
        externalActivityId: initActivityId,
        effectiveAt: portfolio.createdAt ?? new Date(),
        prismaClient
      })
      cashEntriesCreated += 1
    }
  }

  // 2. Backfill fills & open FIFO lots
  const executions = await prismaClient.execution.findMany({
    where: { portfolioId: portfolio.id, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } },
    orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
  })
  const validFills = executions.filter(isBrokerFill)

  for (const fill of validFills) {
    const fillActivityId = `exec_fill:${fill.id}`
    const existingCash = await prismaClient.portfolioCashEntry.findUnique({
      where: { externalActivityId: fillActivityId }
    })
    if (!existingCash) {
      const qtyMicros = toMicros(fill.filledQuantity)
      const pxMicros = toMicros(fill.filledPrice)
      const feeMicros = toMicros(fill.fees ?? 0) + toMicros(fill.commission ?? 0)
      const grossMicros = mulMicros(qtyMicros, pxMicros)
      const isSell = String(fill.direction).toLowerCase() === 'sell'
      const netMicros = isSell ? (grossMicros - feeMicros) : -(grossMicros + feeMicros)

      await prismaClient.portfolioCashEntry.create({
        data: {
          id: `pce_${randomUUID()}`,
          portfolioId: portfolio.id,
          userId: portfolio.userId,
          entryType: isSell ? CASH_ENTRY_TYPES.FILL_CREDIT : CASH_ENTRY_TYPES.FILL_DEBIT,
          amountMicros: netMicros,
          amountDecimal: microsToDecimalString(netMicros, 4),
          executionId: fill.id,
          externalActivityId: fillActivityId,
          effectiveAt: fill.filledAt ?? fill.createdAt ?? new Date()
        }
      })
      cashEntriesCreated += 1
    }
  }

  // Recompute exact FIFO remaining quantities per buy lot and upsert PositionLot rows
  const accounting = calculateFifoAccounting(validFills)
  const openLotMap = new Map()
  for (const pos of Object.values(accounting.openPositions ?? {})) {
    for (const lot of pos.lots ?? []) {
      if (lot.id) openLotMap.set(lot.id, lot)
    }
  }

  for (const fill of validFills) {
    if (String(fill.direction).toLowerCase() !== 'buy') continue
    const { ownerType, ownerId } = resolveExecutionLotOwner(fill)
    const openLot = openLotMap.get(fill.id)
    const initMicros = toMicros(fill.filledQuantity)
    const remMicros = openLot ? toMicros(openLot.remainingQty) : 0n
    const unitCostMicros = toMicros(fill.filledPrice)
    const feesMicros = toMicros(fill.fees ?? 0) + toMicros(fill.commission ?? 0)

    const existingLot = await prismaClient.positionLot.findUnique({
      where: { openExecutionId: fill.id }
    })
    if (!existingLot) {
      await prismaClient.positionLot.create({
        data: {
          id: `lot_${randomUUID()}`,
          portfolioId: portfolio.id,
          userId: portfolio.userId,
          symbol: String(fill.ticker).toUpperCase(),
          ownerType,
          ownerId,
          openExecutionId: fill.id,
          openedAt: fill.filledAt ?? fill.createdAt ?? new Date(),
          initialQtyMicros: initMicros,
          remainingQtyMicros: remMicros,
          unitCostMicros,
          feesMicros,
          status: remMicros > 0n ? 'open' : 'closed'
        }
      })
      lotsCreated += 1
    } else if (BigInt(existingLot.remainingQtyMicros) !== remMicros) {
      await prismaClient.positionLot.update({
        where: { id: existingLot.id },
        data: {
          remainingQtyMicros: remMicros,
          status: remMicros > 0n ? 'open' : 'closed'
        }
      })
    }
  }

  return { cashEntriesCreated, lotsCreated }
}

/**
 * Records or updates an authoritative daily equity snapshot for a portfolio (`PortfolioDailySnapshot`).
 */
export async function recordPortfolioDailySnapshot({
  portfolioId,
  userId,
  sessionDate,
  cash,
  marketValue,
  equity,
  netExternalCashFlow = 0,
  realizedPnl = 0,
  unrealizedPnl = 0,
  priceProvenance = null,
  prismaClient = prisma
}) {
  const existing = await prismaClient.portfolioDailySnapshot.findFirst({
    where: { portfolioId: String(portfolioId), sessionDate: String(sessionDate) }
  })
  const payload = {
    cashDecimal: microsToDecimalString(toMicros(cash), 2),
    marketValueDecimal: microsToDecimalString(toMicros(marketValue), 2),
    equityDecimal: microsToDecimalString(toMicros(equity), 2),
    netExternalCashFlowDecimal: microsToDecimalString(toMicros(netExternalCashFlow), 2),
    realizedPnlDecimal: microsToDecimalString(toMicros(realizedPnl), 2),
    unrealizedPnlDecimal: microsToDecimalString(toMicros(unrealizedPnl), 2),
    priceProvenance
  }
  if (existing) {
    return prismaClient.portfolioDailySnapshot.update({
      where: { id: existing.id },
      data: payload
    })
  }
  return prismaClient.portfolioDailySnapshot.create({
    data: {
      id: `pds_${randomUUID()}`,
      portfolioId: String(portfolioId),
      userId: String(userId),
      sessionDate: String(sessionDate),
      ...payload
    }
  })
}
