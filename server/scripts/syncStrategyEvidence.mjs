import { generateStrategyEvidence, getPublicStrategy } from '../src/services/strategyEvidenceService.js'

async function run() {
  console.log('Generating strategy evidence snapshots...')
  const res = await generateStrategyEvidence()
  console.log('Result:', res)
  const s = await getPublicStrategy('tmpl_ai_catalyst_momentum')
  console.log('Strategy:', s?.name, '| Backtestable:', s?.version?.backtestable, '| Reason:', s?.version?.reason)
  console.log('5Y status:', s?.summary?.['5Y']?.status, '| reason:', s?.summary?.['5Y']?.reason)
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
