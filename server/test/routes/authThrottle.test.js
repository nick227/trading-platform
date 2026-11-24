// Auth throttling: account-aware, never a global lockout behind a shared proxy address.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import bcrypt from 'bcryptjs'
import fastify from 'fastify'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'

const users = new Map()
vi.mock('../../src/loaders/prisma.js', () => ({
  default: {
    user: {
      // MariaDB's default collation compares emails case-insensitively; mirror that.
      findUnique: async ({ where }) => [...users.values()].find((u) => u.email.toLowerCase() === where.email.toLowerCase()) ?? null,
      create: async ({ data }) => { const u = { id: `u${users.size + 1}`, ...data }; users.set(u.id, u); return u },
    },
  },
}))

const { default: authRoutes } = await import('../../src/routes/auth.js')
const { AuthThrottle, LIMITS, trustProxyFromEnv } = await import('../../src/middleware/authThrottle.js')

let clock = 1_000_000
async function build({ trustProxy }) {
  const app = fastify({ trustProxy })
  await app.register(cookie)
  await app.register(jwt, { secret: 'test', cookie: { cookieName: 'access_token', signed: false } })
  const throttle = new AuthThrottle({ clientIpTrusted: Boolean(trustProxy), now: () => clock })
  await app.register(authRoutes, { prefix: '/api/auth', throttle })
  await app.ready()
  return app
}
// The API sees: socket = web proxy, X-Forwarded-For = "<client>, <railway edge>".
const login = (app, email, password, client) => app.inject({
  method: 'POST', url: '/api/auth/login', payload: { email, password },
  remoteAddress: '10.0.0.5', headers: client ? { 'x-forwarded-for': `${client}, 10.0.0.9` } : {},
})

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('Right-pass-1', 4)
  users.set('a', { id: 'a', email: 'Alice@Example.test', passwordHash, fullName: 'A' })
  users.set('b', { id: 'b', email: 'bob@example.test', passwordHash, fullName: 'B' })
})
beforeEach(() => { clock = 1_000_000 })

describe('trustProxyFromEnv', () => {
  it('parses hop counts, booleans and address lists', () => {
    expect(trustProxyFromEnv(undefined)).toBe(false)
    expect(trustProxyFromEnv('0')).toBe(false)
    expect(trustProxyFromEnv('2')).toBe(2)
    expect(trustProxyFromEnv('true')).toBe(true)
    expect(trustProxyFromEnv('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1'])
  })
})

describe('login throttling without a trusted proxy (every request looks like the web proxy)', () => {
  let app
  beforeAll(async () => { app = await build({ trustProxy: false }) })
  afterAll(() => app.close())

  it('locks only the attacked account, never other users on the same address', async () => {
    for (let i = 0; i < LIMITS.loginAccount.max; i++) expect((await login(app, 'bob@example.test', 'wrong')).statusCode).toBe(401)
    const locked = await login(app, 'bob@example.test', 'Right-pass-1')
    expect(locked.statusCode).toBe(429)
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
    // Same apparent IP, different account: unaffected.
    expect((await login(app, 'alice@example.test', 'Right-pass-1')).statusCode).toBe(200)
    // Window passes → bob can sign in again.
    clock += LIMITS.loginAccount.windowMs + 1
    expect((await login(app, 'bob@example.test', 'Right-pass-1')).statusCode).toBe(200)
  })

  it('counts an account case-insensitively, and existing mixed-case emails still sign in', async () => {
    for (let i = 0; i < LIMITS.loginAccount.max; i++) await login(app, i % 2 ? 'ALICE@example.test' : ' alice@example.test', 'wrong')
    expect((await login(app, 'Alice@Example.test', 'Right-pass-1')).statusCode).toBe(429)
    clock += LIMITS.loginAccount.windowMs + 1
    expect((await login(app, 'Alice@Example.test', 'Right-pass-1')).statusCode).toBe(200)
  })

  it('a successful sign-in clears earlier failures', async () => {
    for (let i = 0; i < LIMITS.loginAccount.max - 1; i++) await login(app, 'bob@example.test', 'wrong')
    expect((await login(app, 'bob@example.test', 'Right-pass-1')).statusCode).toBe(200)
    for (let i = 0; i < LIMITS.loginAccount.max - 1; i++) expect((await login(app, 'bob@example.test', 'wrong')).statusCode).toBe(401)
  })
})

