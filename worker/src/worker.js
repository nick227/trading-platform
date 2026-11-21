import 'dotenv/config'
import os from 'os'
import prisma from './db/prisma.js'
import { AlpacaClient } from './broker/alpacaClient.js'
import { getMarketDataCredentials } from './market/marketCredentials.js'
import { startOrderWorker, stopOrderWorker, setInflightMap } from './queues/orderWorker.js'
import { initDataStream, onQuote, disconnect, ensureConnected, isConnected } from './market/dataStream.js'
import { startQuoteSync, checkSubscriptionRequests, expireOldSubscriptions } from './market/quoteSync.js'
import { initCalendar, refreshCalendar, onMarketOpen, onMarketClose, getLastCalendarRefreshAt } from './market/calendar.js'
import { startBotEngine, stopBotEngine, onPriceTick, inflightMap } from './engine/botEngine.js'
import { log } from './logger.js'
import { decrypt } from './utils/encryption.js'

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
  log.info({ workerId: WORKER_ID, env: process.env.NODE_ENV ?? 'development' }, 'worker_start')

  // Wire the inflight map from the bot engine into the order worker
  // so the worker can clear it when an order reaches a terminal state
  setInflightMap(inflightMap)

  // Start the order worker loop — processes queued executions continuously.
  // Each execution carries userId → worker loads the correct BrokerAccount per order.
  orderWorkerPromise = startOrderWorker().catch((err) => {
    healthState.orderWorker = 'failed'
    log.error({ err }, 'order_worker_crashed')
    process.exit(1)
  })

  // Start the heartbeat
  startHeartbeat()

  // Market data uses an explicit service-level credential for shared price streaming.
  // Never use an arbitrary customer account (brokerAccount.findFirst) for shared infrastructure.
  const marketCreds = getMarketDataCredentials()

  if (!marketCreds) {
    log.warn('no service-level market data credentials configured (ALPACA_MARKET_DATA_KEY/SECRET) — live stream disabled')
    healthState.alpacaWs = 'disabled'
    healthState.alpacaRest = 'disabled'
    // In dev / test, still start the bot engine and order worker for simulated ticks
    await startBotEngine()
    healthState.calendar = 'simulated'
    healthState.orderWorker = 'up'
    return
  }

  try {
    streamClient = new AlpacaClient({
      apiKey:    marketCreds.apiKey,
      apiSecret: marketCreds.apiSecret,
      paper:     marketCreds.paper
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
      log.info('market_open_at_boot')
      await startBotEngine()
      onMarketClose(msUntilClose, handleMarketClose)
    } else {
      log.info('market_closed_at_boot')
      onMarketOpen(msUntilOpen, handleMarketOpen)
    }
  } catch (err) {
    log.error({ err: err.message }, 'failed_to_initialize_market_data_stream')
    healthState.alpacaWs = 'failed'
    healthState.alpacaRest = 'failed'
    await startBotEngine()
  }
}

async function handleMarketOpen() {
  log.info('market_open')
  await refreshMarketState()
  ensureConnected()
  await startBotEngine()
  const { msUntilClose } = await refreshCalendar(streamClient)
  onMarketClose(msUntilClose, handleMarketClose)
}

async function handleMarketClose() {
  log.info('market_close')
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
      const now = new Date()
      const queueLagMs = await getQueueLagMs()
      const connected = isConnected()
      const health = { ...healthState, alpacaWs: connected ? 'up' : healthState.alpacaWs }
      await prisma.workerStatus.upsert({
        where:  { id: WORKER_ID },
        update: {
          lastSeen: now,
          queueLagMs,
          lastRestOkAt: healthState.alpacaRest === 'up' ? now : undefined,
          lastWsOkAt: connected ? now : undefined,
          lastCalendarRefreshAt: getLastCalendarRefreshAt() ?? undefined,
          health
        },
        create: {
          id: WORKER_ID,
          lastSeen: now,
          startedAt: now,
          queueLagMs,
          lastRestOkAt: healthState.alpacaRest === 'up' ? now : undefined,
          lastWsOkAt: connected ? now : undefined,
          lastCalendarRefreshAt: getLastCalendarRefreshAt() ?? undefined,
          health
        }
      })
    } catch (err) {
      log.warn({ err: err.message }, 'heartbeat_failed')
    }
  }
  heartbeatTimer = setInterval(tick, HEARTBEAT_MS)
  tick()
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  log.info({ signal }, 'worker_shutdown')
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
  log.error({ err }, 'uncaught_exception')
  shutdown('uncaughtException')
})

main().catch(err => {
  log.fatal({ err }, 'startup_failed')
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
    log.error({ err }, 'calendar_refresh_failed')
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
