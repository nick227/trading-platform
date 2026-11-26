import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseLLMProvider } from './baseProvider.js'

function resolveApiKey(provided) {
  if (provided) return provided
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../.env')
    if (fs.existsSync(rootEnv)) {
      const match = fs.readFileSync(rootEnv, 'utf8').match(/OPENAI_API_KEY=(.*)/)
      if (match) return match[1].trim()
    }
  } catch {
    // ignore
  }
  return null
}

export class OpenAIProvider extends BaseLLMProvider {
  constructor({ apiKey = null, defaultModel = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1' } = {}) {
    super('openai')
    this.apiKey = resolveApiKey(apiKey)
    this.defaultModel = defaultModel
    this.baseUrl = baseUrl
  }

  async completeStructured({ systemPrompt, userPrompt, schema = null, model = this.defaultModel, temperature = 0.2, maxTokens = null }) {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const payload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature,
      ...(Number.isInteger(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {})
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const errBody = await res.text()
      let errMsg = `OpenAI API returned HTTP ${res.status}`
      try {
        const parsed = JSON.parse(errBody)
        if (parsed.error?.message) errMsg = `OpenAI API: ${parsed.error.message}`
      } catch {
        // preserve status error
      }
      throw new Error(errMsg)
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('OpenAI returned empty message content')
    }

    let structured
    try {
      structured = JSON.parse(content)
    } catch (parseErr) {
      throw new Error(`Failed to parse OpenAI JSON output: ${parseErr.message}`)
    }

    return {
      structured,
      rawText: content,
      model: data.model || model,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }
  }
}
