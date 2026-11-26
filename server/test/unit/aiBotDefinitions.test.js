import { describe, expect, it, vi } from 'vitest'
import {
  AI_BOT_DEFINITION_SCHEMA_VERSION,
  VANILLA_AI_STOCK_TRADER_DEFINITION,
  createAiBotDefinitionRegistry,
  defaultAiBotDefinitionRegistry
} from '../../src/services/ai/botDefinitions.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const makeBot = () => ({
  id: 'flagship-test',
  templateId: VANILLA_AI_STOCK_TRADER_DEFINITION.id,
  config: createAiStockTraderConfig()
})

describe('MR 11 versioned AI bot definitions', () => {
  it('resolves the vanilla flagship to its immutable version and code-owned risk policy', () => {
    const definition = defaultAiBotDefinitionRegistry.resolveInstance(makeBot())
    expect(definition.version).toBe('1.0.0')
    expect(definition.riskPolicyId).toBe('stock_trader_paper_v1')
    expect(definition.contextModules).toEqual(['market', 'portfolio', 'objectives', 'risk'])
    expect(definition.researchTools).toEqual([])
    expect(() => { definition.contextModules.push('unapproved') }).toThrow()
    expect(() => { definition.riskPolicyId = 'unregulated' }).toThrow()
  })

  it('can register a second independent AI bot without changing the flagship code', () => {
    const registry = createAiBotDefinitionRegistry([VANILLA_AI_STOCK_TRADER_DEFINITION])
    registry.register({
      schemaVersion: AI_BOT_DEFINITION_SCHEMA_VERSION,
      id: 'tmpl_ai_value_research',
      version: '1.0.0',
      name: 'AI Value Research',
      objective: 'Evaluate company quality and disclosures',
      philosophy: 'Fundamental analysis, explicit uncertainty',
      reasoningInstructions: 'Interpret filings and verified reports, do not calculate financial ratios.',
      contextModules: ['market', 'portfolio', 'filings'],
      researchTools: ['get_company_research'],
      provider: 'mock',
      model: 'fixture-model',
      schedule: 'weekly',
      maxModelCalls: 2,
      tokenBudget: 1500,
      contextByteBudget: 32000,
      riskPolicyId: 'stock_trader_paper_v1',
      outputSchemaVersion: 'stock-trader-decisions-v1'
    })
    expect(registry.list()).toHaveLength(2)
    expect(registry.get('tmpl_ai_value_research', '1.0.0').researchTools).toEqual(['get_company_research'])
    expect(() => registry.register(VANILLA_AI_STOCK_TRADER_DEFINITION)).toThrow(/already registered/)
    expect(defaultAiBotDefinitionRegistry.list()).toHaveLength(1)
  })

  it('rejects unauthorized tools, context, model changes and unknown risk policies', () => {
    const invalid = { ...VANILLA_AI_STOCK_TRADER_DEFINITION, id: 'tmpl_ai_unsafe', riskPolicyId: 'unrestricted' }
    expect(() => createAiBotDefinitionRegistry([invalid])).toThrow(/risk policy/)
    const extraContext = makeBot()
    extraContext.config.research.contextModules.push('unapproved_news')
    expect(() => defaultAiBotDefinitionRegistry.resolveInstance(extraContext)).toThrow(/unauthorized/)
    const otherModel = makeBot()
    otherModel.config.model = 'unknown-premium-model'
    expect(() => defaultAiBotDefinitionRegistry.resolveInstance(otherModel)).toThrow(/provider or model/)
  })

  it('honors a supported per-instance weekly cadence without changing the definition', () => {
    const instance = makeBot()
    instance.config.research.cadence = 'weekly'
    expect(defaultAiBotDefinitionRegistry.resolveInstance(instance).schedule).toBe('daily')
  })

  it('rejects excessive model and context budgets', () => {
    const illegal = { ...VANILLA_AI_STOCK_TRADER_DEFINITION, id: 'tmpl_ai_big', tokenBudget: 500000 }
    expect(() => createAiBotDefinitionRegistry([illegal])).toThrow(/budgets/)
  })
})
