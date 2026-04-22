// Portfolio Exposure Score Service
// Measures how structurally risky the portfolio is

import prisma from '../../db/prisma.js'

export class PortfolioExposureService {
  constructor() {
    this.thresholds = {
      singleTickerMax: 0.20, // 20% max single position
      sectorMax: 0.40, // 40% max sector exposure
      leverageMax: 1.5,
      correlationMax: 0.8
    }
  }

  // Calculate portfolio exposure score (0-100)
  async calculatePortfolioExposure(portfolioId) {
    try {
      const scores = {
        singleTicker: await this.scoreSingleTickerConcentration(portfolioId),
        sector: await this.scoreSectorConcentration(portfolioId),
        leverage: await this.scoreLeverage(portfolioId),
        correlation: await this.scoreCorrelation(portfolioId)
      }

      // Average of all scores (simple V1)
      const avgScore = (scores.singleTicker + scores.sector + scores.leverage + scores.correlation) / 4

      return {
        score: Math.round(avgScore),
        label: this.getLabel(avgScore),
        breakdown: scores,
        recommendation: this.getRecommendation(avgScore),
        details: await this.getExposureDetails(portfolioId)
      }

    } catch (error) {
      console.error('Failed to calculate portfolio exposure:', error)
      return {
        score: 0,
        label: 'weak',
        breakdown: {},
        recommendation: 'block_new_trades',
        error: error.message
      }
    }
  }

  // Score single ticker concentration (0-100)
  async scoreSingleTickerConcentration(portfolioId) {
    try {
      const holdings = await prisma.position.findMany({
        where: {
          portfolioId,
          quantity: { not: 0 }
        },
        select: {
          ticker: true,
          quantity: true,
          avgPrice: true
        }
      })

      if (holdings.length === 0) return 100

      // Calculate total portfolio value
      const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.quantity * h.avgPrice), 0)
      
      if (totalValue === 0) return 100

      // Find largest position
      const maxPosition = Math.max(...holdings.map(h => Math.abs(h.quantity * h.avgPrice)))
      const maxPct = maxPosition / totalValue

