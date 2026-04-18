import fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

export default async function createApp() {
  const app = fastify({
    logger: true
  })

  // Swagger setup
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Alpha Trader API',
        version: '1.0.0'
      }
    }
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  })

  return app
}
