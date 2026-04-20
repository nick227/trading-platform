import 'dotenv/config'
import os from 'os'
import prisma from './db/prisma.js'
import { AlpacaClient } from './broker/alpacaClient.js'
import { startOrderWorker, stopOrderWorker, setInflightMap } from './queues/orderWorker.js'
import { initDataStream, onQuote, disconnect, ensureConnected, isConnected } from './market/dataStream.js'
import { startQuoteSync, checkSubscriptionRequests, expireOldSubscriptions } from './market/quoteSync.js'
import { initCalendar, refreshCalendar, onMarketOpen, onMarketClose, getLastCalendarRefreshAt } from './market/calendar.js'
import { startBotEngine, stopBotEngine, onPriceTick, inflightMap } from './engine/botEngine.js'

// Initialize quote sync to server
startQuoteSync()

// Check for new subscription requests every 10 seconds
setInterval(checkSubscriptionRequests, 10_000)

// Expire old subscriptions every 5 minutes to reduce write amplification
setInterval(expireOldSubscriptions, 5 * 60 * 1000)

const WORKER_ID    = `${os.hostname()}-${process.pid}`
const HEARTBEAT_MS = 5_000

let heartbeatTimer = null
let orderWorkerPromise = null
let streamClient = null
const healthState = {
  orderWorker: 'starting',
  alpacaRest: 'unknown',
  alpacaWs: 'unknown',
  calendar: 'unknown'
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`[worker] starting — id=${WORKER_ID}`)

  // Wire the inflight map from the bot engine into the order worker
  // so the worker can clear it when an order reaches a terminal state
  setInflightMap(inflightMap)

  // Start the order worker loop — processes queued executions continuously.
  // Each execution carries userId → worker loads the correct BrokerAccount per order.
  orderWorkerPromise = startOrderWorker().catch((err) => {
    healthState.orderWorker = 'failed'
    console.error('[worker] order worker crashed:', err)
    process.exit(1)
  })

  // Start the heartbeat
  startHeartbeat()

  // Market data stream uses any valid broker account for authentication.
  // Alpaca's streaming API is market-level (not account-specific), so one
  // connection serves all users. The bot engine fetches per-user positions
  // independently via getBrokerClient(userId) when evaluating position_limit rules.
  const account = await prisma.brokerAccount.findFirst()

  if (!account) {
    console.warn('[worker] no broker account found — market data and bot engine disabled')
    console.warn('[worker] add a broker account via POST /api/broker to enable bots')
    return
  }

  streamClient = new AlpacaClient({
    apiKey:    account.apiKey,
    apiSecret: account.apiSecret,
    paper:     account.paper
  })

  // Initialize market data stream — single WS connection for all tickers
  initDataStream(streamClient.raw)
  onQuote((ticker) => onPriceTick(ticker))
  healthState.alpacaWs = isConnected() ? 'up' : 'starting'

  // Initialize market calendar and schedule engine start/stop
  const { isOpen, msUntilOpen, msUntilClose } = await initCalendar(streamClient)
  healthState.alpacaRest = 'up'
  healthState.calendar = 'ready'
  healthState.orderWorker = 'up'

  if (isOpen) {
    console.log('[worker] market is open — starting bot engine now')
    await startBotEngine()
    onMarketClose(msUntilClose, handleMarketClose)
  } else {
    console.log('[worker] market is closed — bot engine will start at open')
    onMarketOpen(msUntilOpen, handleMarketOpen)
  }
}

async function handleMarketOpen() {
  console.log('[worker] market opened')
  await refreshMarketState()
  ensureConnected()
  await startBotEngine()
  const { msUntilClose } = await refreshCalendar(streamClient)
  onMarketClose(msUntilClose, handleMarketClose)
}

async function handleMarketClose() {
  console.log('[worker] market closed')
  await refreshMarketState()
  stopBotEngine()
  disconnect()
  const { msUntilOpen } = await refreshCalendar(streamClient)
  onMarketOpen(msUntilOpen, handleMarketOpen)
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function startHeartbeat() {
  const tick = async () => {
    try {
      await prisma.workerStatus.upsert({
        where:  { id: WORKER_ID },
        update: {
          lastSeen: new Date(),
          queueLagMs: await getQueueLagMs(),
          lastRestOkAt: healthState.alpacaRest === 'up' ? new Date() : undefined,
          lastWsOkAt: isConnected() ? new Date() : undefined,
          lastCalendarRefreshAt: getLastCalendarRefreshAt() ?? undefined,
          health: { ...healthState, alpacaWs: isConnected() ? 'up' : healthState.alpacaWs }
        },
        create: {
          id: WORKER_ID,
          lastSeen: new Date(),
          startedAt: new Date(),
          queueLagMs: await getQueueLagMs(),
          lastRestOkAt: healthState.alpacaRest === 'up' ? new Date() : undefined,
          lastWsOkAt: isConnected() ? new Date() : undefined,
          lastCalendarRefreshAt: getLastCalendarRefreshAt() ?? undefined,
          health: { ...healthState, alpacaWs: isConnected() ? 'up' : healthState.alpacaWs }
        }
      })
    } catch (err) {
      console.warn('[worker] heartbeat failed:', err.message)
    }
  }
  heartbeatTimer = setInterval(tick, HEARTBEAT_MS)
  tick()
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`[worker] received ${signal} — shutting down`)
  stopOrderWorker()
  stopBotEngine()
  disconnect()
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (orderWorkerPromise) await Promise.race([orderWorkerPromise, sleep(2_000)])
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaught exception:', err)
  shutdown('uncaughtException')
})

main().catch(err => {
  console.error('[worker] fatal startup error:', err)
  process.exit(1)
})

async function refreshMarketState() {
  if (!streamClient) return
  try {
    await refreshCalendar(streamClient)
    healthState.alpacaRest = 'up'
    healthState.calendar = 'ready'
  } catch (err) {
    healthState.calendar = 'degraded'
    console.error('[worker] calendar refresh failed:', err)
  }
}

async function getQueueLagMs() {
  const oldestQueued = await prisma.execution.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true }
  })
  return oldestQueued ? Date.now() - oldestQueued.createdAt.getTime() : 0
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
