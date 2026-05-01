import prisma from '../loaders/prisma.js'
import { Prisma } from '@prisma/client'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

export default {
  async createStrategy(data) {
    return prisma.strategy.create({
      data: {
        id: generateId(ID_PREFIXES.STRATEGY),
        name: data.name,
        description: data.description,
        type: data.type
      }
    })
  },

  async getStrategies(query) {
    const { type, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = {}
    if (type) where.type = type

    const [strategies, total] = await Promise.all([
      prisma.strategy.findMany({
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
      }),
      prisma.strategy.count({ where })
    ])

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

  async getPlatformStrategies({ sort = 'totalPnl', order = 'desc' } = {}) {
    const ORDER_MAP = {
      totalPnl: 'totalPnl',
      winRate: 'winRate',
      subscriberCount: 'subscriberCount',
      avgPnlPerSubscriber: 'avgPnlPerSubscriber',
      tradeCount: 'tradeCount',
    }
    const col = Prisma.raw(ORDER_MAP[sort] ?? 'totalPnl')
    const dir = Prisma.raw(order === 'asc' ? 'ASC' : 'DESC')

    const rows = await prisma.$queryRaw`
      SELECT
        bt.id,
        bt.name,
        bt.description,
        bt.botType,
        COUNT(DISTINCT b.userId)                                       AS subscriberCount,
        COUNT(DISTINCT CASE WHEN b.enabled = 1 THEN b.userId END)     AS activeSubscriberCount,
        COALESCE(SUM(ea.totalPnl), 0)                                  AS totalPnl,
        COALESCE(SUM(ea.tradeCount), 0)                                AS tradeCount,
        COALESCE(
          SUM(ea.wins) / NULLIF(SUM(ea.tradeCount), 0) * 100,
          0
        )                                                              AS winRate,
        COALESCE(
          SUM(ea.totalPnl) / NULLIF(COUNT(DISTINCT b.userId), 0),
          0
        )                                                              AS avgPnlPerSubscriber,
        CASE
          WHEN COUNT(CASE WHEN b.enabled = 1 THEN 1 END) > 0 THEN 'running'
          ELSE 'stopped'
        END                                                            AS status
      FROM BotTemplate bt
      LEFT JOIN Bot b ON b.templateId = bt.id AND b.deletedAt IS NULL
      LEFT JOIN (
        SELECT botId,
               COUNT(*)     AS tradeCount,
               SUM(pnl)     AS totalPnl,
               SUM(pnl > 0) AS wins
        FROM Execution
        WHERE status = 'filled' AND pnl IS NOT NULL
        GROUP BY botId
      ) ea ON ea.botId = b.id
      GROUP BY bt.id, bt.name, bt.description, bt.botType
      ORDER BY ${col} ${dir}, bt.id ASC
    `

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      botType: r.botType,
      subscriberCount: Number(r.subscriberCount),
      activeSubscriberCount: Number(r.activeSubscriberCount),
      totalPnl: Number(r.totalPnl),
      winRate: Number(r.winRate),
      tradeCount: Number(r.tradeCount),
      avgPnlPerSubscriber: Number(r.avgPnlPerSubscriber),
      status: r.status,
    }))
  },

  async getStrategyHistory(templateId, query = {}) {
    const take = Math.min(parseInt(query.limit ?? 100), 200)
    const skip = Math.max(parseInt(query.offset ?? 0), 0)

    const where = {
      bot: { templateId, deletedAt: null },
      status: 'filled'
    }

    const [executions, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        select: {
          id: true,
          ticker: true,
          direction: true,
          quantity: true,
          price: true,
          filledPrice: true,
          filledQuantity: true,
          filledAt: true,
          pnl: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip
      }),
      prisma.execution.count({ where })
    ])

    return {
      data: executions,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
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
