import { describe, it, expect } from 'vitest'
import {
  simulationConfig,
  isSimulatedOrderId,
  simulatedAccount,
  SIM_ORDER_PREFIX,
} from '../../src/services/simulationService.js'

describe('simulationService', () => {
  describe('simulationConfig', () => {
    it('enables continuous paper trading when SIM_MODE is continuous', () => {
      const config = simulationConfig({
        BROKER_MODE: 'simulated',
        SIM_MODE: 'continuous_paper',
        SIM_STARTING_CASH: '50000',
      })
      expect(config.enabled).toBe(true)
      expect(config.mode).toBe('continuous_paper')
      expect(config.startingCash).toBe(50000)
      expect(config.clock).toBeNull() // Live wall-clock
    })

    it('enables advancing replay when SIM_MODE is advancing_replay', () => {
      const config = simulationConfig({
        BROKER_MODE: 'simulated',
        SIM_MODE: 'advancing_replay',
        SIM_REPLAY_SESSION: '2026-11-20',
      })
      expect(config.enabled).toBe(true)
      expect(config.mode).toBe('advancing_replay')
      expect(config.session).toBe('2026-11-20')
      expect(config.clock).toBeInstanceOf(Date)
    })

    it('enables historical replay when a valid session date is provided', () => {
      const config = simulationConfig({
        BROKER_MODE: 'simulated',
        SIM_REPLAY_SESSION: '2026-11-20',
        SIM_STARTING_CASH: '100000',
      })
      expect(config.enabled).toBe(true)
      expect(config.mode).toBe('historical_replay')
      expect(config.session).toBe('2026-11-20')
      expect(config.startingCash).toBe(100000)
    })

    it('disables simulation when BROKER_MODE is not simulated', () => {
      const config = simulationConfig({
        BROKER_MODE: 'paper',
        SIM_REPLAY_SESSION: '2026-11-20',
      })
      expect(config.enabled).toBe(false)
    })
  })

  describe('isSimulatedOrderId', () => {
    it('detects simulated order prefixes correctly', () => {
      expect(isSimulatedOrderId('simreplay_2026-11-20_ord_1')).toBe(true)
      expect(isSimulatedOrderId('simreplay_continuous_ord_2')).toBe(true)
      expect(isSimulatedOrderId('alpaca_order_123')).toBe(false)
      expect(isSimulatedOrderId(null)).toBe(false)
    })
  })

  describe('simulatedAccount Mark-to-Market Accounting', () => {
    it('calculates cash, cost basis, realized P&L, unrealized P&L, and equity accurately', async () => {
      const fills = [
        // Buy 10 AAPL @ 150 = $1,500 cost
        {
          id: 'f1',
          brokerOrderId: `${SIM_ORDER_PREFIX}continuous_1`,
          ticker: 'AAPL',
          direction: 'buy',
          filledQuantity: 10,
          filledPrice: 150,
          fees: 0,
          createdAt: new Date('2026-11-20T14:35:00Z'),
        },
        // Buy 10 MSFT @ 400 = $4,000 cost
        {
          id: 'f2',
          brokerOrderId: `${SIM_ORDER_PREFIX}continuous_2`,
          ticker: 'MSFT',
          direction: 'buy',
          filledQuantity: 10,
          filledPrice: 400,
          fees: 0,
          createdAt: new Date('2026-11-20T14:40:00Z'),
        },
        // Sell 5 AAPL @ 170 = $850 proceeds (cost was 5 * 150 = $750; realized P&L = +$100)
        {
          id: 'f3',
          brokerOrderId: `${SIM_ORDER_PREFIX}continuous_3`,
          ticker: 'AAPL',
          direction: 'sell',
          filledQuantity: 5,
          filledPrice: 170,
          fees: 0,
          createdAt: new Date('2026-11-20T15:00:00Z'),
        },
      ]

      const mockPrisma = {
        execution: {
          findMany: async () => fills,
        },
      }

      // Mark to market prices: AAPL is now 180, MSFT is now 420
      const priceGetter = (symbol) => {
        if (symbol === 'AAPL') return 180
        if (symbol === 'MSFT') return 420
        return null
      }

      const account = await simulatedAccount('usr_1', {
        prismaClient: mockPrisma,
        config: { startingCash: 100_000, mode: 'continuous_paper', session: '2026-11-23' },
        priceGetter,
      })

      // Cash: 100,000 - 1,500 - 4,000 + 850 = 95,350
      expect(account.cash).toBe(95350)
      expect(account.buying_power).toBe(95350)

      // Realized P&L: 5 shares of AAPL bought @ 150, sold @ 170 = +$100
      expect(account.realized_pnl).toBe(100)

      // Open positions:
      // AAPL: 5 shares remaining @ cost basis $750 (avg entry 150). Market value @ 180 = $900. Unrealized = +$150.
      const aapl = account.positions.find((p) => p.symbol === 'AAPL')
      expect(aapl).toBeDefined()
      expect(aapl.qty).toBe('5')
      expect(aapl.avg_entry_price).toBe(150)
      expect(aapl.current_price).toBe(180)
      expect(aapl.market_value).toBe(900)
      expect(aapl.unrealized_pl).toBe(150)

      // MSFT: 10 shares @ cost basis $4,000 (avg entry 400). Market value @ 420 = $4,200. Unrealized = +$200.
      const msft = account.positions.find((p) => p.symbol === 'MSFT')
      expect(msft).toBeDefined()
      expect(msft.qty).toBe('10')
      expect(msft.avg_entry_price).toBe(400)
      expect(msft.current_price).toBe(420)
      expect(msft.market_value).toBe(4200)
      expect(msft.unrealized_pl).toBe(200)

      // Total Market Value: 900 + 4,200 = 5,100
      expect(account.market_value).toBe(5100)

      // Total Unrealized P&L: 150 + 200 = 350
      expect(account.unrealized_pnl).toBe(350)

      // Total Equity = Cash (95,350) + Market Value (5,100) = 100,450
      // Identity check: StartingCash (100,000) + Realized (100) + Unrealized (350) = 100,450
      expect(account.equity).toBe(100450)
      expect(account.total_pnl).toBe(450)
    })
  })
})
