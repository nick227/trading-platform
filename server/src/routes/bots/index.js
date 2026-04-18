import botsRoutes from './bots.js'
import catalogRoutes from './catalog.js'
import botEventsRoutes from './events.js'
import botRulesRoutes from './rules.js'

export default async function botRoutes(app, opts) {
  // Static sub-paths first so Fastify doesn't treat "catalog" as a bot :id
  await app.register(catalogRoutes, { prefix: '/catalog' })
  await app.register(botsRoutes, { prefix: '' })
  await app.register(botEventsRoutes, { prefix: '/:id/events' })
  await app.register(botRulesRoutes, { prefix: '/:id/rules' })
}
