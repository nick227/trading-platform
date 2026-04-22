import dotenv from 'dotenv'
import prisma from '../src/loaders/prisma.js'

dotenv.config({ path: new URL('../.env', import.meta.url) })

async function main() {
  const asOf = new Date('2026-04-21T00:00:00.000Z')
  const rowsForDay = await prisma.marketRegime.count({ where: { symbol: 'SPY', asOf } })
  const total = await prisma.marketRegime.count({ where: { symbol: 'SPY' } })
  console.log(JSON.stringify({ rowsFor_2026_04_21: rowsForDay, totalSpYRows: total }, null, 2))
}

main()
  .catch((err) => {
    console.error('[verifyMarketRegime] error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

