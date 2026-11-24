import fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import compression from '../middleware/compression.js'
import caching from '../middleware/caching.js'
import { trustProxyFromEnv } from '../middleware/authThrottle.js'

export default async function createApp({ trustProxy = trustProxyFromEnv() } = {}) {
  const app = fastify({
    logger: true,
    // Behind Railway: edge → web (app/serve.mjs) → API is 2 hops, so TRUST_PROXY=2.
    // Unset keeps request.ip = socket peer; auth throttling then uses account buckets only.
    trustProxy,
  })

  const isProduction = process.env.NODE_ENV === 'production'
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const origin = isProduction
    ? (corsOrigins.length ? corsOrigins : false)
    : true

  await app.register(cors, {
    origin,
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
