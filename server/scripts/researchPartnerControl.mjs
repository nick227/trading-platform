
/**
 * Run from server/:
 *   node scripts/researchPartnerControl.mjs --preflight
 *   node scripts/researchPartnerControl.mjs --smoke-provider
 * Both are operator-only, and neither enables paid calls or autonomous trading.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import prisma from '../src/loaders/prisma.js'
import { inspectResearchPartnerReadiness } from '../src/services/researchPartner/readiness.js'
import { createResearchUsageGovernor } from '../src/services/researchPartner/usageGovernor.js'
import { getProvider } from '../src/services/ai/providers/providerRegistry.js'

const flag = process.argv[2]
if (!['--preflight', '--smoke-provider'].includes(flag) || process.argv.length !== 3) {
  console.error('Use --preflight or --smoke-provider')
  process.exitCode = 2
} else {
  try {
    const result = await inspectResearchPartnerReadiness({ db: prisma })
    if (flag === '--preflight') {
      console.log(JSON.stringify(result, null, 2))
      if (!result.dataReady) process.exitCode = 1
    } else {
      if (!result.modelReady) throw Error('Research Partner model calls are not ready; run --preflight')
      const governor = createResearchUsageGovernor()
      const userId = 'operator_smoke'
      const partnerId = 'operator_smoke'
      const model = process.env.RESEARCH_PARTNER_MODEL || 'gpt-4o-mini'
      const reservation = await governor.reserve({
        userId, partnerId, model, jobKey: 'rp_operator_smoke:' + randomUUID()
      })
      let settled = false
      try {
        const output = await getProvider('openai').completeStructured({
          model, maxTokens: 60, temperature: 0,
          systemPrompt: 'Return exactly a JSON object with ok=true. Do not discuss investments.',
          userPrompt: 'Respond with {"ok":true}.'
        })
        const receipt = await governor.settle(reservation, { usage: output.usage })
        settled = receipt?.settled === true
        if (!settled || output.structured?.ok !== true) throw Error('Provider smoke did not validate')
        console.log(JSON.stringify({ ok: true, model: output.model || model, paidCalls: 1 }))
      } catch (error) {
        if (!settled) await governor.settle(reservation, { uncertain: true }).catch(() => {})
        throw error
      }
    }
  } catch (error) {
    console.error('Research Partner operation failed:', error.message)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}
