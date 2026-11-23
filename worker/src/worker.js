import prisma from './db/prisma.js'
import { WORKER_ID } from './db/lease.js'
import { startOrderWorker, stopOrderWorker, setInflightMap } from './queues/orderWorker.js'
import { startAlpacaStream, stopAlpacaStream } from './market/alpacaStream.js'
import { getAlpacaClient } from './broker/alpacaClient.js'
import { getAlpacaStream } from './broker/alpacaStream.js'
import { startQuoteSync, checkSubscriptionRequests, expireOldSubscriptions } from './market/quoteSync.js'
import { initCalendar, refreshCalendar, onMarketOpen, onMarketClose, getLastCalendarRefreshAt } from './market/calendar.js'
import { startBotEngine, stopBotEngine, onPriceTick, inflightMap } from './engine/botEngine.js'
import { log } from './logger.js'
import { currentSimSession, simulationConfig } from '../../server/src/services/simulationService.js'
import { startSimulationFeed, startReplayFeed } from './market/replayFeed.js'
import { waitForSchema } from './db/schemaGate.js'
import { decrypt } from './utils/encryption.js'

// Initialize quote sync to server
startQuoteSync()

// Global interval references for graceful shutdown
let heartbeatInterval = null
let quoteSyncInterval = null
let calendarRefreshInterval = null
let orderWorkerPromise = null
let alpacaClient = null
let alpacaWs = null

