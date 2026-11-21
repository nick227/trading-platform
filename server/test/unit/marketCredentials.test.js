import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getMarketDataCredentials } from '../../../worker/src/market/marketCredentials.js'
import { getBrokerClient, clearClientCache } from '../../../worker/src/broker/clientCache.js'
import workerPrisma from '../../../worker/src/db/prisma.js'
import { encrypt } from '../../src/utils/encryption.js'

describe('Market data credentials & broker isolation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    clearClientCache()
    process.env = { ...originalEnv }
    delete process.env.ALPACA_MARKET_DATA_KEY
    delete process.env.ALPACA_MARKET_DATA_SECRET
    delete process.env.APCA_API_KEY_ID
    delete process.env.APCA_API_SECRET_KEY
    delete process.env.MARKET_DATA_API_KEY
    delete process.env.MARKET_DATA_API_SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    clearClientCache()
    vi.restoreAllMocks()
  })

  describe('getMarketDataCredentials', () => {
    it('returns null when no service-level credentials are set', () => {
      const creds = getMarketDataCredentials()
      expect(creds).toBeNull()
    })

    it('returns credentials when ALPACA_MARKET_DATA_KEY and SECRET are configured', () => {
      process.env.ALPACA_MARKET_DATA_KEY = 'service-market-key'
      process.env.ALPACA_MARKET_DATA_SECRET = 'service-market-secret'

      const creds = getMarketDataCredentials()
      expect(creds).toEqual({
        apiKey: 'service-market-key',
        apiSecret: 'service-market-secret',
        paper: true
      })
    })

    it('supports standard APCA_API_KEY_ID fallback for service', () => {
      process.env.APCA_API_KEY_ID = 'apca-key'
      process.env.APCA_API_SECRET_KEY = 'apca-secret'

      const creds = getMarketDataCredentials()
      expect(creds).toEqual({
        apiKey: 'apca-key',
        apiSecret: 'apca-secret',
        paper: true
      })
    })
  })

  describe('User broker client isolation', () => {
    it('returns null when user has no broker account', async () => {
      vi.spyOn(workerPrisma.brokerAccount, 'findUnique').mockResolvedValue(null)
      const client = await getBrokerClient('user-without-broker')
      expect(client).toBeNull()
    })

    it('safely handles corrupted or invalid ciphertext for User A without throwing or affecting User B', async () => {
      const userA = 'user-corrupted-creds'
      const userB = 'user-valid-creds'

      vi.spyOn(workerPrisma.brokerAccount, 'findUnique').mockImplementation(async ({ where }) => {
        if (where.userId === userA) {
          return {
            userId: userA,
            apiKey: 'invalid:garbage:ciphertext',
            apiSecret: 'invalid:garbage:ciphertext',
            paper: true,
            updatedAt: new Date()
          }
        }
        if (where.userId === userB) {
          return {
            userId: userB,
            apiKey: encrypt('valid-user-b-key'),
            apiSecret: encrypt('valid-user-b-secret'),
            paper: true,
            updatedAt: new Date()
          }
        }
        return null
      })

      // User A call should not throw; returns null gracefully
      const clientA = await getBrokerClient(userA)
      expect(clientA).toBeNull()

      // User B call should succeed despite User A failure
      const clientB = await getBrokerClient(userB)
      expect(clientB).not.toBeNull()
    })
  })
})
