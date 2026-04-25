import { engineClient } from '../clients/engine.js'

// Thin wrapper so bot routes don't import engineClient directly.
// All Alpha Engine access goes through here.
export default {
  // Returns ranked tickers as a flat array: [{ symbol, confidence, score, ... }]
  async getRankings({ limit = 20 } = {}) {
    const data = await engineClient.getTopRankings(limit)
    return data?.rankings ?? []
  },

  // Market data endpoints for Orders bootstrap
  async getTickers(search = '') {
    try {
      return await engineClient.getTickers(search)
    } catch (error) {
      console.error('Failed to get tickers:', error)
      return { tickers: [] }
    }
  },

  async getQuote(symbol) {
    try {
      return await engineClient.getQuote(symbol)
    } catch (error) {
      console.error(`Failed to get quote for ${symbol}:`, error)
      return null
    }
  },

  async getHistory(symbol, range = '1Y', interval = '1D') {
    try {
      return await engineClient.getHistory(symbol, range, interval)
    } catch (error) {
      console.error(`Failed to get history for ${symbol}:`, error)
      return { points: [] }
    }
  },

  async getStats(symbol) {
    try {
      return await engineClient.getStats(symbol)
    } catch (error) {
      console.error(`Failed to get stats for ${symbol}:`, error)
      return null
    }
  },

  async getCompany(symbol) {
    try {
      return await engineClient.getCompany(symbol)
    } catch (error) {
      console.error(`Failed to get company for ${symbol}:`, error)
      return null
    }
  },

  async getTickerExplainability(symbol) {
    try {
      return await engineClient.getTickerExplainability(symbol)
    } catch (error) {
      console.error(`Failed to get explainability for ${symbol}:`, error)
      return null
    }
  },

  async getTickerRecommendation(symbol, mode = 'balanced') {
    try {
      return await engineClient.getTickerRecommendation(symbol, mode)
    } catch (error) {
      console.error(`Failed to get recommendation for ${symbol}:`, error)
      return null
    }
  }
}
