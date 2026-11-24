// Portfolio Exposure Score Service
// Measures how structurally risky the portfolio is

import { portfolioRiskSnapshot } from '../accountSnapshot.js'
import { scoreSingleTickerConcentration, scoreSectorConcentration, scoreLeverage, scoreCorrelation } from '../riskCore.js'

export class PortfolioExposureService {
  /**
   * Open holdings from the shared portfolio valuation (user-scoped FIFO, each holding
   * marked at the latest close). `value` is market value as of `pricesAsOf`.
   */
  async holdings(portfolioId) {
    const snap = await portfolioRiskSnapshot(portfolioId)
    return snap.positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, avgPrice: p.avgPrice, value: p.value }))
  }

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
      const holdings = await this.holdings(portfolioId)
      return scoreSingleTickerConcentration(holdings)
    } catch (error) {
      console.error('Failed to score scoreSingleTickerConcentration:', error)
      return 50
    }
  }


  // Score sector concentration (0-100)
  async scoreSectorConcentration(portfolioId) {
    try {
      const holdings = await this.holdings(portfolioId)
      return scoreSectorConcentration(holdings)
    } catch (error) {
      console.error('Failed to score scoreSectorConcentration:', error)
      return 50
    }
  }


  // Score leverage (0-100)
  async scoreLeverage(portfolioId) {
    try {
      const snap = await portfolioRiskSnapshot(portfolioId)
      return scoreLeverage(snap.marketValue, snap.equity)
    } catch (error) {
      console.error('Failed to score scoreLeverage:', error)
      return 50
    }
  }


  // Score correlation clustering (0-100)
  async scoreCorrelation(portfolioId) {
    try {
      const holdings = await this.holdings(portfolioId)
      return scoreCorrelation(holdings)
    } catch (error) {
      console.error('Failed to score scoreCorrelation:', error)
      return 50
    }
  }


  // Get detailed exposure information
  async getExposureDetails(portfolioId) {
    try {
      const holdings = await this.holdings(portfolioId)

      const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.value), 0)

      const positions = holdings.map(h => ({
        ticker: h.ticker,
        value: Math.abs(h.value),
        pct: totalValue > 0 ? Math.abs(h.value) / totalValue : 0
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
      const holdings = await this.holdings(portfolioId)

      const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.value), 0)
      const newTotalValue = totalValue + tradeValue

      // Check if this would exceed single ticker limit
      const existingPosition = holdings.find(h => h.ticker === ticker)
      const existingValue = existingPosition ? Math.abs(existingPosition.value) : 0
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
