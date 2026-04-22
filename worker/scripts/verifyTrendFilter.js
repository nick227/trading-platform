import dotenv from 'dotenv'
import prisma from '../src/db/prisma.js'
import { evaluateTrendFilter } from '../src/engine/rules/trendFilter.js'

dotenv.config({ path: new URL('../../server/.env', import.meta.url) })

async function main() {
  const latest = await prisma.marketRegime.findFirst({
    where: { symbol: 'SPY' },
    orderBy: { asOf: 'desc' }
  })
  if (!latest) throw new Error('No MarketRegime row found for SPY')

  const original = latest.inputsJson ?? {}
  const asOf = latest.asOf

  const passResult = await evaluateTrendFilter({
    symbol: 'SPY',
    confirmationBars: 2,
    maxSnapshotAgeHours: 90,
    side: 'buy'
  })

  await prisma.marketRegime.update({
    where: { symbol_asOf: { symbol: 'SPY', asOf } },
    data: { inputsJson: { ...(original ?? {}), confirmedBars: 1 } }
  })

  const failResult = await evaluateTrendFilter({
    symbol: 'SPY',
    confirmationBars: 2,
    maxSnapshotAgeHours: 90,
    side: 'buy'
  })

  await prisma.marketRegime.update({
    where: { symbol_asOf: { symbol: 'SPY', asOf } },
    data: { inputsJson: original }
  })

  console.log(JSON.stringify({
    asOf: asOf.toISOString(),
    originalConfirmedBars: original?.confirmedBars ?? null,
    passResult,
    failResult
  }, null, 2))
}

main()
  .catch((err) => {
    console.error('[verifyTrendFilter] error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

