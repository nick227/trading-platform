import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { STUB_USER_ID } from '../utils/auth.js'

export default {
  async createPortfolio(data) {
    const portfolio = await prisma.portfolio.create({
      data: {
        id: generateId(ID_PREFIXES.PORTFOLIO),
        userId: data.userId || STUB_USER_ID,
        name: data.name
      }
    })
    return portfolio
  },

  async getPortfolios(query) {
    const { userId = STUB_USER_ID, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: {
        _count: {
          select: {
            executions: true,
            bots: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.portfolio.count({
      where: { userId }
    })

    return {
      data: portfolios,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  },

  async getPortfolio(id) {
    return prisma.portfolio.findUnique({
      where: { id },
      include: {
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        bots: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            executions: true,
            bots: true
          }
        }
      }
    })
  },

  async updatePortfolio(id, data) {
    return prisma.portfolio.update({
      where: { id },
      data
    })
  },

  async deletePortfolio(id) {
    // Soft delete by checking if there are dependent records
    const [executionsCount, botsCount] = await Promise.all([
      prisma.execution.count({ where: { portfolioId: id } }),
      prisma.bot.count({ where: { portfolioId: id, deletedAt: null } })
    ])

    if (executionsCount > 0 || botsCount > 0) {
      throw new Error('Cannot delete portfolio with existing executions or active bots')
    }

    return prisma.portfolio.delete({
      where: { id }
    })
  }
}
