import botsRoutes from './bots.js'
import botEventsRoutes from './events.js'
import botRulesRoutes from './rules.js'

export default async function botRoutes(app, opts) {
  await app.register(botsRoutes, { prefix: '' })
  await app.register(botEventsRoutes, { prefix: '/:id/events' })
  await app.register(botRulesRoutes, { prefix: '/:id/rules' })
}
