/**
 * InternalSimulatorProvider (P2 — Consolidated Deterministic Simulation Provider)
 *
 * Consolidates all operational simulated execution (rule-based paper_daily / historical_replay bots,
 * manual simulated orders, Personal AI Trader, Approved Copilot Proposals, and Flagship AI Trader)
 * behind the single ExecutionProvider contract.
 *
 * Key guarantees:
 * - Zero external brokerage calls or credentials.
 * - Supports explicit deterministic fill models: `next_open`, `daily_close`, and `immediate_quote`.
 * - Scopes cash & holdings to `portfolioId` when bound to a specific portfolio (preserving
 *   multi-portfolio isolation), while maintaining backward compatibility with `simulatedAccount(userId)`
 *   in legacy global-simulator tests.
 * - Attaches explicit `marketObservation` provenance (`source`, `latencyClass`, `session`, `observedAt`).
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import {
  currentSimSession,
  isSimulatedOrderId,
  parseSimOrderId,
  sessionClock,
  simOrderId,
  simulatedAccount,
  simulationConfig
} from '../../services/simulationService.js'
import { wrapError } from '../../../../worker/src/broker/alpacaClient.js'
import { DEFAULT_PAPER_STARTING_CASH } from '../../services/defaultPaperPortfolioService.js'
import {
  EXECUTION_PROVIDER_TYPES,
  ExecutionProvider,
  MARKET_LATENCY_CLASSES
} from './ExecutionProvider.js'

const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired'])

export class InternalSimulatorProvider extends ExecutionProvider {
  constructor(
    userId,
    {
      portfolioId = null,
      startingCash = null,
      config = null,
      prismaClient = prisma,
      sessionClose = (t, s) => engineClient.getSessionClose(t, s),
      now = () => new Date(),
      resolveSession = null
    } = {}
  ) {
    super({
      providerType: EXECUTION_PROVIDER_TYPES.INTERNAL_SIMULATOR,
      environment: 'internal_sim',
      simulated: true
    })
    const globalSim = simulationConfig()
    this.userId = userId
    this.portfolioId = portfolioId
    this.config = config ?? (globalSim.enabled
      ? globalSim
      : {
          enabled: true,
          mode: 'paper_daily',
          executionModel: 'daily_close',
          startingCash: startingCash ?? DEFAULT_PAPER_STARTING_CASH,
          referenceTicker: 'SPY',
          maxSessionAgeDays: 5
        })
    if (!this.config.enabled) {
      throw new Error('InternalSimulatorProvider requires an enabled simulation configuration')
    }
    this.startingCash = startingCash ?? this.config.startingCash ?? DEFAULT_PAPER_STARTING_CASH
    this.db = prismaClient
    this.sessionClose = sessionClose
    this.now = now
    this.resolveSession = resolveSession ?? (() => currentSimSession({ config: this.config, engine: { getSessionClose: this.sessionClose } }))
    this.orders = new Map()
  }

  async getClock() {
    let session = null
    try {
      session = await this.resolveSession()
    } catch {
      session = new Date(this.now()).toISOString().slice(0, 10)
    }
    const open = new Date(`${session}T14:30:00Z`)
    return {
      is_open: true,
      next_open: open.toISOString(),
      next_close: sessionClock(session).toISOString(),
      simulated: true,
      mode: this.config.mode,
      session
    }
  }

  async getAccount() {
    if (!this.portfolioId) {
      return simulatedAccount(this.userId, { prismaClient: this.db, config: this.config })
    }
    const portfolio = typeof this.db?.portfolio?.findUnique === 'function'
      ? await this.db.portfolio.findUnique({ where: { id: this.portfolioId } }).catch(() => null)
      : null
    const baseCash = Number(portfolio?.cashBalance) > 0
      ? Number(portfolio.cashBalance)
      : Number(this.startingCash) || DEFAULT_PAPER_STARTING_CASH

    const fills = await this.db.execution.findMany({
      where: { userId: this.userId, portfolioId: this.portfolioId, filledQuantity: { gt: 0 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    let cash = baseCash
    const positions = new Map()
    for (const e of fills) {
      const qty = Number(e.filledQuantity) || 0
      const px = Number(e.filledPrice) || 0
      if (qty <= 0 || px <= 0) continue
      const fees = (Number(e.fees) || 0) + (Number(e.commission) || 0)
      const signed = String(e.direction).toLowerCase() === 'sell' ? -qty : qty
      cash -= signed * px + fees
      const p = positions.get(e.ticker) ?? { qty: 0, cost: 0 }
      p.qty += signed
      p.cost += signed * px
      positions.set(e.ticker, p)
    }
    const open = [...positions.entries()].filter(([, p]) => Math.abs(p.qty) > 1e-9)
    const marketValue = open.reduce((s, [, p]) => s + p.cost, 0)
    return {
      simulated: true,
      portfolioId: this.portfolioId,
      mode: this.config.mode,
      session: this.config.session ?? null,
      cash: Number(cash.toFixed(2)),
      buying_power: Number(Math.max(0, cash).toFixed(2)),
      non_marginable_buying_power: Number(Math.max(0, cash).toFixed(2)),
      equity: Number((cash + marketValue).toFixed(2)),
      positions: open.map(([symbol, p]) => ({
        symbol,
        qty: String(p.qty),
        avg_entry_price: p.qty ? Number((p.cost / p.qty).toFixed(4)) : 0
      }))
    }
  }

  async getPositions() {
    return (await this.getAccount()).positions
  }

  async submitOrder({ ticker, side, qty, clientOrderId, executionModel: overrideModel = null, referenceQuote = null }) {
    if (this.orders.has(clientOrderId) || (await this._fromDb(clientOrderId))) {
      throw wrapError({
        response: { status: 422, data: { message: 'client_order_id must be unique' } },
        message: '422'
      })
    }

    const effectiveModel = overrideModel ?? this.config.executionModel ?? 'daily_close'
    const at = this.now()

    if (effectiveModel === 'immediate_quote' && Number(referenceQuote) > 0) {
      const session = new Date(at).toISOString().slice(0, 10)
      const fillPrice = Number(referenceQuote)
      const order = {
        alpacaOrderId: simOrderId(this.config, session, clientOrderId),
        clientOrderId,
        ticker,
        side,
        qty: Number(qty),
        status: 'filled',
        filledQty: Number(qty),
        filledAvgPrice: fillPrice,
        submittedAt: at,
        filledAt: at,
        providerType: this.providerType,
        environment: this.environment,
        simulation: {
          mode: this.config.mode,
          session,
          price: 'immediate_quote',
          source: 'intent_quote'
        },
        marketObservation: {
          symbol: ticker,
          price: fillPrice,
          asOfSession: session,
          observedAt: at.toISOString(),
          source: 'intent_quote',
          latencyClass: MARKET_LATENCY_CLASSES.DELAYED_QUOTE
        }
      }
      this.orders.set(clientOrderId, order)
      return structuredClone(order)
    }

    let session
    let px
    try {
      const row = await this.db.execution.findFirst({
        where: { clientOrderId, userId: this.userId }
      })
      session = row?.simSession ?? (await this.resolveSession())
      px = await this.sessionClose(ticker, session)
    } catch (err) {
      throw wrapError({ code: 'ECONNABORTED', message: `simulator price unavailable: ${err.message}` })
    }

    const requestedOpen = effectiveModel === 'next_open'
    const requestedPrice = requestedOpen ? Number(px?.open) : Number(px?.close)
    if (!px || px.session !== session || !Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      throw wrapError({
        response: {
          status: 422,
          data: { message: `no ${session} ${requestedOpen ? 'open' : 'close'} for ${ticker}` }
        },
        message: '422'
      })
    }

    const fillPrice = requestedPrice
    const priceModel = requestedOpen ? 'market_open' : 'daily_close'
    const latencyClass = this.config.mode === 'historical_replay'
      ? MARKET_LATENCY_CLASSES.HISTORICAL_REPLAY
      : requestedOpen
        ? MARKET_LATENCY_CLASSES.SESSION_OPEN
        : MARKET_LATENCY_CLASSES.SESSION_CLOSE

    const order = {
      alpacaOrderId: simOrderId(this.config, session, clientOrderId),
      clientOrderId,
      ticker,
      side,
      qty: Number(qty),
      status: 'filled',
      filledQty: Number(qty),
      filledAvgPrice: fillPrice,
      submittedAt: at,
      filledAt: at,
      providerType: this.providerType,
      environment: this.environment,
      simulation: {
        mode: this.config.mode,
        session,
        price: priceModel,
        source: px.source ?? 'alpha-engine'
      },
      marketObservation: {
        symbol: ticker,
        price: fillPrice,
        asOfSession: session,
        observedAt: at.toISOString(),
        source: px.source ?? 'alpha-engine',
        latencyClass
      }
    }
    this.orders.set(clientOrderId, order)
    return structuredClone(order)
  }

  async _fromDb(clientOrderId) {
    const e = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId } })
    if (!e || !isSimulatedOrderId(e.brokerOrderId)) return null
    const parsed = parseSimOrderId(e.brokerOrderId)
    return {
      alpacaOrderId: e.brokerOrderId,
      clientOrderId,
      ticker: e.ticker,
      side: e.direction,
      qty: Number(e.quantity),
      status: e.brokerStatus && TERMINAL.has(e.brokerStatus) ? e.brokerStatus : 'filled',
      filledQty: Number(e.filledQuantity ?? e.quantity),
      filledAvgPrice: Number(e.filledPrice ?? e.price),
      submittedAt: e.submittedAt,
      filledAt: e.filledAt,
      providerType: this.providerType,
      environment: this.environment,
      simulation: { mode: parsed.mode, session: parsed.session, price: 'daily_close' }
    }
  }

  async getOrderByClientOrderId(clientOrderId) {
    const o = this.orders.get(clientOrderId) ?? (await this._fromDb(clientOrderId))
    return o ? structuredClone(o) : null
  }

  async getOrder(id) {
    const local = [...this.orders.values()].find((o) => o.alpacaOrderId === id)
    if (local) return structuredClone(local)
    const parsed = parseSimOrderId(id)
    if (parsed) {
      const o = await this._fromDb(parsed.clientOrderId)
      if (o) return o
    }
    throw wrapError({ response: { status: 404, data: { message: 'order not found' } }, message: '404' })
  }

  async cancelOrder() {
    // Simulator orders fill deterministically upon submission; nothing open at external venue.
  }
}
