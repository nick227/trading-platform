/**
 * seed-user-zero.js
 *
 * Creates the first real user ("user zero") using credentials from .env,
 * stores their Alpaca API keys in BrokerAccount (encrypted), and re-links
 * all existing Portfolio / Execution / Bot records from STUB_USER_ID to the
 * new user's ID.
 *
 * Usage:
 *   node scripts/seed-user-zero.js
 *
 * The script is idempotent — running it a second time skips creation if the
 * email already exists, and skips re-linking if records already point to the
 * real user ID.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

// ── Constants ────────────────────────────────────────────────────────────────

const STUB_USER_ID = 'usr_stub_demo'

// Default credentials for user zero — override via env or edit here.
const USER_EMAIL    = process.env.SEED_EMAIL    || 'admin@tradingplatform.local'
const USER_PASSWORD = process.env.SEED_PASSWORD || 'changeme123'
const USER_FULLNAME = process.env.SEED_FULLNAME || 'Admin User'

// ── Encryption helpers (mirrors server/src/utils/encryption.js) ──────────────

const ALGO = 'aes-256-gcm'
const KEY  = Buffer.from(process.env.ENCRYPTION_KEY, 'hex') // 32 bytes

function encrypt(plaintext) {
  const iv      = randomBytes(12)
  const cipher  = createCipheriv(ALGO, KEY, iv)
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag     = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const alpacaKey    = process.env.ALPACA_API_KEY
  const alpacaSecret = process.env.ALPACA_API_SECRET

  if (!alpacaKey || !alpacaSecret) {
    console.error('ALPACA_API_KEY / ALPACA_API_SECRET not set in .env')
    process.exit(1)
  }

  // 1. Create (or find) the user ─────────────────────────────────────────────
  let user = await prisma.user.findUnique({ where: { email: USER_EMAIL } })

  if (user) {
    console.log(`User already exists: ${user.id} (${user.email})`)
  } else {
    const passwordHash = await bcrypt.hash(USER_PASSWORD, 12)
    user = await prisma.user.create({
      data: {
        email:        USER_EMAIL,
        passwordHash,
        fullName:     USER_FULLNAME,
        subscription: {
          create: {
            status: 'ACTIVE',
            plan:   'BASIC',
            endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
          }
        }
      }
    })
    console.log(`Created user: ${user.id} (${user.email})`)
    console.log(`  Password: ${USER_PASSWORD}`)
  }

  const userId = user.id

  // 2. Create (or update) BrokerAccount ─────────────────────────────────────
  const existingBroker = await prisma.brokerAccount.findUnique({ where: { userId } })

  if (existingBroker) {
    console.log(`BrokerAccount already exists for user ${userId}`)
  } else {
    await prisma.brokerAccount.create({
      data: {
        id:            generateId('bkr'),
        userId,
        broker:        'alpaca',
        apiKey:        encrypt(alpacaKey),
        apiSecret:     encrypt(alpacaSecret),
        paper:         process.env.ALPACA_PAPER === 'true',
        status:        'active',
        lastVerifiedAt: new Date()
      }
    })
    console.log(`Created BrokerAccount for user ${userId}`)
  }

  // 3. Create Portfolio if none exists for this user ─────────────────────────
  const existingPortfolio = await prisma.portfolio.findFirst({ where: { userId } })

  let portfolioId
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id
    console.log(`Portfolio already exists for user ${userId}: ${portfolioId}`)
  } else {
    // Check if there's a stub portfolio we can re-link
    const stubPortfolio = await prisma.portfolio.findFirst({ where: { userId: STUB_USER_ID } })
    if (stubPortfolio) {
      portfolioId = stubPortfolio.id
      console.log(`Will re-link stub portfolio ${portfolioId} to user ${userId}`)
    } else {
      portfolioId = generateId('prt')
      await prisma.portfolio.create({
        data: { id: portfolioId, userId, name: 'Main Portfolio' }
      })
      console.log(`Created new Portfolio: ${portfolioId}`)
    }
  }

  // 4. Re-link all stub records to real user ─────────────────────────────────

  // Portfolios
  const portfolioUpdate = await prisma.portfolio.updateMany({
    where: { userId: STUB_USER_ID },
    data:  { userId }
  })
  if (portfolioUpdate.count > 0)
    console.log(`Re-linked ${portfolioUpdate.count} Portfolio record(s)`)

  // Executions
  const execUpdate = await prisma.execution.updateMany({
    where: { userId: STUB_USER_ID },
    data:  { userId }
  })
  if (execUpdate.count > 0)
    console.log(`Re-linked ${execUpdate.count} Execution record(s)`)

  // Bots
  const botUpdate = await prisma.bot.updateMany({
    where: { userId: STUB_USER_ID },
    data:  { userId }
  })
  if (botUpdate.count > 0)
    console.log(`Re-linked ${botUpdate.count} Bot record(s)`)

  // BotRuns
  const botRunUpdate = await prisma.botRun.updateMany({
    where: { userId: STUB_USER_ID },
    data:  { userId }
  })
  if (botRunUpdate.count > 0)
    console.log(`Re-linked ${botRunUpdate.count} BotRun record(s)`)

  // ExecutionAudits
  const auditUpdate = await prisma.executionAudit.updateMany({
    where: { userId: STUB_USER_ID },
    data:  { userId }
  })
  if (auditUpdate.count > 0)
    console.log(`Re-linked ${auditUpdate.count} ExecutionAudit record(s)`)

  console.log('\nDone. Login credentials:')
  console.log(`  Email:    ${USER_EMAIL}`)
  console.log(`  Password: ${USER_PASSWORD}`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