      // Score based on concentration
      if (maxPct <= 0.10) return 100
      if (maxPct <= 0.15) return 85
      if (maxPct <= this.thresholds.singleTickerMax) return 70
      if (maxPct <= 0.30) return 45
      if (maxPct <= 0.50) return 25
      return 10

    } catch (error) {
      console.error('Failed to score single ticker concentration:', error)
      return 50
    }
  }

  // Score sector concentration (0-100)
  async scoreSectorConcentration(portfolioId) {
    try {
      const holdings = await prisma.position.findMany({
        where: {
          portfolioId,
          quantity: { not: 0 }
        },
        select: {
          ticker: true,
          quantity: true,
          avgPrice: true
        }
      })

      if (holdings.length === 0) return 100

      // Simple sector mapping (V1 - can be enhanced with sector API)
      const sectorMap = {
        'AAPL': 'technology', 'MSFT': 'technology', 'GOOGL': 'technology', 'NVDA': 'technology',
        'JPM': 'financials', 'BAC': 'financials', 'WFC': 'financials',
        'XOM': 'energy', 'CVX': 'energy',
        'JNJ': 'healthcare', 'PFE': 'healthcare',
        'AMZN': 'consumer', 'TSLA': 'consumer'
      }

      // Calculate sector exposure
      const sectorExposure = {}
      let totalValue = 0

      holdings.forEach(h => {
        const value = Math.abs(h.quantity * h.avgPrice)
        const sector = sectorMap[h.ticker] || 'other'
        sectorExposure[sector] = (sectorExposure[sector] || 0) + value
        totalValue += value
      })

      if (totalValue === 0) return 100

      // Find max sector exposure
      const maxSectorExposure = Math.max(...Object.values(sectorExposure))
      const maxSectorPct = maxSectorExposure / totalValue

      // Score based on sector concentration
      if (maxSectorPct <= 0.25) return 100
      if (maxSectorPct <= 0.35) return 80
      if (maxSectorPct <= this.thresholds.sectorMax) return 65
      if (maxSectorPct <= 0.50) return 40
      if (maxSectorPct <= 0.70) return 20
      return 5

    } catch (error) {
      console.error('Failed to score sector concentration:', error)
      return 50
    }
  }

  // Score leverage (0-100)
  async scoreLeverage(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: {
          cash: true,
          totalValue: true
        }
      })

      if (!portfolio || portfolio.totalValue === 0) return 100

      // Calculate leverage ratio
      const leverage = portfolio.totalValue / portfolio.cash

      // Score based on leverage
      if (leverage <= 1.0) return 100
      if (leverage <= 1.2) return 90
      if (leverage <= this.thresholds.leverageMax) return 75
      if (leverage <= 2.0) return 50
      if (leverage <= 3.0) return 25
      return 10

    } catch (error) {
      console.error('Failed to score leverage:', error)
      return 50
    }
  }

  // Score correlation clustering (0-100)
  async scoreCorrelation(portfolioId) {
    try {
      const holdings = await prisma.position.findMany({
        where: {
          portfolioId,
          quantity: { not: 0 }
        },
        select: {
          ticker: true
        }
      })

      if (holdings.length < 2) return 100

      // V1: Simple correlation check based on ticker similarity
      // In production, would use actual correlation matrix
      const tickers = holdings.map(h => h.ticker)
      
      // Check for correlated pairs (simplified V1)
      const correlatedPairs = [
        ['AAPL', 'MSFT'], ['GOOGL', 'META'], ['JPM', 'BAC'],
        ['XOM', 'CVX'], ['JNJ', 'PFE']
      ]

      let correlationCount = 0
      correlatedPairs.forEach(pair => {
        if (tickers.includes(pair[0]) && tickers.includes(pair[1])) {
          correlationCount++
        }
      })

      // Score based on correlation count
      if (correlationCount === 0) return 100
      if (correlationCount === 1) return 80
      if (correlationCount === 2) return 60
      if (correlationCount === 3) return 40
      return 20

    } catch (error) {
      console.error('Failed to score correlation:', error)
      return 50
    }
  }

  // Get detailed exposure information
  async getExposureDetails(portfolioId) {
    try {
      const holdings = await prisma.position.findMany({
        where: {
          portfolioId,
          quantity: { not: 0 }
        },
        select: {
          ticker: true,
          quantity: true,
          avgPrice: true
        }
      })

      const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.quantity * h.avgPrice), 0)

      const positions = holdings.map(h => ({
        ticker: h.ticker,
        value: Math.abs(h.quantity * h.avgPrice),
        pct: totalValue > 0 ? Math.abs(h.quantity * h.avgPrice) / totalValue : 0
      })).sort((a, b) => b.pct - a.pct)

      return {
        totalValue,
        positions,
        largestPosition: positions[0] || null,
        positionCount: holdings.length
      }

    } catch (error) {
      console.error('Failed to get exposure details:', error)
      return null
    }
  }

  // Get label for score
  getLabel(score) {
    if (score >= 75) return 'good'
    if (score >= 50) return 'moderate'
    return 'weak'
  }

  // Get recommendation based on score
  getRecommendation(score) {
    if (score >= 75) return 'normal_trading'
    if (score >= 50) return 'reduce_new_size'
    if (score >= 35) return 'only_diversifying'
    return 'block_new_trades'
  }

  // Check if new trade would increase exposure too much
  async checkNewTradeExposure(portfolioId, ticker, tradeValue) {
    try {
      const currentExposure = await this.calculatePortfolioExposure(portfolioId)
      
      // Get current holdings
      const holdings = await prisma.position.findMany({
        where: {
          portfolioId,
          quantity: { not: 0 }
        },
        select: {
          ticker: true,
          quantity: true,
          avgPrice: true
        }
      })

      const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.quantity * h.avgPrice), 0)
      const newTotalValue = totalValue + tradeValue

      // Check if this would exceed single ticker limit
      const existingPosition = holdings.find(h => h.ticker === ticker)
      const existingValue = existingPosition ? Math.abs(existingPosition.quantity * existingPosition.avgPrice) : 0
      const newTickerValue = existingValue + tradeValue
      const newTickerPct = newTickerValue / newTotalValue

      if (newTickerPct > this.thresholds.singleTickerMax) {
        return {
          allowed: false,
          reason: 'single_ticker_limit',
          currentPct: existingValue / totalValue,
          newPct: newTickerPct,
          limit: this.thresholds.singleTickerMax
        }
      }

      return {
        allowed: true,
        currentExposure,
        newTickerPct
      }

    } catch (error) {
      console.error('Failed to check new trade exposure:', error)
      return {
        allowed: false,
        reason: 'error',
        error: error.message
      }
    }
  }

  // Update thresholds
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds }
  }
}

export const portfolioExposureService = new PortfolioExposureService()
