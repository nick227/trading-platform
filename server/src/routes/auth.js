import bcrypt from 'bcryptjs'
import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { AuthThrottle } from '../middleware/authThrottle.js'

export default async function authRoutes(fastify, opts = {}) {
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieSameSite = isProduction ? 'none' : 'lax'

  // request.ip is the real client only when trustProxy is configured (see authThrottle.js).
  const throttle = opts.throttle ?? new AuthThrottle({ clientIpTrusted: Boolean(fastify.clientIpTrusted) })
  const sweep = setInterval(() => throttle.sweep(), 5 * 60_000)
  sweep.unref?.()
  fastify.addHook('onClose', async () => clearInterval(sweep))

  const tooMany = (reply, wait, error) => {
    reply.request.log.warn({ retryAfterSeconds: wait }, 'auth_throttled') // no email, no address
    reply.header('Retry-After', String(wait))
    return reply.code(429).send({ error, retryAfterSeconds: wait })
  }

  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const { email, password, fullName } = request.body ?? {}
    if (!email || !password || !fullName) {
      return reply.code(400).send({ error: 'email, password, and fullName are required' })
    }

    const who = { ip: request.ip, email }
    const wait = throttle.retryAfter('register', who)
    if (wait > 0) return tooMany(reply, wait, 'Too many sign-up attempts. Please try again later.')
    throttle.record('register', who)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return reply.code(409).send({ error: 'Email already registered' })

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        subscription: {
          create: {
            status: 'ACTIVE',
            plan: 'BASIC',
            endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30-day trial
          }
        }
      }
    })

    return reply.code(201).send({ id: user.id, email: user.email, fullName: user.fullName })
  })

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body ?? {}
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' })
    }

    const who = { ip: request.ip, email }
    const wait = throttle.retryAfter('login', who)
    if (wait > 0) return tooMany(reply, wait, 'Too many failed sign-in attempts. Please wait a few minutes and try again.')

    const user = await prisma.user.findUnique({
      where: { email },
      include: { subscription: true }
    })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throttle.record('login', who)
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    throttle.clear(who)

    const token = fastify.jwt.sign({ sub: user.id }, { expiresIn: '7d' })
    reply.setCookie('access_token', token, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60
    })

    return { id: user.id, email: user.email, fullName: user.fullName }
  })

  // GET /api/auth/client-address — proxy-chain diagnostic for setting TRUST_PROXY.
  // Off (404) unless CLIENT_ADDRESS_PROBE_KEY is set; the caller must send that key.
  // Reports only what this request carried, never stored and never logged.
  fastify.get('/client-address', async (request, reply) => {
    const key = process.env.CLIENT_ADDRESS_PROBE_KEY
    if (!key || request.headers['x-probe-key'] !== key) return reply.code(404).send({ error: 'Not Found' })
    return {
      socket: request.socket?.remoteAddress ?? null,
      xForwardedFor: request.headers['x-forwarded-for'] ?? null,
      xRealIp: request.headers['x-real-ip'] ?? null,
      clientIpTrusted: Boolean(fastify.clientIpTrusted),
      ip: request.ip,
      ips: request.ips ?? null,
    }
  })

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('access_token', { path: '/' })
    return { ok: true }
  })

  // GET /api/auth/me  — returns current user from cookie
  fastify.get('/me', { preHandler: [authenticate] }, async (request) => {
    const { id, email, fullName, subscription } = request.user
    return { id, email, fullName, plan: subscription?.plan, subscriptionStatus: subscription?.status }
  })
}
