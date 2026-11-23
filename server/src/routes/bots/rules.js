import prisma from '../../loaders/prisma.js'

export default async function botRulesRoutes(app, opts) {
  async function assertBotOwned(botId, request, reply) {
    const bot = await prisma.bot.findFirst({ where: { id: botId, deletedAt: null } })
    if (!bot || bot.userId !== request.user.id) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      return null
    }
    return bot
  }

  // GET /api/bots/:id/rules
  app.get('/', async (request, reply) => {
    const { id: botId } = request.params
    const { type, enabled, offset = 0, limit = 50 } = request.query

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { botId }
    if (type) where.type = type
    if (enabled !== undefined) where.enabled = enabled === 'true'

    const rules = await prisma.botRule.findMany({
      where,
      include: {
        bot: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.botRule.count({ where })

    return {
      data: rules,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  })

  // GET /api/bots/:id/rules/:ruleId
  app.get('/:ruleId', async (request, reply) => {
    const { id: botId, ruleId } = request.params

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const rule = await prisma.botRule.findUnique({
      where: { id: ruleId },
      include: { bot: true }
    })

    if (!rule || rule.botId !== botId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
    }

    return { data: rule }
  })

}
