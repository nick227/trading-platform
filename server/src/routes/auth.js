import bcrypt from 'bcryptjs'
import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { loginRateLimiter, registerRateLimiter } from '../middleware/rateLimiter.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validatePassword(password) {
  if (typeof password !== 'string') return { ok: false, error: 'Password must be a string' }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters long' }
  if (password.length > 128) return { ok: false, error: 'Password cannot exceed 128 characters' }
  // Require at least letters and numbers
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: 'Password must contain both letters and numbers' }
  }
  return { ok: true }
}

export default async function authRoutes(fastify) {
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieSameSite = isProduction ? 'none' : 'lax'

  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const ip = request.ip || 'unknown'
    if (registerRateLimiter.isLimited(ip)) {
      reply.header('Retry-After', String(registerRateLimiter.timeRemainingSec(ip)))
      return reply.code(429).send({ error: 'Too many registration attempts from this network. Please try again later.' })
    }

    const { email, password, fullName } = request.body ?? {}
    if (!email || !password || !fullName) {
      return reply.code(400).send({ error: 'email, password, and fullName are required' })
    }

    const trimmedEmail = String(email).trim().toLowerCase()
    if (!EMAIL_RE.test(trimmedEmail)) {
      return reply.code(400).send({ error: 'Please enter a valid email address' })
    }

    const passCheck = validatePassword(password)
    if (!passCheck.ok) {
      return reply.code(400).send({ error: passCheck.error })
    }

    const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } })
    if (existing) {
      registerRateLimiter.recordAttempt(ip)
      return reply.code(409).send({ error: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        passwordHash,
        fullName: String(fullName).trim(),
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

    const ip = request.ip || 'unknown'
    const trimmedEmail = String(email).trim().toLowerCase()
    const rateLimitKey = `${ip}:${trimmedEmail}`

    if (loginRateLimiter.isLimited(rateLimitKey)) {
      const waitSec = loginRateLimiter.timeRemainingSec(rateLimitKey)
      reply.header('Retry-After', String(waitSec))
      return reply.code(429).send({ error: 'Too many failed login attempts. Please try again in 15 minutes.' })
    }

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: { subscription: true }
    })

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      loginRateLimiter.recordAttempt(rateLimitKey)
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    // Successful login: reset rate limit attempts for this user/IP
    loginRateLimiter.reset(rateLimitKey)

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
