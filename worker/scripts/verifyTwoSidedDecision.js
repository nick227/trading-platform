import dotenv from 'dotenv'
import prisma from '../src/db/prisma.js'
import { evaluateTrendFilter } from '../src/engine/rules/trendFilter.js'

dotenv.config({ path: new URL('../../server/.env', import.meta.url) })

async function main() {
  const latest = await prisma.marketRegime.findFirst({ where: { symbol: 'SPY' }, orderBy: { asOf: 'desc' } })
  if (!latest) throw new Error('No MarketRegime row found for SPY')

  const buyPass = await evaluateTrendFilter({ symbol: 'SPY', confirmationBars: 2, maxSnapshotAgeHours: 90, side: 'buy' })
  const sellPass = await evaluateTrendFilter({ symbol: 'SPY', confirmationBars: 2, maxSnapshotAgeHours: 90, side: 'sell' })

  console.log(JSON.stringify({
    asOf: latest.asOf.toISOString(),
    regime: latest.regime,
    confirmedBars: latest.inputsJson?.confirmedBars ?? null,
    buyPass,
    sellPass
  }, null, 2))
}

main()
  .catch((err) => {
    console.error('[verifyTwoSidedDecision] error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

