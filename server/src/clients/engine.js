const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8000'

export const engineClient = {
  async getPredictions(params = {}) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null))
    ).toString()
    const res = await fetch(`${ENGINE_URL}/internal/predictions?${qs}`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  },

  async getStrategies() {
    const res = await fetch(`${ENGINE_URL}/internal/strategies`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  },

  async getCurrentPrices() {
    const res = await fetch(`${ENGINE_URL}/internal/prices/current`)
    if (!res.ok) throw new Error(`Engine ${res.status}: ${await res.text()}`)
    return res.json()
  }
}
