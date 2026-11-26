/**
 * Versioned, immutable AI bot identities.
 *
 * A definition describes reasoning, permitted context and model capabilities.
 * It does not grant order placement, define brokerage credentials or activate jobs.
 * Code-owned risk policies always take precedence over an instance's preferences.
 */
import {
  AI_STOCK_TRADER_DEFAULTS,
  AI_STOCK_TRADER_STRATEGY_ID,
  AI_STOCK_TRADER_VERSION,
  AI_STOCK_TRADER_AGENT_VERSION
} from './strategies/aiStockTraderStrategy.js'

export const AI_BOT_RISK_POLICIES = Object.freeze(['stock_trader_paper_v1'])
export const AI_BOT_DEFINITION_SCHEMA_VERSION = '1.0.0'

const TOKEN = /^[a-z][a-z0-9_-]{1,79}$/
const VERSION = /^\d+\.\d+\.\d+$/
const MAX_MODEL_CALLS = 10
const MAX_RESEARCH_TOKENS = 8192
const MAX_CONTEXT_BYTES = 128_000

export class AiBotDefinitionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AiBotDefinitionError'
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function validList(value) {
  return Array.isArray(value) && value.every(v => typeof v === 'string' && TOKEN.test(v)) &&
    new Set(value).size === value.length
}

function normalize(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new AiBotDefinitionError('Definition must be an object')
  const requiredText = ['id','name','objective','philosophy','reasoningInstructions','provider','model','schedule','riskPolicyId','outputSchemaVersion']
  for (const key of requiredText) {
    if (typeof def[key] !== 'string' || !def[key].trim() || def[key].length > 4000) {
      throw new AiBotDefinitionError(`Invalid AI bot definition field: ${key}`)
    }
  }
  if (!TOKEN.test(def.id) || !VERSION.test(def.version) || def.schemaVersion !== AI_BOT_DEFINITION_SCHEMA_VERSION) {
    throw new AiBotDefinitionError('Invalid bot identity, version or definition schema')
  }
  if (!AI_BOT_RISK_POLICIES.includes(def.riskPolicyId)) {
    throw new AiBotDefinitionError('AI bot must reference a registered, code-owned risk policy')
  }
  if (!validList(def.contextModules) || !def.contextModules.length ||
      !validList(def.researchTools) || !validList(def.evidenceSources ?? [])) {
    throw new AiBotDefinitionError('AI bot context modules and tools must be distinct valid identifiers')
  }
  if (!Number.isInteger(def.maxModelCalls) || def.maxModelCalls < 1 || def.maxModelCalls > MAX_MODEL_CALLS ||
      !Number.isInteger(def.tokenBudget) || def.tokenBudget < 128 || def.tokenBudget > MAX_RESEARCH_TOKENS ||
      !Number.isInteger(def.contextByteBudget) || def.contextByteBudget < 1024 || def.contextByteBudget > MAX_CONTEXT_BYTES) {
    throw new AiBotDefinitionError('AI bot request budgets exceed platform limits')
  }
  if (!['daily', 'weekly', 'manual'].includes(def.schedule)) {
    throw new AiBotDefinitionError('Unsupported AI bot research cadence')
  }
  if (!['openai', 'mock'].includes(def.provider)) {
    throw new AiBotDefinitionError('Provider is not supported by the registered AI platform')
  }
  if (!['one_shot', 'tool_guided'].includes(def.researchMode || 'one_shot')) {
    throw new AiBotDefinitionError('Unrecognized AI reasoning mode')
  }
  if (def.researchMode === 'tool_guided' && (def.maxModelCalls < 2 || !def.researchTools.length)) {
    throw new AiBotDefinitionError('Tool-guided reasoning requires two model calls and approved research tools')
  }
  return freezeDeep({
    schemaVersion: def.schemaVersion,
    id: def.id,
    version: def.version,
    name: def.name.trim(),
    objective: def.objective.trim(),
    philosophy: def.philosophy.trim(),
    reasoningInstructions: def.reasoningInstructions.trim(),
    contextModules: [...def.contextModules],
    researchTools: [...def.researchTools],
    evidenceSources: [...(def.evidenceSources ?? [])],
    provider: def.provider,
    model: def.model,
    schedule: def.schedule,
    maxModelCalls: def.maxModelCalls,
    tokenBudget: def.tokenBudget,
    contextByteBudget: def.contextByteBudget,
    riskPolicyId: def.riskPolicyId,
    outputSchemaVersion: def.outputSchemaVersion,
    researchMode: def.researchMode || 'one_shot'
  })
}

