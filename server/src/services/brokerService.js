import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

export default {
  async createBrokerAccount({ userId, apiKey, apiSecret, paper = true }) {
    // Upsert — user can only have one broker account
    return prisma.brokerAccount.upsert({
      where: { userId },
      update: { apiKey, apiSecret, paper },
      create: {
        id: generateId(ID_PREFIXES.BROKER),
        userId,
        apiKey,
        apiSecret,
        paper
      }
    })
  },

  // Returns the account with apiSecret masked — safe for API responses
  async getBrokerAccount(userId) {
    const account = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (!account) return null
    return maskSecret(account)
  },

  // Returns full account with secret — for internal worker use only, never exposed via HTTP
  async getBrokerAccountInternal(userId) {
    return prisma.brokerAccount.findUnique({ where: { userId } })
  },

  async deleteBrokerAccount(userId) {
    const account = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (!account) return null
    await prisma.brokerAccount.delete({ where: { userId } })
    return { deleted: true }
  }
}

function maskSecret(account) {
  return {
    ...account,
    apiKey: account.apiKey.slice(0, 4) + '••••••••••••',
    apiSecret: '••••••••••••••••'
  }
}
