import fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import compression from '../middleware/compression.js'
import caching from '../middleware/caching.js'

export default async function createApp() {
  const app = fastify({
    logger: true
  })

  // CORS setup for development
  await app.register(cors, {
    origin: true,
    credentials: true
  })

  await app.register(cookie)

  const isVitest = process.env.VITEST_WORKER_ID != null || process.argv.some((arg) => arg.includes('vitest'))

  // In production we expect an explicit JWT_SECRET. For tests we allow a fallback so the
  // app can bootstrap without loading dotenv (tests import createApp directly).
  const jwtSecret = process.env.JWT_SECRET ?? ((isVitest || process.env.NODE_ENV !== 'production') ? 'dev_jwt_secret' : null)
  await app.register(jwt, {
    secret: jwtSecret,
    cookie: { cookieName: 'access_token', signed: false }
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

  await app.register(compression)
  await app.register(caching)

  return app
}
