
import { randomUUID } from 'node:crypto'
import { getProvider } from '../ai/providers/providerRegistry.js'
import { createResearchUsageGovernor } from './usageGovernor.js'
import { proposeResearchMandate } from './mandateProposal.js'

/** Only explicitly requested previews make paid calls. No proposal is ever saved here. */
export function createMandateProposalRuntime({
  governor = createResearchUsageGovernor(), provider = null, env = process.env
} = {}) {
  return {
    async propose({ userId, partner, instructions, useAI = false }) {
      if (!partner?.id || !partner?.mandate?.content) throw new Error('Partner mandate missing')
      if (!useAI) return proposeResearchMandate({
        currentMandate: partner.mandate.content, instructions
      })
      if (!governor.enabled()) {
        const error = new Error('AI-assisted mandate proposals are not enabled')
        error.statusCode = 503
        throw error
      }
      const model = env.RESEARCH_PARTNER_MODEL || 'gpt-4o-mini'
      const reservation = await governor.reserve({
        userId, partnerId: partner.id,
        jobKey: 'rp_proposal:' + randomUUID(), model
      })
      let usage = null
      try {
        const client = provider || getProvider('openai')
        const proposal = await proposeResearchMandate({
          instructions, currentMandate: partner.mandate.content,
          invokeModel: async request => {
            const response = await client.completeStructured({
              ...request, model, temperature: 0.2
            })
            usage = response.usage
            return response
          }
        })
        const receipt = await governor.settle(reservation, { usage })
        if (receipt?.settled !== true) throw new Error('Research proposal AI usage settlement failed')
        return proposal
      } catch (error) {
        await governor.settle(reservation, { uncertain: true }).catch(() => {})
        throw error
      }
    }
  }
}
