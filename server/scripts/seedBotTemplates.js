#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const prisma = new PrismaClient()
const __dir = dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('[seed] Starting bot template seeding...')
  
  const templates = JSON.parse(
    readFileSync(join(__dir, '../prisma/seeds/bot-templates.json'), 'utf8')
  )

  console.log(`[seed] Found ${templates.length} templates to process`)

  for (const template of templates) {
    try {
      await prisma.botTemplate.upsert({
        where: { id: template.id },
        update: {
          name: template.name,
          description: template.description,
          botType: template.botType,
          config: template.config,
          rules: template.rules,
          tags: template.tags ?? null,
          updatedAt: new Date()
        },
        create: {
          id: template.id,
          name: template.name,
          description: template.description,
          botType: template.botType,
          config: template.config,
          rules: template.rules,
          tags: template.tags ?? null
        }
      })
      console.log(`[seed] ✓ Upserted template: ${template.id} - ${template.name}`)
    } catch (error) {
      console.error(`[seed] ✗ Failed to upsert template ${template.id}:`, error.message)
    }
  }

  // Verify templates were seeded
  const count = await prisma.botTemplate.count()
  console.log(`[seed] Complete! Total templates in database: ${count}`)
  
  // Show template breakdown by type
  const ruleBased = await prisma.botTemplate.count({ where: { botType: 'rule_based' } })
  const strategyBased = await prisma.botTemplate.count({ where: { botType: 'strategy_based' } })
  console.log(`[seed] Rule-based templates: ${ruleBased}`)
  console.log(`[seed] Strategy-based templates: ${strategyBased}`)
}

main()
  .catch(err => {
    console.error('[seed] Fatal error:', err)
    process.exit(1)
  })
  .finally(() => {
    prisma.$disconnect()
    console.log('[seed] Database connection closed')
  })
