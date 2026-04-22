import dotenv from 'dotenv'
import prisma from '../src/db/prisma.js'
import { evaluateTrendFilter } from '../src/engine/rules/trendFilter.js'

dotenv.config({ path: new URL('../../server/.env', import.meta.url) })

async function evalScenario({ regime, currentQty }) {
  const side = currentQty > 0 ? 'sell' : 'buy'
  const result = await evaluateTrendFilter({
    symbol: 'SPY',
    confirmationBars: 2,
    maxSnapshotAgeHours: 90,
    side
  })
  return { regime, currentQty, side, trendFilter: result }
}

async function main() {
  const latest = await prisma.marketRegime.findFirst({ where: { symbol: 'SPY' }, orderBy: { asOf: 'desc' } })
  if (!latest) throw new Error('No MarketRegime row found for SPY')

  const originalRegime = latest.regime
  const originalInputs = latest.inputsJson
  const asOf = latest.asOf

  try {
    // Ensure confirmedBars is high enough for deterministic pass when regime matches
    await prisma.marketRegime.update({
      where: { symbol_asOf: { symbol: 'SPY', asOf } },
      data: { inputsJson: { ...(originalInputs ?? {}), confirmedBars: 5 } }
    })

    await prisma.marketRegime.update({
      where: { symbol_asOf: { symbol: 'SPY', asOf } },
      data: { regime: 'risk_on' }
    })

    const scenarios = []
    scenarios.push(await evalScenario({ regime: 'risk_on', currentQty: 0 }))
    scenarios.push(await evalScenario({ regime: 'risk_on', currentQty: 10 }))

    await prisma.marketRegime.update({
      where: { symbol_asOf: { symbol: 'SPY', asOf } },
      data: { regime: 'risk_off' }
    })

    scenarios.push(await evalScenario({ regime: 'risk_off', currentQty: 10 }))
    scenarios.push(await evalScenario({ regime: 'risk_off', currentQty: 0 }))

    console.log(JSON.stringify({
      asOf: asOf.toISOString(),
      note: 'This script simulates currentQty (position awareness) without calling Alpaca. It does not enqueue orders.',
      scenarios
    }, null, 2))
  } finally {
    await prisma.marketRegime.update({
      where: { symbol_asOf: { symbol: 'SPY', asOf } },
      data: { regime: originalRegime, inputsJson: originalInputs }
    })
  }
}

main()
  .catch((err) => {
    console.error('[verifyTwoSidedMatrix] error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