export function createAiBotDefinitionRegistry(initialDefinitions = []) {
  const definitions = new Map()
  const api = {
    register(input) {
      const definition = normalize(input)
      const key = `${definition.id}@${definition.version}`
      if (definitions.has(key)) throw new AiBotDefinitionError(`AI bot definition already registered: ${key}`)
      definitions.set(key, definition)
      return api
    },
    get(id, version) {
      return definitions.get(`${id}@${version}`) || null
    },
    list() {
      return [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))
    },
    resolveInstance(bot) {
      if (!bot?.config || typeof bot.config !== 'object') throw new AiBotDefinitionError('AI bot has no effective configuration')
      const id = bot.config.strategyId
      const version = bot.config.strategyVersion
      const definition = api.get(id, version)
      if (!definition || (bot.templateId && bot.templateId !== id)) {
        throw new AiBotDefinitionError('Unknown or mismatched AI bot definition')
      }
      if (bot.config.provider !== definition.provider || bot.config.model !== definition.model) {
        throw new AiBotDefinitionError('Bot instance may not override the registered provider or model')
      }
      const modules = bot.config.research?.contextModules
      if (!validList(modules) || !modules.length ||
          modules.some(moduleId => !definition.contextModules.includes(moduleId))) {
        throw new AiBotDefinitionError('Bot instance requested unauthorized research context')
      }
      const limit = Number(bot.config.research?.maxCallsPerCycle)
      if (!Number.isInteger(limit) || limit < 1 || limit > definition.maxModelCalls) {
        throw new AiBotDefinitionError('Bot instance research call limit exceeds definition')
      }
      if (!['daily', 'weekly'].includes(bot.config.research?.cadence)) {
        throw new AiBotDefinitionError('Bot instance research cadence is unsupported')
      }
      // Return pinned definition independent of mutable instance configuration.
      return definition
    }
  }
  for (const definition of initialDefinitions) api.register(definition)
  return api
}

export const VANILLA_AI_STOCK_TRADER_DEFINITION = freezeDeep({
  schemaVersion: AI_BOT_DEFINITION_SCHEMA_VERSION,
  id: AI_STOCK_TRADER_STRATEGY_ID,
  version: AI_STOCK_TRADER_VERSION,
  name: 'AI Stock Trader',
  objective: 'Evaluate eligible stocks and existing simulated holdings as a generalist investor.',
  philosophy: 'Evidence-grounded, non-doctrinaire portfolio research; abstain when information is insufficient.',
  reasoningInstructions: 'Compare the significance and uncertainty of available evidence. Do not perform arithmetic, invent catalysts or treat self-reported confidence as a calibrated probability.',
  contextModules: [...AI_STOCK_TRADER_DEFAULTS.research.contextModules],
  researchTools: [],
  provider: AI_STOCK_TRADER_DEFAULTS.provider,
  model: AI_STOCK_TRADER_DEFAULTS.model,
  schedule: AI_STOCK_TRADER_DEFAULTS.research.cadence,
  maxModelCalls: AI_STOCK_TRADER_DEFAULTS.research.maxCallsPerCycle,
  tokenBudget: 1000,
  contextByteBudget: 48_000,
  riskPolicyId: 'stock_trader_paper_v1',
  outputSchemaVersion: 'stock-trader-decisions-v1',
  researchMode: 'one_shot'
})

export const VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION = freezeDeep({
  ...VANILLA_AI_STOCK_TRADER_DEFINITION,
  version: AI_STOCK_TRADER_AGENT_VERSION,
  philosophy: 'Independently investigate eligible securities and compare evidence without committing to a single technical indicator strategy.',
  reasoningInstructions: 'Choose which deterministic questions to investigate, interpret the returned data, challenge contradictions, decide or abstain, and explain your judgment in English. Never calculate numerical results or invent evidence.',
  researchTools: ['get_stock_metrics', 'compare_candidates', 'get_portfolio_state', 'get_historical_prices'],
  maxModelCalls: 2,
  tokenBudget: 3000,
  researchMode: 'tool_guided'
})

export const defaultAiBotDefinitionRegistry = createAiBotDefinitionRegistry([
  VANILLA_AI_STOCK_TRADER_DEFINITION,
  VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION
])
