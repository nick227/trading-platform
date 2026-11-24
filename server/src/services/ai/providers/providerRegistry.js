import { OpenAIProvider } from './openAiProvider.js'
import { MockLLMProvider } from './mockProvider.js'

const providers = new Map()

export function getProvider(name = 'openai', options = {}) {
  const key = String(name).toLowerCase()
  if (providers.has(key)) {
    return providers.get(key)
  }
  if (key === 'mock') {
    return new MockLLMProvider(options)
  }
  if (key === 'openai') {
    if (!providers.has('openai') || Object.keys(options).length > 0) {
      const p = new OpenAIProvider(options)
      if (Object.keys(options).length === 0) providers.set('openai', p)
      return p
    }
    return providers.get('openai')
  }
  if (key === 'gemini') {
    throw new Error('Gemini provider is registered in the architecture interface and awaiting API key activation.')
  }
  if (key === 'claude' || key === 'anthropic') {
    throw new Error('Anthropic Claude provider is registered in the architecture interface and awaiting API key activation.')
  }
  throw new Error(`Unsupported LLM provider: ${name}`)
}

export function registerCustomProvider(name, providerInstance) {
  providers.set(String(name).toLowerCase(), providerInstance)
}
