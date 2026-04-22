// Risk Management Configuration
// Centralized configuration for all risk thresholds and parameters

export const riskConfig = {
  // Position sizing thresholds
  positionSizing: {
    defaultMaxPositionSize: 0.1, // 10% of portfolio
    minPositionSize: 0.01, // 1% of portfolio
    maxPositionMultiplier: 1.5, // 150% of base size
    minPositionMultiplier: 0.1, // 10% of base size
    
    // Regime-based multipliers
    regimeMultipliers: {
      risk_off: 0.3,
      neutral: 0.6,
      risk_on: 1.0,
      strong_bull: 1.2,
      strong_bear: 0.2
    },
    
    // Confidence-based multipliers
    confidenceMultipliers: {
      very_high: { min: 0.8, multiplier: 1.2 },
      high: { min: 0.6, multiplier: 1.0 },
      medium: { min: 0.4, multiplier: 0.8 },
      low: { min: 0.2, multiplier: 0.5 },
      very_low: { min: 0.0, multiplier: 0.3 }
    },
    
    // Portfolio health multipliers
    healthMultipliers: {
      drawdown: {
        severe: { threshold: 0.1, multiplier: 0.5 },
        high: { threshold: 0.05, multiplier: 0.7 },
        moderate: { threshold: 0.03, multiplier: 0.9 }
      },
      dailyLoss: {
        critical: { threshold: 0.9, multiplier: 0.6 },
        high: { threshold: 0.7, multiplier: 0.8 }
      }
    },
    
    // Volatility adjustments
    volatilityMultipliers: {
      very_high: { threshold: 0.3, multiplier: 0.7 },
      high: { threshold: 0.2, multiplier: 0.85 },
      low: { threshold: 0.1, multiplier: 1.1 },
      very_low: { threshold: 0.05, multiplier: 1.2 }
    }
  },

  // Concentration limits
  concentration: {
    sector: {
      maxExposure: 0.4, // 40% max per sector
      warningThreshold: 0.3, // Warning at 30%
      criticalThreshold: 0.45 // Critical at 45%
    },
    ticker: {
      maxExposure: 0.2, // 20% max per ticker
      warningThreshold: 0.15, // Warning at 15%
      criticalThreshold: 0.25 // Critical at 25%
    },
    beta: {
      maxBeta: 1.5,
      warningThreshold: 1.2,
      criticalThreshold: 1.8
    },
    overnight: {
      maxExposure: 0.6, // 60% max overnight
      warningThreshold: 0.5,
      criticalThreshold: 0.7,
      marketCloseBuffer: 30 * 60 * 1000 // 30 minutes before close
    }
  },

  // Drawdown protection
  drawdownProtection: {
    thresholds: {
      warning: 0.8, // 80% of max drawdown
      critical: 1.0, // 100% of max drawdown
      recovery: 0.7 // 70% of max drawdown for recovery
    },
    
    // Throttling settings
    throttling: {
      enabled: true,
      triggerThreshold: 0.8,
      settings: {
        maxPositionSize: 0.05, // Reduce to 5%
        maxRiskPerTrade: 0.01, // Reduce to 1%
        maxConcurrentTrades: 2,
        stopLossPercentage: 0.03
      },
      duration: 24 * 60 * 60 * 1000, // 24 hours
      autoRecovery: true,
      recoveryPeriod: 5 * 60 * 1000 // 5 minutes
    },
    
    // Pause settings
    pause: {
      enabled: true,
      triggerThreshold: 1.0,
      autoRecovery: true,
      recoveryCheckInterval: 10 * 60 * 1000, // Check every 10 minutes
      maxRecoveryAttempts: 3
    }
  },

  // Risk limits
  riskLimits: {
    daily: {
      maxLoss: 1000,
      warningThreshold: 800,
      criticalThreshold: 950
    },
    leverage: {
      maxRatio: 2.0,
      warningThreshold: 1.5,
      criticalThreshold: 1.8
    },
    account: {
      minBalance: 1000,
      warningThreshold: 1200,
      criticalThreshold: 800
    },
    concurrentTrades: {
      maxTrades: 5,
      warningThreshold: 4,
      criticalThreshold: 5
    },
    riskPerTrade: {
      maxRisk: 0.02, // 2% of portfolio
      warningThreshold: 0.015,
      criticalThreshold: 0.018
    }
  },

  // Notification settings
  notifications: {
    cooldowns: {
      critical: 0, // No cooldown for critical
      high: 5 * 60 * 1000, // 5 minutes
      medium: 15 * 60 * 1000, // 15 minutes
      low: 30 * 60 * 1000 // 30 minutes
    },
    
    rateLimits: {
      perHour: {
        critical: 10,
        high: 5,
        medium: 3,
        low: 2
      },
      perDay: {
        critical: 50,
        high: 25,
        medium: 15,
        low: 10
      }
    },
    
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00',
      timezone: 'America/New_York'
    },
    
    channels: {
      email: { enabled: true, priority: ['critical', 'high'] },
      sms: { enabled: false, priority: ['critical'] },
      push: { enabled: true, priority: ['critical', 'high', 'medium'] },
      inApp: { enabled: true, priority: ['critical', 'high', 'medium', 'low'] }
    }
  },

  // Bot degradation detection
  botDegradation: {
    monitoring: {
      enabled: true,
      interval: 5 * 60 * 1000, // Check every 5 minutes
      lookbackPeriod: 7 * 24 * 60 * 60 * 1000 // Last 7 days
    },
    
    thresholds: {
      consecutiveLosses: {
        warning: 4,
        critical: 6
      },
      winRate: {
        minTrades: 10,
        warning: 0.4,
        critical: 0.3
      },
      volatility: {
        warning: 0.5,
        critical: 0.7
      },
      consistency: {
        minTrades: 10,
        warning: 0.4,
        critical: 0.3
      },
      errorRate: {
        warning: 0.05, // 5%
        critical: 0.1 // 10%
      },
      slippage: {
        warning: 0.3, // 0.3%
        critical: 0.5 // 0.5%
      },
      inactivity: {
        warning: 12 * 60 * 60 * 1000, // 12 hours
        critical: 24 * 60 * 60 * 1000 // 24 hours
      }
    },
    
    actions: {
      throttle: {
        enabled: true,
        severityThreshold: 60, // 60% severity score
        reductionFactor: 0.5 // Reduce activity by 50%
      },
      disable: {
        enabled: true,
        severityThreshold: 80, // 80% severity score
        autoRecovery: true
      }
    }
  },

  // Capital allocation
  capitalAllocation: {
    maxAllocationPercent: 0.8, // Allocate max 80% of portfolio
    maxBotAllocation: 0.3, // Max 30% per bot
    maxTickerAllocation: 50000, // Max $50k per ticker across all bots
    rebalanceFrequency: 7 * 24 * 60 * 60 * 1000, // Rebalance weekly
    minAllocationAmount: 1000 // Minimum $1000 per bot
  },

  // Correlation settings
  correlation: {
    cacheTtl: 24 * 60 * 60 * 1000, // 24 hours
    defaultPeriod: 30, // 30 days
    minDataPoints: 20,
    maxCorrelationMatrix: 100, // Max 100 tickers in matrix
    fallbackCorrelation: {
      same_sector: 0.7,
      different_sector: 0.3,
      unknown: 0.5
    }
  },

  // Cache settings
  cache: {
    portfolioState: {
      ttl: 30 * 1000, // 30 seconds
      maxSize: 1000 // Max 1000 cached states
    },
    riskSettings: {
      ttl: 5 * 60 * 1000, // 5 minutes
      maxSize: 500
    },
    sizing: {
      ttl: 5 * 60 * 1000, // 5 minutes
      maxSize: 200
    },
    notifications: {
      ttl: 60 * 60 * 1000, // 1 hour
      maxSize: 1000
    }
  },

  // Performance and monitoring
  monitoring: {
    healthCheck: {
      enabled: true,
      interval: 60 * 1000, // Every minute
      timeout: 10 * 1000 // 10 second timeout
    },
    
    metrics: {
      enabled: true,
      retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
      aggregationInterval: 5 * 60 * 1000 // 5 minutes
    },
    
    alerts: {
      enabled: true,
      thresholds: {
        errorRate: 0.05, // 5% error rate
        responseTime: 1000, // 1 second response time
        cacheHitRate: 0.8 // 80% cache hit rate
      }
    }
  },

  // Regime detection
  regime: {
    enabled: true,
    cacheTtl: 5 * 60 * 1000, // 5 minutes
    defaultRegime: 'neutral',
    confidenceThreshold: 0.6,
    lookbackPeriod: 30 * 24 * 60 * 60 * 1000 // 30 days
  },

  // Risk scoring
  riskScoring: {
    weights: {
      drawdown: 0.3,
      dailyLoss: 0.2,
      concentration: 0.2,
      leverage: 0.15,
      volatility: 0.1,
      consistency: 0.05
    },
    
    thresholds: {
      low: 80,
      medium: 60,
      high: 40,
      critical: 20
    }
  }
}

