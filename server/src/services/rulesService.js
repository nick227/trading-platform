import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

export default {
  async createRule(botId, data) {
    const rule = await prisma.botRule.create({
      data: {
        id: generateId(ID_PREFIXES.RULE),
        botId,
        type: data.type,
        order: data.order,
        enabled: data.enabled ?? true,
        config: data.config ?? {}
      }
    })
    return rule
  },

  async getBotRules(botId) {
    return prisma.botRule.findMany({
      where: { botId },
      orderBy: { order: 'asc' }
    })
  },

  async updateRule(ruleId, data) {
    const updateData = {}
    
    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled
    }

    if (data.order !== undefined) {
      updateData.order = data.order
    }

    if (data.config !== undefined) {
      updateData.config = data.config
    }

    return prisma.botRule.update({
      where: { id: ruleId },
      data: updateData
    })
  },

  async deleteRule(ruleId) {
    return prisma.botRule.delete({
      where: { id: ruleId }
    })
  },

  async replaceBotRules(botId, rules) {
    return prisma.$transaction(async (tx) => {
      // Delete all existing rules
      await tx.botRule.deleteMany({
        where: { botId }
      })

      // Create new rules with provided order
      const createdRules = await Promise.all(
        rules.map((rule, index) => 
          tx.botRule.create({
            data: {
              id: generateId(ID_PREFIXES.RULE),
              botId,
              type: rule.type,
              order: index + 1, // 1-based ordering
              enabled: rule.enabled ?? true,
              config: rule.config ?? {}
            }
          })
        )
      )

      return createdRules
    })
  },

  async getRule(ruleId) {
    return prisma.botRule.findUnique({
      where: { id: ruleId }
    })
  },

  async enableRule(ruleId) {
    return prisma.botRule.update({
      where: { id: ruleId },
      data: { enabled: true }
    })
  },

  async disableRule(ruleId) {
    return prisma.botRule.update({
      where: { id: ruleId },
      data: { enabled: false }
    })
  }
}
