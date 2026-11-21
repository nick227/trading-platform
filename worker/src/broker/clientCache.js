import { AlpacaClient } from './alpacaClient.js'
import prisma from '../db/prisma.js'
import { decrypt } from '../../../server/src/utils/encryption.js'
import { simulationConfig } from '../../../server/src/services/simulationService.js'
import { getSimulatedBroker } from './simulatedBroker.js'

// Per-user AlpacaClient cache.
// Shared by the order worker and the bot engine — single source of truth for broker clients.
const cache = new Map()

// How often to re-check the DB for credential rotation.
const CREDENTIAL_CHECK_INTERVAL_MS = 60_000

export async function getBrokerClient(userId) {
  if (!userId) return null
  // Simulator mode: only the internal replay simulator, never an Alpaca client.
  if (simulationConfig().enabled) return getSimulatedBroker(userId)

  const cached = cache.get(userId)
  if (cached && Date.now() - cached.checkedAt < CREDENTIAL_CHECK_INTERVAL_MS) {
    return cached.client
  }

  const account = await prisma.brokerAccount.findUnique({ where: { userId } })
  if (!account || !account.apiKey || !account.apiSecret) return null

  // Rebuild only if credentials changed (or first use)
  if (cached && account.updatedAt <= cached.accountUpdatedAt) {
    return cached.client
  }

  try {
    const apiKey = decrypt(account.apiKey)
    const apiSecret = decrypt(account.apiSecret)
    if (!apiKey || !apiSecret) {
      return null
    }

    const client = new AlpacaClient({
      apiKey,
      apiSecret,
      paper: account.paper !== false
    })

    cache.set(userId, { client, checkedAt: Date.now(), accountUpdatedAt: account.updatedAt })
    return client
  } catch (err) {
    console.error(`[broker] Failed to initialize broker client for user ${userId}:`, err.message)
    return null
  }
}

// Invalidate a specific user's cached client (call after credential update)
export function invalidateClient(userId) {
  cache.delete(userId)
}

export function clearClientCache() {
  cache.clear()
}
