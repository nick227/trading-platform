// Old Engine Client for legacy endpoints
// Maintains compatibility with existing backend routes

const OLD_ENGINE_URL = process.env.OLD_ENGINE_URL ?? 'http://localhost:8000'

async function oldEngineFetch(endpoint, options = {}) {
  const url = `${OLD_ENGINE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Old Engine ${response.status}: ${errorText}`)
  }

  return response.json()
}

export const oldEngineClient = {
  async getPredictions(params = {}) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null))
    ).toString()
    return oldEngineFetch(`/internal/predictions?${qs}`)
  },

  async getStrategies() {
    return oldEngineFetch('/internal/strategies')
  },

  async getCurrentPrices() {
    return oldEngineFetch('/internal/prices/current')
  }
}