describe('login throttling behind the trusted Railway hops (TRUST_PROXY=2)', () => {
  let app
  beforeAll(async () => { app = await build({ trustProxy: 2 }) })
  afterAll(() => app.close())

  it('throttles one client hammering an account but not the owner on another address', async () => {
    for (let i = 0; i < LIMITS.loginClientAccount.max; i++) await login(app, 'bob@example.test', 'wrong', '203.0.113.7')
    expect((await login(app, 'bob@example.test', 'Right-pass-1', '203.0.113.7')).statusCode).toBe(429)
    expect((await login(app, 'bob@example.test', 'Right-pass-1', '198.51.100.4')).statusCode).toBe(200)
  })

  it('throttles one client spraying many accounts', async () => {
    for (let i = 0; i < LIMITS.loginClient.max; i++) await login(app, `user${i}@example.test`, 'wrong', '203.0.113.99')
    expect((await login(app, 'alice@example.test', 'Right-pass-1', '203.0.113.99')).statusCode).toBe(429)
    expect((await login(app, 'alice@example.test', 'Right-pass-1', '198.51.100.4')).statusCode).toBe(200)
  })
})

describe('registration throttling', () => {
  let app
  beforeAll(async () => { app = await build({ trustProxy: false }) })
  afterAll(() => app.close())
  const register = (email) => app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'Pass-word-1', fullName: 'N' }, remoteAddress: '10.0.0.5' })

  it('limits repeated attempts for one email, not sign-ups in general', { timeout: 30_000 }, async () => {
    expect((await register('new@example.test')).statusCode).toBe(201)
    for (let i = 1; i < LIMITS.registerEmail.max; i++) expect((await register('new@example.test')).statusCode).toBe(409)
    expect((await register('NEW@example.test')).statusCode).toBe(429)
    for (let i = 0; i < 3; i++) expect((await register(`fresh${i}@example.test`)).statusCode).toBe(201)
  })
})

describe('client-address probe', () => {
  let app
  beforeAll(async () => { app = await build({ trustProxy: false }) })
  afterAll(() => { delete process.env.CLIENT_ADDRESS_PROBE_KEY; return app.close() })

  it('is invisible unless its key is configured and sent', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/client-address' })).statusCode).toBe(404)
    process.env.CLIENT_ADDRESS_PROBE_KEY = 'k'
    expect((await app.inject({ method: 'GET', url: '/api/auth/client-address', headers: { 'x-probe-key': 'nope' } })).statusCode).toBe(404)
    const ok = await app.inject({ method: 'GET', url: '/api/auth/client-address', headers: { 'x-probe-key': 'k', 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '10.0.0.5' })
    expect(ok.json()).toMatchObject({ socket: '10.0.0.5', xForwardedFor: '1.2.3.4', ip: '10.0.0.5' })
  })
})

describe('TRUST_PROXY=railway (header shapes recorded on staging)', () => {
  let app
  beforeAll(async () => {
    app = fastify({ trustProxy: trustProxyFromEnv('railway') })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()
  })
  afterAll(() => app.close())
  const ip = async (remoteAddress, xff) => (await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} })).json().ip

  it('edge → API: the client, not the edge node', async () => {
    expect(await ip('::ffff:100.64.0.2', '136.62.60.81, 79.127.177.113')).toBe('136.62.60.81')
  })
  it('edge → web → API: the same client', async () => {
    expect(await ip('fd12:4257:2ddc:1:3000:10a:f12:c8e', '136.62.60.81, 79.127.177.114, ::ffff:100.64.0.2')).toBe('136.62.60.81')
  })
  it('a non-Railway peer cannot claim another address', async () => {
    expect(await ip('203.0.113.50', '6.6.6.6')).toBe('203.0.113.50')
    expect(await ip('100.128.0.1', '6.6.6.6')).toBe('100.128.0.1') // outside 100.64.0.0/10
  })
})

describe('createApp wiring', () => {
  it('TRUST_PROXY=railway turns on per-IP buckets in the auth routes', async () => {
    const { default: createApp } = await import('../../src/loaders/fastify.js')
    const app = await createApp({ trustProxy: trustProxyFromEnv('railway') })
    await app.register(authRoutes, { prefix: '/api/auth' })
    await app.ready()
    expect(app.clientIpTrusted).toBe(true)
    process.env.CLIENT_ADDRESS_PROBE_KEY = 'k'
    const r = await app.inject({ method: 'GET', url: '/api/auth/client-address', remoteAddress: '::ffff:100.64.0.2', headers: { 'x-probe-key': 'k', 'x-forwarded-for': '136.62.60.81, 79.127.177.113' } })
    delete process.env.CLIENT_ADDRESS_PROBE_KEY
    expect(r.json()).toMatchObject({ ip: '136.62.60.81', clientIpTrusted: true })
    await app.close()
  })
})
