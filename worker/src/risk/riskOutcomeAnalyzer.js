// Risk Outcome Analyzer for Alpha Engine Training
// Analyzes risk management outcomes to optimize Alpha Engine performance

import prisma from '../db/prisma.js'
import { riskManager } from './riskManagement.js'

export class RiskOutcomeAnalyzer {
  constructor() {
    this.outcomeCache = new Map()
    this.cacheTtl = 60 * 60 * 1000 // 1 hour cache
  }

  // Analyze risk outcomes to train Alpha Engine
  async analyzeRiskOutcomes(portfolioId, timeframe = '30d') {
    try {
      const cacheKey = `outcomes:${portfolioId}:${timeframe}`
      const cached = this.outcomeCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.analysis
      }

      // Get risk events and outcomes
      const [riskBlocks, executions, alphaPredictions] = await Promise.all([
        this.getRiskBlocks(portfolioId, timeframe),
        this.getExecutions(portfolioId, timeframe),
        this.getAlphaPredictions(portfolioId, timeframe)
      ])

      // Analyze blocked trades outcomes
      const blockedAnalysis = this.analyzeBlockedTrades(riskBlocks, alphaPredictions)
      
      // Analyze allowed trades outcomes
      const allowedAnalysis = this.analyzeAllowedTrades(executions, alphaPredictions)
      
      // Analyze rule effectiveness
      const ruleAnalysis = this.analyzeRuleEffectiveness(riskBlocks)
      
      // Calculate optimization insights
      const optimizationInsights = this.generateOptimizationInsights(
        blockedAnalysis, 
        allowedAnalysis, 
        ruleAnalysis
      )

      // Generate training data for Alpha Engine
      const trainingData = this.generateTrainingData(
        blockedAnalysis,
        allowedAnalysis,
        optimizationInsights
      )

      const analysis = {
        portfolioId,
        timeframe,
        timestamp: new Date(),
        blockedAnalysis,
        allowedAnalysis,
        ruleAnalysis,
        optimizationInsights,
        trainingData,
        summary: this.generateAnalysisSummary(
          blockedAnalysis, 
          allowedAnalysis, 
          ruleAnalysis
        )
      }

      // Cache the result
      this.outcomeCache.set(cacheKey, {
        analysis,
        timestamp: Date.now()
      })

      return analysis
    } catch (error) {
      console.error('Failed to analyze risk outcomes:', error)
      throw error
    }
  }

  // Get blocked trades from risk events
  async getRiskBlocks(portfolioId, timeframe) {
    try {
      const cutoff = this.getTimeframeCutoff(timeframe)
      
      const riskBlocks = await prisma.executionAudit.findMany({
        where: {
          eventType: 'risk_blocked',
          createdAt: { gte: cutoff }
        },
        include: {
          execution: {
            select: {
              ticker: true,
              direction: true,
              quantity: true,
              price: true,
              strategyId: true,
              predictionId: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })

      return riskBlocks.map(block => ({
        id: block.id,
        createdAt: block.createdAt,
        ticker: block.execution?.ticker,
        direction: block.execution?.direction,
        quantity: block.execution?.quantity,
        price: block.execution?.price,
        strategyId: block.execution?.strategyId,
        predictionId: block.execution?.predictionId,
        reason: block.detail,
        metadata: block.metadata,
        riskEvaluation: block.metadata?.riskEvaluation
      }))
    } catch (error) {
      console.error('Failed to get risk blocks:', error)
      return []
    }
  }

  // Get executed trades
  async getExecutions(portfolioId, timeframe) {
    try {
      const cutoff = this.getTimeframeCutoff(timeframe)
      
      const executions = await prisma.execution.findMany({
        where: {
          portfolioId,
          status: 'filled',
          filledAt: { gte: cutoff }
        },
        select: {
          id: true,
          ticker: true,
          direction: true,
          quantity: true,
          price: true,
          filledPrice: true,
          pnl: true,
          filledAt: true,
          strategyId: true,
          predictionId: true
        },
        orderBy: { filledAt: 'desc' }
      })

      return executions
    } catch (error) {
      console.error('Failed to get executions:', error)
      return []
    }
  }

  // Get Alpha Engine predictions
  async getAlphaPredictions(portfolioId, timeframe) {
    try {
      const cutoff = this.getTimeframeCutoff(timeframe)
      
      const predictions = await prisma.prediction.findMany({
        where: {
          strategy: {
            bots: {
              some: { portfolioId }
            }
          },
          createdAt: { gte: cutoff }
        },
        select: {
          id: true,
          ticker: true,
          direction: true,
          confidence: true,
          entryPrice: true,
          stopPrice: true,
          targetPrice: true,
          createdAt: true,
          regime: true,
          reasoning: true
        },
        orderBy: { createdAt: 'desc' }
      })

      return predictions
    } catch (error) {
      console.error('Failed to get Alpha predictions:', error)
      return []
    }
  }

  // Analyze outcomes of blocked trades
  analyzeBlockedTrades(riskBlocks, alphaPredictions) {
    const analysis = {
      totalBlocks: riskBlocks.length,
      blocksByReason: {},
      blocksByTicker: {},
      blocksByRule: {},
      savedLosses: [],
      missedOpportunities: [],
      accuracyByReason: {},
      confidenceAnalysis: {}
    }

    // Group blocks by reason
    riskBlocks.forEach(block => {
      const reason = this.extractBlockReason(block.reason)
      analysis.blocksByReason[reason] = (analysis.blocksByReason[reason] || 0) + 1
      
      const ticker = block.ticker || 'unknown'
      analysis.blocksByTicker[ticker] = (analysis.blocksByTicker[ticker] || 0) + 1
    })

    // Analyze each blocked trade outcome
    riskBlocks.forEach(block => {
      const outcome = this.analyzeBlockedTradeOutcome(block, alphaPredictions)
      
      if (outcome.savedLoss > 0) {
        analysis.savedLosses.push(outcome)
      }
      
      if (outcome.missedProfit > 0) {
        analysis.missedOpportunities.push(outcome)
      }
    })

    // Calculate accuracy by reason
    Object.keys(analysis.blocksByReason).forEach(reason => {
      const reasonBlocks = riskBlocks.filter(b => this.extractBlockReason(b.reason) === reason)
      const correctBlocks = reasonBlocks.filter(b => {
        const outcome = this.analyzeBlockedTradeOutcome(b, alphaPredictions)
        return outcome.savedLoss > outcome.missedProfit
      })
      
      analysis.accuracyByReason[reason] = {
        total: reasonBlocks.length,
        correct: correctBlocks.length,
        accuracy: reasonBlocks.length > 0 ? correctBlocks.length / reasonBlocks.length : 0
      }
    })

    // Analyze confidence levels
    riskBlocks.forEach(block => {
      const prediction = alphaPredictions.find(p => p.id === block.predictionId)
      if (prediction) {
        const confidence = Math.floor(prediction.confidence * 10) / 10 // Round to 1 decimal
        if (!analysis.confidenceAnalysis[confidence]) {
          analysis.confidenceAnalysis[confidence] = { blocks: 0, savedLosses: 0, missedOpportunities: 0 }
        }
        analysis.confidenceAnalysis[confidence].blocks++
        
        const outcome = this.analyzeBlockedTradeOutcome(block, alphaPredictions)
        if (outcome.savedLoss > outcome.missedProfit) {
          analysis.confidenceAnalysis[confidence].savedLosses++
        } else {
          analysis.confidenceAnalysis[confidence].missedOpportunities++
        }
      }
    })

    // Calculate totals
    analysis.totalSavedLosses = analysis.savedLosses.reduce((sum, s) => sum + s.savedLoss, 0)
    analysis.totalMissedOpportunities = analysis.missedOpportunities.reduce((sum, m) => sum + m.missedProfit, 0)
    analysis.netValue = analysis.totalSavedLosses - analysis.totalMissedOpportunities

    return analysis
  }

  // Analyze outcomes of allowed trades
  analyzeAllowedTrades(executions, alphaPredictions) {
    const analysis = {
      totalTrades: executions.length,
      profitableTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      avgPnL: 0,
      winRate: 0,
      pnlByConfidence: {},
      pnlByTicker: {},
      pnlByRegime: {},
      riskAdjustedReturns: []
    }

    // Basic performance metrics
    executions.forEach(exec => {
      const pnl = exec.pnl || 0
      analysis.totalPnL += pnl
      
      if (pnl > 0) analysis.profitableTrades++
      else if (pnl < 0) analysis.losingTrades++
      
      // Group by ticker
      const ticker = exec.ticker
      if (!analysis.pnlByTicker[ticker]) {
        analysis.pnlByTicker[ticker] = { trades: 0, totalPnL: 0 }
      }
      analysis.pnlByTicker[ticker].trades++
      analysis.pnlByTicker[ticker].totalPnL += pnl
    })

    analysis.avgPnL = executions.length > 0 ? analysis.totalPnL / executions.length : 0
    analysis.winRate = executions.length > 0 ? analysis.profitableTrades / executions.length : 0

    // Analyze by confidence level
    executions.forEach(exec => {
      const prediction = alphaPredictions.find(p => p.id === exec.predictionId)
      if (prediction) {
        const confidence = Math.floor(prediction.confidence * 10) / 10
        if (!analysis.pnlByConfidence[confidence]) {
          analysis.pnlByConfidence[confidence] = { trades: 0, totalPnL: 0, avgPnL: 0 }
        }
        analysis.pnlByConfidence[confidence].trades++
        analysis.pnlByConfidence[confidence].totalPnL += (exec.pnl || 0)
      }
    })

    // Calculate average PnL by confidence
    Object.keys(analysis.pnlByConfidence).forEach(confidence => {
      const data = analysis.pnlByConfidence[confidence]
      data.avgPnL = data.trades > 0 ? data.totalPnL / data.trades : 0
    })

    // Analyze by regime
    executions.forEach(exec => {
      const prediction = alphaPredictions.find(p => p.id === exec.predictionId)
      if (prediction && prediction.regime) {
        const regime = prediction.regime
        if (!analysis.pnlByRegime[regime]) {
          analysis.pnlByRegime[regime] = { trades: 0, totalPnL: 0, avgPnL: 0 }
        }
        analysis.pnlByRegime[regime].trades++
        analysis.pnlByRegime[regime].totalPnL += (exec.pnl || 0)
      }
    })

    // Calculate average PnL by regime
    Object.keys(analysis.pnlByRegime).forEach(regime => {
      const data = analysis.pnlByRegime[regime]
      data.avgPnL = data.trades > 0 ? data.totalPnL / data.trades : 0
    })

    return analysis
  }

  // Analyze effectiveness of individual risk rules
  analyzeRuleEffectiveness(riskBlocks) {
    const analysis = {
      rulePerformance: {},
      ruleAccuracy: {},
      ruleValue: {},
      overfiringRules: [],
      underperformingRules: []
    }

    // Group blocks by rule
    const blocksByRule = new Map()
    riskBlocks.forEach(block => {
      const rules = this.extractViolatedRules(block)
      rules.forEach(rule => {
        if (!blocksByRule.has(rule)) {
          blocksByRule.set(rule, [])
        }
        blocksByRule.get(rule).push(block)
      })
    })

    // Analyze each rule
    blocksByRule.forEach((blocks, rule) => {
      const outcomes = blocks.map(block => this.analyzeBlockedTradeOutcome(block, []))
      const savedLosses = outcomes.filter(o => o.savedLoss > o.missedProfit)
      const missedOpportunities = outcomes.filter(o => o.missedProfit > o.savedLoss)
      
      const totalSaved = savedLosses.reduce((sum, o) => sum + o.savedLoss, 0)
      const totalMissed = missedOpportunities.reduce((sum, o) => sum + o.missedProfit, 0)
      
      analysis.rulePerformance[rule] = {
        totalBlocks: blocks.length,
        savedLosses: savedLosses.length,
        missedOpportunities: missedOpportunities.length,
        totalSavedLosses: totalSaved,
        totalMissedOpportunities: totalMissed,
        netValue: totalSaved - totalMissed,
        accuracy: blocks.length > 0 ? savedLosses.length / blocks.length : 0
      }

      // Check for overfiring (blocks too many trades with low accuracy)
      if (blocks.length > 10 && analysis.rulePerformance[rule].accuracy < 0.6) {
        analysis.overfiringRules.push({
          rule,
          blocks: blocks.length,
          accuracy: analysis.rulePerformance[rule].accuracy,
          recommendation: 'Consider relaxing this rule or adjusting thresholds'
        })
      }

      // Check for underperforming (negative net value)
      if (analysis.rulePerformance[rule].netValue < -100) {
        analysis.underperformingRules.push({
          rule,
          netValue: analysis.rulePerformance[rule].netValue,
          recommendation: 'Review rule effectiveness - may be blocking profitable trades'
        })
      }
    })

    return analysis
  }

  // Generate optimization insights
  generateOptimizationInsights(blockedAnalysis, allowedAnalysis, ruleAnalysis) {
    const insights = []

    // Confidence threshold optimization
    const confidenceData = blockedAnalysis.confidenceAnalysis
    const optimalConfidence = this.findOptimalConfidence(confidenceData)
    if (optimalConfidence) {
      insights.push({
        type: 'confidence_optimization',
        priority: 'high',
        insight: `Optimal confidence threshold appears to be ${optimalConfidence.confidence}`,
        recommendation: `Adjust confidence threshold to ${optimalConfidence.confidence} to maximize risk-adjusted returns`,
        data: optimalConfidence
      })
    }

    // Rule adjustments
    ruleAnalysis.overfiringRules.forEach(rule => {
      insights.push({
        type: 'rule_adjustment',
        priority: 'medium',
        insight: `Rule "${rule.rule}" may be too restrictive`,
        recommendation: rule.recommendation,
        data: rule
      })
    })

    // Rule removal suggestions
    ruleAnalysis.underperformingRules.forEach(rule => {
      insights.push({
        type: 'rule_removal',
        priority: 'high',
        insight: `Rule "${rule.rule}" has negative net value`,
        recommendation: rule.recommendation,
        data: rule
      })
    })

    // Risk-reward optimization
    if (blockedAnalysis.netValue > 0) {
      insights.push({
        type: 'risk_reward_positive',
        priority: 'low',
        insight: 'Risk management is adding value',
        recommendation: 'Current risk settings are effective',
        data: { netValue: blockedAnalysis.netValue }
      })
    } else {
      insights.push({
        type: 'risk_reward_negative',
        priority: 'high',
        insight: 'Risk management may be too restrictive',
        recommendation: 'Consider relaxing risk parameters to capture more opportunities',
        data: { netValue: blockedAnalysis.netValue }
      })
    }

    return insights
  }

  // Generate training data for Alpha Engine
  generateTrainingData(blockedAnalysis, allowedAnalysis, optimizationInsights) {
    const trainingData = {
      riskAdjustments: [],
      confidenceThresholds: [],
      ruleEffectiveness: [],
      marketConditions: [],
      performanceMetrics: {}
    }

    // Risk adjustment training data
    Object.keys(blockedAnalysis.blocksByReason).forEach(reason => {
      const accuracy = blockedAnalysis.accuracyByReason[reason]
      if (accuracy) {
        trainingData.riskAdjustments.push({
          rule: reason,
          accuracy: accuracy.accuracy,
          totalBlocks: accuracy.total,
          adjustment: accuracy.accuracy > 0.7 ? 'maintain' : accuracy.accuracy > 0.5 ? 'optimize' : 'relax'
        })
      }
    })

    // Confidence threshold training data
    Object.keys(blockedAnalysis.confidenceAnalysis).forEach(confidence => {
      const data = blockedAnalysis.confidenceAnalysis[confidence]
      const accuracy = data.blocks > 0 ? data.savedLosses / data.blocks : 0
      
      trainingData.confidenceThresholds.push({
        confidence: parseFloat(confidence),
        blocks: data.blocks,
        accuracy,
        recommendation: accuracy > 0.7 ? 'good_threshold' : 'needs_adjustment'
      })
    })

    // Rule effectiveness data
    Object.keys(blockedAnalysis.ruleAnalysis?.rulePerformance || {}).forEach(rule => {
      const performance = blockedAnalysis.ruleAnalysis.rulePerformance[rule]
      trainingData.ruleEffectiveness.push({
        rule,
        accuracy: performance.accuracy,
        netValue: performance.netValue,
        recommendation: performance.netValue > 0 ? 'keep' : 'review'
      })
    })

    // Performance metrics for model evaluation
    trainingData.performanceMetrics = {
      totalBlocks: blockedAnalysis.totalBlocks,
      netValue: blockedAnalysis.netValue,
      accuracy: blockedAnalysis.totalBlocks > 0 ? 
        blockedAnalysis.savedLosses.length / blockedAnalysis.totalBlocks : 0,
      totalTrades: allowedAnalysis.totalTrades,
      winRate: allowedAnalysis.winRate,
      avgPnL: allowedAnalysis.avgPnL
    }

    return trainingData
  }

  // Helper methods
  getTimeframeCutoff(timeframe) {
    const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
    const cutoffDays = days[timeframe] || 30
    return new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000)
  }

  extractBlockReason(reason) {
    if (reason.includes('daily_loss')) return 'daily_loss'
    if (reason.includes('position_size')) return 'position_size'
    if (reason.includes('drawdown')) return 'drawdown'
    if (reason.includes('correlation')) return 'correlation'
    if (reason.includes('leverage')) return 'leverage'
    if (reason.includes('concurrent')) return 'concurrent_trades'
    if (reason.includes('sector')) return 'sector_concentration'
    if (reason.includes('ticker')) return 'ticker_concentration'
    return 'other'
  }

  extractViolatedRules(block) {
    const rules = []
    const reason = block.reason || ''
    
    if (reason.includes('daily_loss')) rules.push('daily_loss_limit')
    if (reason.includes('position_size')) rules.push('position_size_limit')
    if (reason.includes('drawdown')) rules.push('drawdown_limit')
    if (reason.includes('correlation')) rules.push('correlation_limit')
    if (reason.includes('leverage')) rules.push('leverage_limit')
    if (reason.includes('concurrent')) rules.push('concurrent_trades_limit')
    if (reason.includes('sector')) rules.push('sector_concentration_limit')
    if (reason.includes('ticker')) rules.push('ticker_concentration_limit')
    
    return rules
  }

  analyzeBlockedTradeOutcome(block, alphaPredictions) {
    // This would analyze what would have happened if the trade was allowed
    // For now, return placeholder data
    const prediction = alphaPredictions.find(p => p.id === block.predictionId)
    
    // Simulate outcome based on prediction accuracy
    const wouldHaveLost = Math.random() > 0.6 // 60% of blocks would have lost money
    const potentialLoss = wouldHaveLost ? Math.random() * 500 + 50 : 0
    const potentialProfit = !wouldHaveLost ? Math.random() * 300 + 20 : 0
    
    return {
      savedLoss: potentialLoss,
      missedProfit: potentialProfit,
      netOutcome: potentialProfit - potentialLoss,
      confidence: prediction?.confidence || 0.5,
      prediction: prediction?.direction || 'unknown'
    }
  }

  findOptimalConfidence(confidenceData) {
    let bestConfidence = null
    let bestRatio = -Infinity
    
    Object.keys(confidenceData).forEach(confidence => {
      const data = confidenceData[confidence]
      if (data.blocks > 0) {
        const ratio = data.savedLosses / data.blocks // Ratio of good blocks
        if (ratio > bestRatio) {
          bestRatio = ratio
          bestConfidence = {
            confidence: parseFloat(confidence),
            accuracy: ratio,
            blocks: data.blocks
          }
        }
      }
    })
    
    return bestConfidence
  }

  generateAnalysisSummary(blockedAnalysis, allowedAnalysis, ruleAnalysis) {
    return {
      totalRiskDecisions: blockedAnalysis.totalBlocks + allowedAnalysis.totalTrades,
      riskManagementValue: blockedAnalysis.netValue,
      riskAccuracy: blockedAnalysis.totalBlocks > 0 ? 
        blockedAnalysis.savedLosses.length / blockedAnalysis.totalBlocks : 0,
      tradingPerformance: {
        totalTrades: allowedAnalysis.totalTrades,
        winRate: allowedAnalysis.winRate,
        avgPnL: allowedAnalysis.avgPnL
      },
      ruleHealth: {
        totalRules: Object.keys(ruleAnalysis.rulePerformance || {}).length,
        overfiringRules: ruleAnalysis.overfiringRules.length,
        underperformingRules: ruleAnalysis.underperformingRules.length
      }
    }
  }

  // Export training data for Alpha Engine
  async exportTrainingData(portfolioId, timeframe = '30d') {
    try {
      const analysis = await this.analyzeRiskOutcomes(portfolioId, timeframe)
      
      // Format for Alpha Engine consumption
      const exportData = {
        metadata: {
          portfolioId,
          timeframe,
          exportDate: new Date(),
          version: '1.0'
        },
        trainingData: analysis.trainingData,
        insights: analysis.optimizationInsights,
        summary: analysis.summary
      }

      // In production, this would save to a file or send to Alpha Engine API
      console.log('Training data exported for Alpha Engine:', exportData)
      
      return exportData
    } catch (error) {
      console.error('Failed to export training data:', error)
      throw error
    }
  }
}

export const riskOutcomeAnalyzer = new RiskOutcomeAnalyzer()
