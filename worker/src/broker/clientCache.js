import { AlpacaClient } from './alpacaClient.js'
import prisma from '../db/prisma.js'

// Per-user AlpacaClient cache: Map<userId, { client: AlpacaClient, updatedAt: Date }>
// Shared by the order worker and the bot engine — single source of truth for broker clients.
const cache = new Map()

export async function getBrokerClient(userId) {
  const account = await prisma.brokerAccount.findUnique({ where: { userId } })
  if (!account) return null

  const cached = cache.get(userId)
  if (cached && account.updatedAt <= cached.updatedAt) {
    return cached.client
  }

  // Build a new client — first use or credentials were rotated
  const client = new AlpacaClient({
    apiKey:    account.apiKey,
    apiSecret: account.apiSecret,
    paper:     account.paper
  })
  cache.set(userId, { client, updatedAt: account.updatedAt })
  return client
}

// Invalidate a specific user's cached client (call after credential update)
export function invalidateClient(userId) {
  cache.delete(userId)
}
