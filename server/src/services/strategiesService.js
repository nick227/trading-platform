import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

export default {
  async createStrategy(data) {
    const strategy = await prisma.strategy.create({
      data: {
        id: generateId(ID_PREFIXES.STRATEGY),
        name: data.name,
        description: data.description,
        type: data.type
      }
    })
    return strategy
  },

  async getStrategies(query) {
    const { type, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = {}
    if (type) where.type = type

    const strategies = await prisma.strategy.findMany({
      where,
      include: {
        _count: {
          select: {
            predictions: true,
            bots: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.strategy.count({ where })

    return {
      data: strategies,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  },

  async getStrategy(id) {
    return prisma.strategy.findUnique({
      where: { id },
      include: {
        predictions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        bots: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            predictions: true,
            bots: true
          }
        }
      }
    })
  },

  async updateStrategy(id, data) {
    return prisma.strategy.update({
      where: { id },
      data
    })
  },

  async deleteStrategy(id) {
    // Check if strategy is being used
    const [predictionsCount, botsCount] = await Promise.all([
      prisma.prediction.count({ where: { strategyId: id } }),
      prisma.bot.count({ where: { strategyId: id, deletedAt: null } })
    ])

    if (predictionsCount > 0 || botsCount > 0) {
      throw new Error('Cannot delete strategy with existing predictions or active bots')
    }

    return prisma.strategy.delete({
      where: { id }
    })
  }
}
