/**
 * At-most-one provider call per unique research input.
 * No order creation: execution is an independent explicit lifecycle stage.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { getProvider } from './providers/providerRegistry.js'
import { defaultAiBotDefinitionRegistry } from './botDefinitions.js'
import { runToolGuidedStockResearch } from './stockTraderReasoningAgent.js'
import { loadAiDecisionMemory } from './decisionMemory.js'
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
  registry = createDefaultStockTraderContextRegistry(),
  usageGovernor = null,
  engine = null,
  toolRegistry = null,
  memoryLoader = loadAiDecisionMemory,
  externalEvidenceRegistry = null
}) {
  if (!bot?.id || !bot?.portfolioId || !portfolio?.id || portfolio.id !== bot.portfolioId) {
    throw new Error('AI research bot/portfolio identity mismatch')
  }
  if (bot.enabled !== true || bot.config?.mode !== 'paper') {
    throw new Error('AI stock trader must be an enabled paper bot')
  }
  if (!screening?.asOfSession) throw new Error('Screening session missing')
  const config = bot.config
  const definition = defaultAiBotDefinitionRegistry.resolveInstance(bot)
  if (providerName !== definition.provider) throw new Error('AI research provider differs from pinned bot definition')
  const decisionMemory = definition.researchMode === 'tool_guided'
    ? await memoryLoader({ bot, asOfSession: screening.asOfSession, prismaClient, engine })
    : null
  const snapshot = await registry.assemble({
    session: screening.asOfSession,
    input: { screening, portfolio: portfolioSnapshot, config },
    modules: config.research?.contextModules,
    maxBytes: definition.contextByteBudget,
    ...(decisionMemory ? { decisionMemory } : {}),
    ...(definition.evidenceSources.length ? {
      evidenceRegistry: externalEvidenceRegistry,
      evidenceSourceIds: definition.evidenceSources
    } : {})
  })
  const { systemPrompt, userPrompt } = buildStockTraderPrompts(snapshot, definition)
  const model = definition.model
  const fingerprint = createHash('sha256').update(JSON.stringify({
    botId: bot.id, portfolioId: portfolio.id, providerName, model,
    promptVersion: STOCK_TRADER_PROMPT_VERSION,
    definitionVersion: definition.version,
    snapshotFingerprint: snapshot.fingerprint,
    systemPrompt, userPrompt
  })).digest('hex')
  // One paid research claim per bot, strategy version and completed market session.
  // Data changes within a session must not create additional paid calls.
  const sessionClaim = createHash('sha256').update(`${bot.id}:${config.strategyVersion}:${screening.asOfSession}`).digest('hex')
  const eventId = `req_stock_${sessionClaim.slice(0, 32)}`
  const cached = await prismaClient.botEvent.findUnique({ where: { id: eventId } })
  if (cached) {
    if (cached.botId !== bot.id || cached.portfolioId !== portfolio.id) {
      throw new Error('AI research cache ownership mismatch')
    }
    if (cached.metadata?.status === 'completed' && cached.metadata?.decision) {
      if (cached.metadata?.fingerprint !== fingerprint) {
        return { ok: false, skipped: true, reason: 'session_already_researched', eventId }
      }
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
    if (!usageGovernor) throw new Error('AI usage governor is required before external research')
    const client = provider || getProvider(providerName)
    const usageCalls = []
    const invokeModel = async ({ phase, systemPrompt: phaseSystemPrompt,
      userPrompt: phaseUserPrompt, maxTokens }) => {
      const jobKey = definition.researchMode === 'tool_guided'
        ? `${fingerprint}:${phase}`
        : fingerprint
      const reservation = await usageGovernor.reserve({
        botId: bot.id, jobKey, model
      })
      let settled = false
      try {
        const result = await client.completeStructured({
          systemPrompt: phaseSystemPrompt, userPrompt: phaseUserPrompt,
          model, temperature: 0.2, maxTokens
        })
        const receipt = await usageGovernor.settle(reservation, { usage: result.usage })
        if (receipt?.settled !== true) throw new Error('AI usage settlement was not committed')
        settled = true
        usageCalls.push({ phase, model: result.model || model, usage: result.usage || null })
        return result
      } catch (error) {
        if (!settled) await usageGovernor.settle(reservation, { uncertain: true }).catch(() => {})
        throw error
      }
    }

    let response
    let investigation = null
    if (definition.researchMode === 'tool_guided') {
      const guided = await runToolGuidedStockResearch({
        snapshot, definition, engine,
        ...(toolRegistry ? { toolRegistry } : {}),
        invokeModel
      })
      response = guided.response
      investigation = guided.investigation
    } else {
      response = await invokeModel({
        phase: 'decision', systemPrompt, userPrompt,
        maxTokens: definition.tokenBudget
      })
    }
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
          definitionVersion: definition.version,
          providerName,
          model: response.model || model,
          usage: response.usage || null,
          snapshot,
          decision,
          usageCalls,
          ...(investigation ? { investigation } : {})
        }
      }
    })
    if (publish.count !== 1) throw new Error('Lost AI research claim ownership')
    return { ok: true, cached: false, eventId, snapshot, decision,
      ...(investigation ? { investigation } : {}) }
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
