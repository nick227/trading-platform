import { BaseLLMProvider } from './baseProvider.js'

export class MockLLMProvider extends BaseLLMProvider {
  constructor({ fixedResponse = null, handler = null } = {}) {
    super('mock')
    this.fixedResponse = fixedResponse
    this.handler = handler
    this.calls = []
  }

  async completeStructured(options) {
    this.calls.push(options)
    if (this.handler) {
      return this.handler(options)
    }
    const structured = this.fixedResponse ?? {
      asOfSession: '2026-11-20',
      marketSummary: 'Mock market regime analysis',
      symbolEvaluations: [
        {
          symbol: 'SPY',
          action: 'HOLD',
          confidence: 0.7,
          targetAllocationPct: 0,
          entryType: 'next_open',
          exitRule: { takeProfitPct: 5, stopLossPct: 3 },
          thesis: 'Mock hold thesis for SPY index',
          evidence: ['SPY trading near moving averages']
        }
      ],
      selectedDecisions: []
    }

    return {
      structured,
      rawText: JSON.stringify(structured),
      model: 'mock-llm-v1',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }
  }
}