// Environment-specific overrides
export function getRiskConfig(environment = 'development') {
  const overrides = {
    development: {
      // More lenient settings for development
      riskLimits: {
        daily: { maxLoss: 2000 },
        leverage: { maxRatio: 3.0 }
      },
      notifications: {
        cooldowns: {
          critical: 0,
          high: 60 * 1000, // 1 minute
          medium: 5 * 60 * 1000, // 5 minutes
          low: 10 * 60 * 1000 // 10 minutes
        }
      }
    },
    
    staging: {
      // Production-like settings for staging
      riskLimits: {
        daily: { maxLoss: 1500 },
        leverage: { maxRatio: 2.5 }
      }
    },
    
    production: {
      // Strict production settings
      riskLimits: {
        daily: { maxLoss: 1000 },
        leverage: { maxRatio: 2.0 }
      },
      monitoring: {
        healthCheck: {
          interval: 30 * 1000 // 30 seconds
        }
      }
    }
  }

  return deepMerge(riskConfig, overrides[environment] || {})
}

// Deep merge utility for configuration overrides
function deepMerge(target, source) {
  const result = { ...target }
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  
  return result
}

// Configuration validation
export function validateConfig(config) {
  const errors = []
  
  // Validate position sizing
  if (config.positionSizing?.maxPositionMultiplier > 3) {
    errors.push('Max position multiplier cannot exceed 3')
  }
  
  // Validate concentration limits
  if (config.concentration?.sector?.maxExposure > 0.6) {
    errors.push('Sector concentration cannot exceed 60%')
  }
  
  // Validate risk limits
  if (config.riskLimits?.daily?.maxLoss < 0) {
    errors.push('Daily loss limit cannot be negative')
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

// Configuration migration helpers
export function migrateConfig(oldConfig, newConfigVersion) {
  // Handle configuration migrations between versions
  switch (newConfigVersion) {
    case '2.0.0':
      // Migrate from 1.x to 2.0.0
      return {
        ...oldConfig,
        notifications: {
          ...oldConfig.notifications,
          quietHours: oldConfig.quietHours || {
            enabled: false,
            start: '22:00',
            end: '08:00'
          }
        }
      }
    default:
      return oldConfig
  }
}

export default riskConfig
