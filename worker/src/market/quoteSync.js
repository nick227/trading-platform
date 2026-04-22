// Sync worker price cache to shared live_quotes table
// Enables server to access worker's real-time quotes without direct worker API calls

import prisma from '../db/prisma.js'
import { priceCache } from './priceCache.js'
import { subscribe, unsubscribe } from './dataStream.js'

const SYNC_INTERVAL_MS = 2_000 // 2 seconds - frequent enough for UI
const BATCH_SIZE = 50 // Process quotes in batches to avoid overwhelming DB
const MATERIAL_CHANGE_THRESHOLD = 0.01 // 1 cent minimum price change
const MAX_SYNC_AGE_MS = 10_000 // Force sync every 10 seconds max

let syncTimer = null
let lastSyncMap = new Map() // ticker -> { timestamp, price, bid, ask } of last DB write

export function startQuoteSync() {
  console.log('[quoteSync] started - syncing price cache to DB every 2s')
  
  const tick = async () => {
    try {
      const cachedTickers = priceCache.tickers()
      const now = Date.now()
      
      // Filter tickers that need syncing (material change or max age)
      const tickersToSync = cachedTickers.filter(ticker => {
        const quote = priceCache.get(ticker)
        if (!quote) return false
        
        const lastSync = lastSyncMap.get(ticker)
        if (!lastSync) return true // New ticker

        // Force sync if max age exceeded
        if (now - lastSync.timestamp > MAX_SYNC_AGE_MS) return true
        
        // Only sync if material change occurred
        const priceChanged = Math.abs((quote.last || 0) - (lastSync.price || 0)) >= MATERIAL_CHANGE_THRESHOLD
        const bidChanged = lastSync.bid !== undefined && quote.bid !== undefined && Math.abs(quote.bid - lastSync.bid) >= MATERIAL_CHANGE_THRESHOLD
        const askChanged = lastSync.ask !== undefined && quote.ask !== undefined && Math.abs(quote.ask - lastSync.ask) >= MATERIAL_CHANGE_THRESHOLD
        
        return priceChanged || bidChanged || askChanged
      })
      
      if (tickersToSync.length === 0) return
      
      // Process in batches to avoid transaction overhead
      for (let i = 0; i < tickersToSync.length; i += BATCH_SIZE) {
        const batch = tickersToSync.slice(i, i + BATCH_SIZE)
        await syncBatch(batch)
      }
      
    } catch (error) {
      console.error('[quoteSync] sync failed:', error.message)
    }
  }
  
  syncTimer = setInterval(tick, SYNC_INTERVAL_MS)
  tick() // Initial sync
}

export function stopQuoteSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
    console.log('[quoteSync] stopped')
  }
}

async function syncBatch(tickers) {
  const now = new Date()
  const nowMs = now.getTime()

  const ops = []
  for (const ticker of tickers) {
    const quote = priceCache.get(ticker)
    if (!quote) continue

    const ageMs = nowMs - quote.updatedAt
    const row = {
      bid: quote.bid,
      ask: quote.ask,
      last: quote.last,
      changePct: 0,
      volume: 0,
      updatedAt: now,
      source: 'worker',
      feed: 'alpaca',
      ageMs
    }
    ops.push(prisma.liveQuote.upsert({
      where: { ticker },
      update: row,
      create: { ticker, ...row }
    }))
  }

  if (ops.length === 0) return

  try {
    // Batch transaction API: Prisma wraps all ops in one round-trip
    await prisma.$transaction(ops)

    // Update sync state after successful write — store as ms for consistent arithmetic
    const nowTs = nowMs
    for (const ticker of tickers) {
      const quote = priceCache.get(ticker)
      if (!quote) continue
      lastSyncMap.set(ticker, { timestamp: nowTs, price: quote.last, bid: quote.bid, ask: quote.ask })
    }
  } catch (error) {
    console.error(`[quoteSync] batch sync failed for ${tickers.slice(0, 3).join(',')}...:`, error.message)
  }
}

// Check for new subscription requests from UI demand
export async function checkSubscriptionRequests() {
  try {
    const requests = await prisma.liveQuoteSubscription.findMany({
      where: {
        requestedAt: {
          gte: new Date(Date.now() - 30_000) // Last 30 seconds
        }
      },
      take: 20
    })
    
    if (requests.length > 0) {
      const tickers = requests.map(r => r.ticker)
      console.log(`[quoteSync] processing ${tickers.length} subscription requests: ${tickers.join(', ')}`)
      
      subscribe(tickers)
      
      // Clear processed requests
      await prisma.liveQuoteSubscription.deleteMany({
        where: {
          ticker: { in: tickers }
        }
      })
    }
  } catch (error) {
    console.error('[quoteSync] subscription check failed:', error.message)
  }
}

// Expire old subscriptions to reduce write amplification
export async function expireOldSubscriptions() {
  try {
    const EXPIRE_AFTER_MS = 20 * 60 * 1000 // 20 minutes
    const expireBefore = new Date(Date.now() - EXPIRE_AFTER_MS)
    
    // Find tickers that haven't been updated recently
    const staleQuotes = await prisma.liveQuote.findMany({
      where: {
        updatedAt: {
          lt: expireBefore
        }
      },
      select: { ticker: true }
    })
    
    if (staleQuotes.length > 0) {
      const tickers = staleQuotes.map(q => q.ticker)
      console.log(`[quoteSync] expiring ${tickers.length} stale subscriptions: ${tickers.slice(0, 10).join(', ')}${tickers.length > 10 ? '...' : ''}`)
      
      unsubscribe(tickers)
      
      // Clean up stale quotes from DB
      await prisma.liveQuote.deleteMany({
        where: {
          ticker: { in: tickers }
        }
      })
      
      // Clear sync state
      tickers.forEach(ticker => lastSyncMap.delete(ticker))
    }
  } catch (error) {
    console.error('[quoteSync] subscription expiry failed:', error.message)
  }
}