// Health state tracked in memory, reported via heartbeat
const healthState = {
  orderWorker: 'stopped',
  alpacaWs: 'disconnected',
  alpacaRest: 'unknown',
  calendar: 'uninitialized',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  log.info({ workerId: WORKER_ID, env: process.env.NODE_ENV ?? 'development' }, 'worker_start')

  // Wire the inflight map from the bot engine into the order worker
  // so the worker can clear it when an order reaches a terminal state
  setInflightMap(inflightMap)

  if (process.env.WORKER_ORDER_PROCESSING !== 'disabled') {
    await waitForSchema()
    log.info('schema_ready')
  }

  // Controlled staging mode: WORKER_ORDER_PROCESSING=disabled verifies the database
  // and reports heartbeats only — no order worker, bot engine, or market stream, so
  // nothing can reach a broker. Unset keeps the normal runtime unchanged.
  // Simulator mode: only when explicitly configured on both switches.
  // Orders are filled by the internal simulator; no Alpaca client, stream
  // or credentials are ever created. Any partial configuration fails closed.
  const sim = simulationConfig()
  const simProcessing = process.env.WORKER_ORDER_PROCESSING === 'simulated'
  if (simProcessing || sim.requested) {
    if (!(simProcessing && sim.enabled)) {
      log.error({ WORKER_ORDER_PROCESSING: process.env.WORKER_ORDER_PROCESSING ?? null, BROKER_MODE: process.env.BROKER_MODE ?? null, session: sim.session },
        'simulator_misconfigured: requires WORKER_ORDER_PROCESSING=simulated, BROKER_MODE=simulated and SIM_REPLAY_SESSION=YYYY-MM-DD|latest; order processing not started')
      for (const k of ['orderWorker', 'alpacaWs', 'alpacaRest', 'calendar']) healthState[k] = 'disabled'
      startHeartbeat()
      return
    }
    log.warn({ mode: sim.mode, session: sim.session ?? 'latest' },
      sim.mode === 'paper_daily'
        ? 'simulator_mode: paper trading on the latest daily close; no broker orders are submitted'
        : 'simulator_mode: historical replay fills only; no broker orders are submitted')
    orderWorkerPromise = startOrderWorker().catch((err) => {
      healthState.orderWorker = 'failed'
      log.error({ err }, 'order_worker_crashed')
    })
    healthState.orderWorker = 'simulated'
    healthState.alpacaWs = 'disabled'
    healthState.alpacaRest = 'disabled'
    healthState.calendar = `${sim.mode}:${sim.session ?? 'latest'}`
    startHeartbeat()
    await startBotEngine()
    startSimulationFeed({
      mode: sim.mode,
      session: sim.session,
      resolveSession: sim.mode === 'paper_daily' ? () => currentSimSession({ config: sim }) : null,
      onTick: (ticker) => onPriceTick(ticker),
    })
    return
  }

  if (process.env.WORKER_ORDER_PROCESSING === 'disabled') {
    log.warn('worker_order_processing_disabled: order worker, bot engine, and market stream are stopped')
    for (const k of ['orderWorker', 'alpacaWs', 'alpacaRest', 'calendar']) healthState[k] = 'disabled'
    startHeartbeat()
    return
  }

  // 1. Initialize Market Calendar
  try {
    await initCalendar({ onMarketOpen, onMarketClose })
    healthState.calendar = 'initialized'
    log.info('market_calendar_initialized')
  } catch (err) {
    healthState.calendar = 'failed'
    log.error({ err }, 'failed_to_initialize_market_calendar')
  }

  // Schedule periodic calendar refresh (once a day at midnight UTC)
  calendarRefreshInterval = setInterval(async () => {
    try {
      await refreshCalendar()
      log.info('market_calendar_refreshed')
    } catch (err) {
      log.error({ err }, 'failed_to_refresh_market_calendar')
    }
  }, 24 * 60 * 60 * 1000)

  // 2. Fetch platform credentials from first active account to init REST & WS
  try {
    const account = await prisma.brokerAccount.findFirst({
      where: { status: 'ACTIVE' },
    })

    if (account && account.encryptedApiKey && account.encryptedSecretKey) {
      const apiKey = decrypt(account.encryptedApiKey)
      const secretKey = decrypt(account.encryptedSecretKey)

      // Initialize REST client
      alpacaClient = getAlpacaClient(apiKey, secretKey, account.paper)
      const clock = await alpacaClient.getClock()
      healthState.alpacaRest = clock ? 'connected' : 'error'

      // Initialize Alpaca WebSocket Stream
      alpacaWs = getAlpacaStream(apiKey, secretKey, account.paper)
      alpacaWs.connect()

      // Handle stream connection state
      alpacaWs.on('authenticated', () => {
        healthState.alpacaWs = 'connected'
        log.info('alpaca_websocket_authenticated')
      })

      alpacaWs.on('disconnect', () => {
        healthState.alpacaWs = 'disconnected'
        log.warn('alpaca_websocket_disconnected')
      })

      alpacaWs.on('error', (err) => {
        healthState.alpacaWs = 'error'
        log.error({ err }, 'alpaca_websocket_error')
      })

      // Wire price ticks from WebSocket to bot engine
      startAlpacaStream({
        onPrice: (ticker) => onPriceTick(ticker),
      })
    } else {
      log.warn('no_active_broker_account_found_skipping_market_stream')
    }
  } catch (err) {
    log.error({ err }, 'failed_to_initialize_broker_clients')
  }

  // 3. Start Order Worker
  orderWorkerPromise = startOrderWorker().catch((err) => {
    healthState.orderWorker = 'failed'
    log.error({ err }, 'order_worker_crashed')
  })
  healthState.orderWorker = 'running'

  // 4. Start Bot Engine (rule evaluation on price ticks)
  try {
    await startBotEngine()
    log.info('bot_engine_started')
  } catch (err) {
    log.error({ err }, 'failed_to_start_bot_engine')
  }

  // 5. Start Heartbeat reporting to DB
  startHeartbeat()

  // 6. Start Quote Sync subscription management (check every 5s, expire every 60s)
  quoteSyncInterval = setInterval(async () => {
    try {
      await checkSubscriptionRequests()
      await expireOldSubscriptions()
    } catch (err) {
      log.error({ err }, 'quote_sync_maintenance_error')
    }
  }, 5000)

  log.info({ workerId: WORKER_ID }, 'worker_bootstrapped_successfully')
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function startHeartbeat() {
  const recordHeartbeat = async () => {
    try {
      await prisma.systemEvent.create({
        data: {
          eventType: 'WORKER_HEARTBEAT',
          severity: 'INFO',
          source: `worker:${WORKER_ID}`,
          message: `Worker heartbeat: orderWorker=${healthState.orderWorker}, alpacaWs=${healthState.alpacaWs}, alpacaRest=${healthState.alpacaRest}`,
          context: {
            workerId: WORKER_ID,
            health: healthState,
            lastCalendarRefresh: getLastCalendarRefreshAt(),
            timestamp: new Date().toISOString(),
          },
        },
      })
    } catch (err) {
      log.error({ err }, 'heartbeat_failed')
    }
  }

  // Initial beat
  recordHeartbeat()
  // Beat every 30 seconds
  heartbeatInterval = setInterval(recordHeartbeat, 30_000)
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log.info({ signal, workerId: WORKER_ID }, 'worker_shutting_down')

  // Stop periodic intervals
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  if (quoteSyncInterval) clearInterval(quoteSyncInterval)
  if (calendarRefreshInterval) clearInterval(calendarRefreshInterval)

  // Disconnect WebSocket
  if (alpacaWs) {
    try {
      alpacaWs.disconnect()
    } catch (err) {
      log.error({ err }, 'error_disconnecting_alpaca_ws')
    }
  }

  // Stop Order Worker (stops polling, waits for active lease to finish)
  stopOrderWorker()

  // Stop Simulation Feed if running
  try {
    stopSimulationFeed()
  } catch { /* noop */ }

  // Stop Bot Engine
  stopBotEngine()

  // Record final shutdown event
  try {
    await prisma.systemEvent.create({
      data: {
        eventType: 'WORKER_STOPPED',
        severity: 'INFO',
        source: `worker:${WORKER_ID}`,
        message: `Worker shut down via ${signal}`,
        context: { workerId: WORKER_ID, signal },
      },
    })
    await prisma.$disconnect()
  } catch (err) {
    log.error({ err }, 'error_recording_shutdown_event')
  }

  log.info({ workerId: WORKER_ID }, 'worker_shutdown_complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', (err) => {
  log.error({ err }, 'uncaught_exception')
  shutdown('uncaughtException')
})
process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'unhandled_rejection')
})

// Run
main().catch((err) => {
  log.error({ err }, 'worker_fatal_startup_error')
  process.exit(1)
})
