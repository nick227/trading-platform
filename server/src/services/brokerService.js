import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { encrypt } from '../utils/encryption.js'

export default {
  async createBrokerAccount({ userId, apiKey, apiSecret, paper = true }) {
    const encryptedApiKey = encrypt(apiKey)
    const encryptedApiSecret = encrypt(apiSecret)

    // Upsert — user can only have one broker account
    return prisma.brokerAccount.upsert({
      where: { userId },
      update: { apiKey: encryptedApiKey, apiSecret: encryptedApiSecret, paper, status: 'active', lastVerifiedAt: new Date() },
      create: {
        id: generateId(ID_PREFIXES.BROKER),
        userId,
        broker: 'alpaca',
        apiKey: encryptedApiKey,
        apiSecret: encryptedApiSecret,
        paper,
        status: 'active',
        lastVerifiedAt: new Date()
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
    apiKey: '••••••••••••',
    apiSecret: '••••••••••••••••'
  }
}
