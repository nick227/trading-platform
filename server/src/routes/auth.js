import bcrypt from 'bcryptjs'
import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'

export default async function authRoutes(fastify) {
  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const { email, password, fullName } = request.body ?? {}
    if (!email || !password || !fullName) {
      return reply.code(400).send({ error: 'email, password, and fullName are required' })
    }

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

    const user = await prisma.user.findUnique({
      where: { email },
      include: { subscription: true }
    })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const token = fastify.jwt.sign({ sub: user.id }, { expiresIn: '7d' })
    reply.setCookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
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
