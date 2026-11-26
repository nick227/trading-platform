import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const __dir  = dirname(fileURLToPath(import.meta.url))

async function main() {
  const templates = JSON.parse(
    readFileSync(join(__dir, 'seeds/bot-templates.json'), 'utf8')
  )

  const activeIds = templates.map(t => t.id)

  for (const template of templates) {
    await prisma.botTemplate.upsert({
      where:  { id: template.id },
      update: {
        name:        template.name,
        description: template.description,
        botType:     template.botType,
        config:      template.config,
        rules:       template.rules,
        tags:        template.tags ?? null,
        updatedAt:   new Date()
      },
      create: {
        id:          template.id,
        name:        template.name,
        description: template.description,
        botType:     template.botType,
        config:      template.config,
        rules:       template.rules,
        tags:        template.tags ?? null
      }
    })
    console.log(`[seed] upserted template: ${template.id}`)
  }

  // Prune any legacy or unsupported templates not in activeIds
  const deleted = await prisma.botTemplate.deleteMany({
    where: { id: { notIn: activeIds } }
  })
  if (deleted.count > 0) {
    console.log(`[seed] pruned ${deleted.count} obsolete template(s)`)
  }

  // Seed canonical platform user with admin role
  await prisma.user.upsert({
    where: { id: 'usr_platform_canonical' },
    update: {
      role: 'admin'
    },
    create: {
      id: 'usr_platform_canonical',
      email: 'tradeloom-ai@tradeloom.internal',
      fullName: 'TradeLoom AI System',
      role: 'admin',
      passwordHash: '$platform_system_locked_account$'
    }
  })
  console.log('[seed] ensured canonical system user (usr_platform_canonical) has admin role')

  // Seed initial human admin user
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@tradeloom.com'
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'AdminSecret123!'
  const passwordHash = await bcrypt.hash(adminPassword, 10)
  const endsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'admin'
    },
    create: {
      email: adminEmail,
      fullName: 'TradeLoom Administrator',
      role: 'admin',
      passwordHash,
      subscription: {
        create: {
          status: 'ACTIVE',
          plan: 'PRO',
          endsAt
        }
      }
    }
  })
  console.log(`[seed] ensured admin user: ${adminUser.email} (role: ${adminUser.role})`)

  console.log(`[seed] done — ${templates.length} template(s) active`)
}

main()
  .catch(err => { console.error('[seed] error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
