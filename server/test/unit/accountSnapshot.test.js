/** Portfolio risk checks measure against the owner's real (or simulated) account, never placeholders. */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../worker/src/db/prisma.js', () => ({ default: {} }))
vi.mock('../../../worker/src/broker/clientCache.js', () => ({ getBrokerClient: async () => null }))

const { brokerAccountSnapshot } = await import('../../../worker/src/risk/accountSnapshot.js')
const { RiskGateService } = await import('../../../worker/src/risk/services/RiskGateService.js').then((m) => ({ RiskGateService: m.riskGateService.constructor }))

const db = (portfolio) => ({ portfolio: { findUnique: async () => portfolio } })
const broker = (account) => async () => ({ getAccount: async () => account })

describe('brokerAccountSnapshot', () => {
  it('reads the owner’s Alpaca account (string fields) or the simulator account', async () => {
    expect(await brokerAccountSnapshot('por_a', { prismaClient: db({ userId: 'u' }), getClient: broker({ equity: '25000.5', cash: '9000', buying_power: '18000' }) }))
      .toEqual({ cash: 9000, equity: 25000.5, buyingPower: 18000, simulated: false })
    expect(await brokerAccountSnapshot('por_a', { prismaClient: db({ userId: 'u' }), getClient: broker({ simulated: true, equity: 100000, cash: 100000, buying_power: 100000 }) }))
      .toMatchObject({ equity: 100000, simulated: true })
  })

  it('fails closed instead of inventing balances', async () => {
    await expect(brokerAccountSnapshot('x', { prismaClient: db(null), getClient: broker({ equity: 1 }) })).rejects.toThrow('portfolio_not_found')
    await expect(brokerAccountSnapshot('x', { prismaClient: db({ userId: 'u' }), getClient: async () => null })).rejects.toThrow('broker_account_unavailable')
    await expect(brokerAccountSnapshot('x', { prismaClient: db({ userId: 'u' }), getClient: broker({ cash: '5' }) })).rejects.toThrow('broker_account_unavailable')
    await expect(brokerAccountSnapshot('x', { prismaClient: db({ userId: 'u' }), getClient: broker({ equity: '0' }) })).rejects.toThrow('broker_account_unavailable')
  })

  it('keeps the 2% risk-per-trade rule, measured against the real equity', async () => {
    const gate = new RiskGateService()
    const settings = gate.getDefaultRiskSettings()
    expect(settings.maxRiskPerTrade).toBe(0.02)
    expect((await gate.checkRiskPerTrade(2 * 342.56, { totalValue: 100000 }, settings)).passed).toBe(true)
    expect((await gate.checkRiskPerTrade(2 * 342.56, { totalValue: 12000 }, settings)).passed).toBe(false)
  })
})
