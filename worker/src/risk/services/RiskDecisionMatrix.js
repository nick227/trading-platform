// Risk Decision Matrix Service
// Orchestrates 4 independent risk scores into intelligent trading decisions

import { executionConfidenceService } from './ExecutionConfidenceService.js'
import { portfolioExposureService } from './PortfolioExposureService.js'
import { drawdownStressService } from './DrawdownStressService.js'
import { operationalRiskService } from './OperationalRiskService.js'
import { RISK_THRESHOLDS, applyDecisionMatrix } from '../riskCore.js'

export class RiskDecisionMatrix {
  constructor() {
    this.thresholds = RISK_THRESHOLDS
  }

  // Evaluate trade request using 4-score decision matrix
  async evaluateTradeRequest(portfolioId, signal, marketData = {}) {
    try {
      // Calculate all 4 scores in parallel
      const [operational, exposure, stress, execution] = await Promise.all([
        operationalRiskService.calculateOperationalRisk(portfolioId),
        portfolioExposureService.calculatePortfolioExposure(portfolioId),
        drawdownStressService.calculateDrawdownStress(portfolioId),
        executionConfidenceService.calculateExecutionConfidence(signal, portfolioId, marketData)
      ])

      const scores = {
        operational: operational.score,
        exposure: exposure.score,
        stress: stress.score,
        execution: execution.score
      }

      // Apply decision matrix
      const decision = this.applyDecisionMatrix(scores, signal, portfolioId)

      return {
        decision: decision.action,
        reason: decision.reason,
        positionMultiplier: decision.positionMultiplier || 1.0,
        scores: {
          operational: {
            score: operational.score,
            label: operational.label,
            recommendation: operational.recommendation
          },
          exposure: {
            score: exposure.score,
            label: exposure.label,
            recommendation: exposure.recommendation
          },
          stress: {
            score: stress.score,
            label: stress.label,
            recommendation: stress.recommendation
          },
          execution: {
            score: execution.score,
            label: execution.label,
            recommendation: execution.recommendation
          }
        },
        breakdowns: {
          operational: operational.breakdown,
          exposure: exposure.breakdown,
          stress: stress.breakdown,
          execution: execution.breakdown
        },
        details: {
          operational: operational.details,
          exposure: exposure.details,
          stress: stress.details
        },
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to evaluate trade request:', error)
      return {
        decision: 'reject',
        reason: 'error_calculating_scores',
        error: error.message,
        scores: { operational: 0, exposure: 0, stress: 0, execution: 0 }
      }
    }
  }

  // Apply decision matrix logic (riskCore: one policy for live and historical runs)
  applyDecisionMatrix(scores, signal, portfolioId) {
    return applyDecisionMatrix(scores, this.thresholds)
  }

  // Get overall risk summary for dashboard
  async getRiskSummary(portfolioId) {
    try {
      const [operational, exposure, stress] = await Promise.all([
        operationalRiskService.calculateOperationalRisk(portfolioId),
        portfolioExposureService.calculatePortfolioExposure(portfolioId),
        drawdownStressService.calculateDrawdownStress(portfolioId)
      ])

      const overallScore = Math.round((operational.score + exposure.score + stress.score) / 3)
      const overallLabel = this.getOverallLabel(overallScore)

      return {
        overall: {
          score: overallScore,
          label: overallLabel
        },
        operational: {
          score: operational.score,
          label: operational.label
        },
        exposure: {
          score: exposure.score,
          label: exposure.label
        },
        stress: {
          score: stress.score,
          label: stress.label
        },
        canAutoTrade: this.canAutoTrade(operational.score),
        tradingMode: this.getTradingMode(operational.score, exposure.score, stress.score),
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to get risk summary:', error)
      return {
        error: error.message
      }
    }
  }

  // Get overall label
  getOverallLabel(score) {
    if (score >= 75) return 'good'
    if (score >= 50) return 'moderate'
    return 'weak'
  }

  // Check if auto trading is allowed
  canAutoTrade(operationalScore) {
    return operationalScore >= this.thresholds.operational.warning
  }

  // Get trading mode based on scores
  getTradingMode(operational, exposure, stress) {
    if (operational < this.thresholds.operational.critical) return 'paused'
    if (operational < this.thresholds.operational.warning) return 'safe_mode'
    if (stress < this.thresholds.stress.critical) return 'recovery'
    if (stress < this.thresholds.stress.warning) return 'throttled'
    if (exposure < this.thresholds.exposure.warning) return 'conservative'
    return 'normal'
  }

  // Batch evaluate multiple trade requests with bounded parallelism
  async batchEvaluateTradeRequests(portfolioId, signals, marketDataMap, concurrency = 5) {
    const results = []
    const chunks = []
    
    // Split signals into chunks for bounded parallelism
    for (let i = 0; i < signals.length; i += concurrency) {
      chunks.push(signals.slice(i, i + concurrency))
    }
    
    // Process chunks sequentially, signals within chunks in parallel
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (signal) => {
          const marketData = marketDataMap[signal.ticker] || {}
          const result = await this.evaluateTradeRequest(portfolioId, signal, marketData)
          return {
            signalId: signal.id,
            ticker: signal.ticker,
            ...result
          }
        })
      )
      results.push(...chunkResults)
    }
    
    return results
  }

  // Update thresholds
  updateThresholds(newThresholds) {
    this.thresholds = {
      operational: { ...this.thresholds.operational, ...newThresholds.operational },
      exposure: { ...this.thresholds.exposure, ...newThresholds.exposure },
      stress: { ...this.thresholds.stress, ...newThresholds.stress },
      execution: { ...this.thresholds.execution, ...newThresholds.execution }
    }
  }
}

export const riskDecisionMatrix = new RiskDecisionMatrix()
