import { AlpacaClient } from './alpacaClient.js'
import prisma from '../db/prisma.js'
import { decrypt } from '../../../server/src/utils/encryption.js'

// Per-user AlpacaClient cache.
// Shared by the order worker and the bot engine — single source of truth for broker clients.
const cache = new Map()

// How often to re-check the DB for credential rotation. Between checks, return
// the cached client without a DB hit. 60s matches the position-cache TTL so
// credential changes are visible within one position-reload cycle.
const CREDENTIAL_CHECK_INTERVAL_MS = 60_000

export async function getBrokerClient(userId) {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.checkedAt < CREDENTIAL_CHECK_INTERVAL_MS) {
    return cached.client
  }

  const account = await prisma.brokerAccount.findUnique({ where: { userId } })
  if (!account) return null

  // Rebuild only if credentials changed (or first use)
  const client = (cached && account.updatedAt <= cached.accountUpdatedAt)
    ? cached.client
    : new AlpacaClient({
        apiKey:    decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        paper:     account.paper
      })

  cache.set(userId, { client, checkedAt: Date.now(), accountUpdatedAt: account.updatedAt })
  return client
}

// Invalidate a specific user's cached client (call after credential update)
export function invalidateClient(userId) {
  cache.delete(userId)
}
