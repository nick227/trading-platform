import dotenv from 'dotenv'
import prisma from '../src/loaders/prisma.js'

dotenv.config({ path: new URL('../.env', import.meta.url) })

const ID = process.env.TEMPLATE_ID ?? 'tmpl_spy_trend_filter'

async function main() {
  const row = await prisma.botTemplate.findUnique({ where: { id: ID } })
  console.log(JSON.stringify({
    found: !!row,
    id: row?.id ?? ID,
    name: row?.name ?? null,
    botType: row?.botType ?? null
  }, null, 2))
}

main()
  .catch((err) => {
    console.error('[verifyBotTemplate] error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

