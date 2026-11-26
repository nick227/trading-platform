/**
 * At-most-one provider call per unique research input.
 * No order creation: execution is an independent explicit lifecycle stage.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { getProvider } from './providers/providerRegistry.js'
import { createDefaultStockTraderContextRegistry } from './stockTraderContext.js'
import { STOCK_TRADER_PROMPT_VERSION, buildStockTraderPrompts, validateStockTraderDecision } from './strategies/stockTraderDecision.js'

export async function runStockTraderResearch({
  bot,
  portfolio,
  screening,
  portfolioSnapshot,
  prismaClient = prisma,
  provider = null,
  providerName = 'openai',
  registry = createDefaultStockTraderContextRegistry()
}) {
  if (!bot?.id || !bot?.portfolioId || !portfolio?.id || portfolio.id !== bot.portfolioId) {
    throw new Error('AI research bot/portfolio identity mismatch')
  }
  if (bot.enabled !== true || bot.config?.mode !== 'paper') {
    throw new Error('AI stock trader must be an enabled paper bot')
  }
  if (!screening?.asOfSession) throw new Error('Screening session missing')
  const config = bot.config
  const snapshot = await registry.assemble({
    session: screening.asOfSession,
    input: { screening, portfolio: portfolioSnapshot, config },
    modules: config.research?.contextModules
  })
  const { systemPrompt, userPrompt } = buildStockTraderPrompts(snapshot)
  const model = config.model || 'gpt-4o-mini'
  const fingerprint = createHash('sha256').update(JSON.stringify({
    botId: bot.id, portfolioId: portfolio.id, providerName, model,
    promptVersion: STOCK_TRADER_PROMPT_VERSION,
    snapshotFingerprint: snapshot.fingerprint,
    systemPrompt, userPrompt
  })).digest('hex')
  const eventId = `req_stock_${fingerprint.slice(0, 32)}`
  const cached = await prismaClient.botEvent.findUnique({ where: { id: eventId } })
  if (cached) {
    if (cached.botId !== bot.id || cached.portfolioId !== portfolio.id) {
      throw new Error('AI research cache ownership mismatch')
    }
    if (cached.metadata?.status === 'completed' && cached.metadata?.decision) {
      return { ok: true, cached: true, eventId, snapshot, decision: cached.metadata.decision }
    }
    return { ok: false, skipped: true, reason: 'research_claim_exists', eventId }
  }

  const token = randomUUID()
  try {
    await prismaClient.botEvent.create({
      data: {
        id: eventId, botId: bot.id, portfolioId: portfolio.id,
        type: 'signal_hold', ruleId: token,
        detail: `Stock trader research claim: ${screening.asOfSession}`,
        metadata: {
          status: 'in_progress', fingerprint, claimedAt: new Date().toISOString()
        }
      }
    })
  } catch {
    // Another caller won the unique claim. Never call the provider twice.
    return { ok: false, skipped: true, reason: 'concurrent_claim', eventId }
  }

  try {
    const client = provider || getProvider(providerName)
    const response = await client.completeStructured({
      systemPrompt, userPrompt, model, temperature: 0.2
    })
    const decision = validateStockTraderDecision(response.structured, snapshot)
    const publish = await prismaClient.botEvent.updateMany({
      where: { id: eventId, ruleId: token },
      data: {
        type: 'decision_made',
        detail: `AI Stock Trader [${snapshot.asOfSession}]: ${decision.actionable.length} proposed trades`,
        metadata: {
          status: 'completed',
          fingerprint,
          strategy: config.strategyId,
          strategyVersion: config.strategyVersion,
          promptVersion: STOCK_TRADER_PROMPT_VERSION,
          providerName,
          model: response.model || model,
          usage: response.usage || null,
          snapshot,
          decision
        }
      }
    })
    if (publish.count !== 1) throw new Error('Lost AI research claim ownership')
    return { ok: true, cached: false, eventId, snapshot, decision }
  } catch (error) {
    await prismaClient.botEvent.updateMany({
      where: { id: eventId, ruleId: token },
      data: {
        type: 'strategy_error',
        detail: `AI Stock Trader research failed: ${String(error.message).slice(0, 140)}`,
        metadata: { status: 'failed', fingerprint, failure: String(error.message).slice(0, 500) }
      }
    })
    throw error
  }
}
