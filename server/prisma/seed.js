import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const prisma = new PrismaClient()
const __dir  = dirname(fileURLToPath(import.meta.url))

async function main() {
  const templates = JSON.parse(
    readFileSync(join(__dir, 'seeds/bot-templates.json'), 'utf8')
  )

  for (const template of templates) {
    await prisma.botTemplate.upsert({
      where:  { id: template.id },
      update: {
        name:        template.name,
        description: template.description,
        botType:     template.botType,
        config:      template.config,
        rules:       template.rules,
        tags:        template.tags ?? null
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

  console.log(`[seed] done — ${templates.length} template(s) seeded`)
}

main()
  .catch(err => { console.error('[seed] error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
