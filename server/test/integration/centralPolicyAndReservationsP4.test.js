import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import {
  AUTHORIZATION_MODES,
  buildAuthorizationEnvelope,
  buildMarketObservation,
  evaluateAndReserveTradeIntentTx,
  EXECUTION_TIMINGS,
  finalizeReservationForExecution
} from '../../src/policy/centralPolicyEngine.js'
import { MARKET_LATENCY_CLASSES } from '../../src/execution/providers/ExecutionProvider.js'

describe('P4 — Central Policy, Market-Data Provenance & Concurrent Capital Reservations', () => {
  const createdUserIds = []

  afterAll(async () => {
    for (const uid of createdUserIds) {
      await prisma.portfolioCapitalReservation.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.tradeIntentRecord.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.positionLot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.execution.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.bot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.portfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {})
    }
  })

  it('prevents concurrent bots on a shared $10,000 portfolio from over-allocating capital via row-locked reservations', async () => {
    const user = await prisma.user.create({
      data: {
        email: `p4_race_${randomUUID()}@example.test`,
        passwordHash: '$test$',
        fullName: 'P4 Reservation User'
      }
    })
    createdUserIds.push(user.id)

    const portfolio = await prisma.portfolio.create({
      data: {
        id: `prt_p4_${randomUUID().slice(0, 10)}`,
        userId: user.id,
        name: 'Shared $10k Sim Portfolio',
        accountKind: 'simulated_custom',
        environment: 'internal_sim',
        status: 'active',
        cashBalance: 10_000,
        totalValue: 10_000
      }
    })

    const botA = await prisma.bot.create({
      data: {
        id: `bot_p4_a_${randomUUID().slice(0, 8)}`,
        userId: user.id,
        portfolioId: portfolio.id,
        name: 'Bot A',
        enabled: true,
        config: { tickers: ['AAPL'], direction: 'buy', allocatedAmount: 7_000, maxOrderNotional: 7_000 }
      }
    })
    const botB = await prisma.bot.create({
      data: {
        id: `bot_p4_b_${randomUUID().slice(0, 8)}`,
        userId: user.id,
        portfolioId: portfolio.id,
        name: 'Bot B',
        enabled: true,
        config: { tickers: ['MSFT'], direction: 'buy', allocatedAmount: 7_000, maxOrderNotional: 7_000 }
      }
    })

    const now = new Date('2026-11-27T15:00:00Z')
    // Fire two concurrent $6,000 buy intents ($12,000 combined > $10,000 portfolio cash!)
    const [resA, resB] = await Promise.all([
      prisma.$transaction((tx) =>
        evaluateAndReserveTradeIntentTx(tx, {
          executionId: `exe_p4_a_${randomUUID().slice(0, 8)}`,
          userId: user.id,
          portfolioId: portfolio.id,
          botId: botA.id,
          symbol: 'AAPL',
          side: 'buy',
          quantity: 30,
          referencePrice: 200, // $6,000
          executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
          authorization: buildAuthorizationEnvelope({
            authorizationMode: AUTHORIZATION_MODES.USER_RULE_MANDATE,
            actorUserId: user.id,
            botId: botA.id,
            authorizedAt: now
          }),
          marketObservation: buildMarketObservation({
            symbol: 'AAPL',
            price: 200,
            observedAt: now,
            asOfSession: '2026-11-27',
            latencyClass: MARKET_LATENCY_CLASSES.SESSION_CLOSE
          }),
          now
        })
      ),
      prisma.$transaction((tx) =>
        evaluateAndReserveTradeIntentTx(tx, {
          executionId: `exe_p4_b_${randomUUID().slice(0, 8)}`,
          userId: user.id,
          portfolioId: portfolio.id,
          botId: botB.id,
          symbol: 'MSFT',
          side: 'buy',
          quantity: 15,
          referencePrice: 400, // $6,000
          executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
          authorization: buildAuthorizationEnvelope({
            authorizationMode: AUTHORIZATION_MODES.USER_RULE_MANDATE,
            actorUserId: user.id,
            botId: botB.id,
            authorizedAt: now
          }),
          marketObservation: buildMarketObservation({
            symbol: 'MSFT',
            price: 400,
            observedAt: now,
            asOfSession: '2026-11-27',
            latencyClass: MARKET_LATENCY_CLASSES.SESSION_CLOSE
          }),
          now
        })
      )
    ])

    const outcomes = [resA, resB]
    const approved = outcomes.filter((o) => o.allowed)
    const rejected = outcomes.filter((o) => !o.allowed)
    expect(approved).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBe('insufficient_unreserved_portfolio_cash')
    expect(rejected[0].decision.availableAfterReservationsDollars).toBe(4000)

    // Releasing the winner's reservation immediately restores $6,000 capacity
    await finalizeReservationForExecution(prisma, {
      executionId: approved[0].reservation.executionId,
      status: 'cancelled',
      reason: 'user_cancel'
    })

    const retryLoser = await prisma.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        executionId: `exe_p4_retry_${randomUUID().slice(0, 8)}`,
        userId: user.id,
        portfolioId: portfolio.id,
        botId: botB.id,
        symbol: 'MSFT',
        side: 'buy',
        quantity: 15,
        referencePrice: 400,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.USER_RULE_MANDATE,
          actorUserId: user.id,
          botId: botB.id,
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'MSFT',
          price: 400,
          observedAt: now,
          asOfSession: '2026-11-27',
          latencyClass: MARKET_LATENCY_CLASSES.SESSION_CLOSE
        }),
        now
      })
    )
    expect(retryLoser.allowed).toBe(true)
  })

  it('enforces authorization provenance, market-data provenance freshness, and blocks selling external_unmanaged lots', async () => {
    const user = await prisma.user.create({
      data: {
        email: `p4_prov_${randomUUID()}@example.test`,
        passwordHash: '$test$',
        fullName: 'P4 Provenance User'
      }
    })
    createdUserIds.push(user.id)

    const brokerPortfolio = await prisma.portfolio.create({
      data: {
        id: `prt_p4_brk_${randomUUID().slice(0, 10)}`,
        userId: user.id,
        name: 'Alpaca Paper Portfolio',
        accountKind: 'brokerage',
        environment: 'alpaca_paper',
        status: 'active',
        cashBalance: 0,
        totalValue: 0
      }
    })

    const now = new Date('2026-11-27T15:30:00Z')

    // 1. Silent `paper_veto_sim_only` authorization MUST be rejected on brokerage portfolios
    const silentOnBroker = await prisma.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        userId: user.id,
        portfolioId: brokerPortfolio.id,
        symbol: 'NVDA',
        side: 'buy',
        quantity: 5,
        referencePrice: 140,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.PAPER_VETO_SIM_ONLY,
          actorUserId: user.id,
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'NVDA',
          price: 140,
          observedAt: now,
          latencyClass: MARKET_LATENCY_CLASSES.REALTIME_STREAM
        }),
        now
      })
    )
    expect(silentOnBroker.allowed).toBe(false)
    expect(silentOnBroker.reason).toBe('silent_auth_forbidden_outside_sim')

    // 2. Historical replay or stale (>5 min) observations MUST be rejected on immediate brokerage intents
    const historicalOnBroker = await prisma.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        userId: user.id,
        portfolioId: brokerPortfolio.id,
        symbol: 'NVDA',
        side: 'buy',
        quantity: 5,
        referencePrice: 140,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.USER_MANUAL,
          actorUserId: user.id,
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'NVDA',
          price: 140,
          observedAt: now,
          latencyClass: MARKET_LATENCY_CLASSES.HISTORICAL_REPLAY
        }),
        now
      })
    )
    expect(historicalOnBroker.allowed).toBe(false)
    expect(historicalOnBroker.reason).toBe('historical_data_forbidden_on_brokerage')

    const staleOnBroker = await prisma.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        userId: user.id,
        portfolioId: brokerPortfolio.id,
        symbol: 'NVDA',
        side: 'buy',
        quantity: 5,
        referencePrice: 140,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.USER_MANUAL,
          actorUserId: user.id,
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'NVDA',
          price: 140,
          observedAt: new Date(now.getTime() - 10 * 60_000), // 10 min old > 5 min limit
          latencyClass: MARKET_LATENCY_CLASSES.REALTIME_STREAM
        }),
        now
      })
    )
    expect(staleOnBroker.allowed).toBe(false)
    expect(staleOnBroker.reason).toBe('stale_market_observation')

    // 3. Seed 20 shares of external_unmanaged AAPL -> Bot MUST NOT be allowed to sell them!
    await prisma.positionLot.create({
      data: {
        id: `lot_ext_${randomUUID()}`,
        portfolioId: brokerPortfolio.id,
        userId: user.id,
        symbol: 'AAPL',
        ownerType: 'external_unmanaged',
        ownerId: 'external',
        externalPositionKey: `ext:${brokerPortfolio.id}:AAPL`,
        openedAt: now,
        initialQtyMicros: 20_000_000n,
        remainingQtyMicros: 20_000_000n,
        unitCostMicros: 180_000_000n,
        status: 'open'
      }
    })
    const bot = await prisma.bot.create({
      data: {
        id: `bot_p4_sell_${randomUUID().slice(0, 8)}`,
        userId: user.id,
        portfolioId: brokerPortfolio.id,
        name: 'Bot Seller',
        enabled: true,
        config: { tickers: ['AAPL'], direction: 'sell' }
      }
    })

    const sellExternalAttempt = await prisma.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        userId: user.id,
        portfolioId: brokerPortfolio.id,
        botId: bot.id,
        symbol: 'AAPL',
        side: 'sell',
        quantity: 5,
        referencePrice: 210,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.USER_RULE_MANDATE,
          actorUserId: user.id,
          botId: bot.id,
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'AAPL',
          price: 210,
          observedAt: now,
          latencyClass: MARKET_LATENCY_CLASSES.REALTIME_STREAM
        }),
        now
      })
    )
    expect(sellExternalAttempt.allowed).toBe(false)
    expect(sellExternalAttempt.reason).toBe('sell_exceeds_unreserved_attributable_lots')
  })
})
