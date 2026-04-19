import fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import cors from '@fastify/cors'

export default async function createApp() {
  const app = fastify({
    logger: true
  })

  // CORS setup for development
  await app.register(cors, {
    origin: true, // Allow all origins in development
    credentials: true
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
