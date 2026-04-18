export const API_CONFIG = {
  USE_MOCK: false,
  BASE_URL: 'http://localhost:3001',
  VERSION: ''
}

export function createAPI() {
  return {
    config: API_CONFIG,
    
    async get(endpoint, params = {}) {
      const url = new URL(`${API_CONFIG.BASE_URL}/${API_CONFIG.VERSION}${endpoint}`)
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]))
      
      if (API_CONFIG.USE_MOCK) {
        return this.mockGet(endpoint, params)
      }
      
      const response = await fetch(url.toString())
      return response.json()
    },
    
    async post(endpoint, data = {}) {
      const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.VERSION}${endpoint}`
      
      if (API_CONFIG.USE_MOCK) {
        return this.mockPost(endpoint, data)
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      return response.json()
    },
    
    async mockDelay() {
      const delay = Math.random() * (API_CONFIG.MOCK_DELAY.max - API_CONFIG.MOCK_DELAY.min) + API_CONFIG.MOCK_DELAY.min
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
