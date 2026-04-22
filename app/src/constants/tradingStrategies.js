// Rule-Based Trading Templates
export const RULE_BASED_TEMPLATES = [
  {
    id: 'momentum_crossover',
    name: 'Momentum Crossover',
    description: 'Buy when price crosses above 50-day MA with RSI confirmation',
    category: 'technical',
    metadata: {
      cadence: 'Intraday',
      edge: '+2.1% avg return',
      riskLevel: 'medium'
    },
    rules: [
      {
        id: 'ma_crossover',
        type: 'price_threshold',
        config: {
          indicator: 'SMA_50',
          operator: 'crosses_above',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'rsi_confirmation',
        type: 'price_threshold', 
        config: {
          indicator: 'RSI',
          operator: 'greater_than',
          value: 50,
          action: 'confirm_buy'
        }
      },
      {
        id: 'sell_ma_crossunder',
        type: 'price_threshold',
        config: {
          indicator: 'SMA_50', 
          operator: 'crosses_below',
          value: 'current_price',
          action: 'sell_signal'
        }
      },
      {
        id: 'market_hours',
        type: 'market_hours',
        config: {
          start: '09:30',
          end: '16:00',
          timezone: 'ET'
        }
      }
    ]
  },
  {
    id: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Buy at lower Bollinger Band, sell at upper band with volume confirmation',
    category: 'technical',
    metadata: {
      cadence: 'Daily',
      edge: '+1.8% avg return', 
      riskLevel: 'low'
    },
    rules: [
      {
        id: 'bb_lower_buy',
        type: 'price_threshold',
        config: {
          indicator: 'BOLLINGER_LOWER',
          operator: 'touches_or_crosses_below',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'volume_confirmation',
        type: 'price_threshold',
        config: {
          indicator: 'VOLUME',
          operator: 'greater_than', 
          value: 'AVG_VOLUME_20',
          action: 'confirm_buy'
        }
      },
      {
        id: 'bb_upper_sell',
        type: 'price_threshold',
        config: {
          indicator: 'BOLLINGER_UPPER',
          operator: 'touches_or_crosses_above',
          value: 'current_price', 
          action: 'sell_signal'
        }
      },
      {
        id: 'stop_loss',
        type: 'position_limit',
        config: {
          max_loss_percent: 5,
          action: 'sell_signal'
        }
      }
    ]
  },
  {
    id: 'breakout_trading',
    name: 'Breakout Trading', 
    description: 'Trade price breakouts from consolidation with volume spike confirmation',
    category: 'technical',
    metadata: {
      cadence: 'Weekly',
      edge: '+3.2% avg return',
      riskLevel: 'high'
    },
    rules: [
      {
        id: 'resistance_breakout',
        type: 'price_threshold',
        config: {
          indicator: 'RESISTANCE_LEVEL',
          operator: 'breaks_above',
          value: 'current_price',
          action: 'buy_signal'
        }
      },
      {
        id: 'volume_spike',
        type: 'price_threshold',
        config: {
          indicator: 'VOLUME',
          operator: 'greater_than',
          value: 'AVG_VOLUME_20 * 2',
          action: 'confirm_buy'
        }
      },
      {
        id: 'support_breakdown',
        type: 'price_threshold',
        config: {
          indicator: 'SUPPORT_LEVEL',
          operator: 'breaks_below',
          value: 'current_price',
          action: 'sell_signal'
        }
      },
      {
        id: 'trailing_stop',
        type: 'position_limit',
        config: {
          trailing_stop_percent: 3,
          action: 'sell_signal'
        }
      }
    ]
  }
]

// Strategy-Based Financial Theory Algorithms
export const STRATEGY_BASED_TEMPLATES = [
  {
    id: 'pairs_trading',
    name: 'Pairs Trading',
    description: 'Statistical arbitrage between correlated assets using mean reversion',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Intraday',
      edge: '+2.8% avg return',
      riskLevel: 'medium',
      correlation_threshold: 0.7,
      lookback_period: 60
    },
    algorithm: {
      type: 'statistical_arbitrage',
      signals: [
        'price_ratio_zscore',
        'correlation_divergence', 
        'mean_reversion_signal'
      ],
      parameters: {
        zscore_threshold: 2.0,
        min_correlation: 0.7,
        max_position_size: 0.1,
        holding_period: '1-5 days'
      }
    }
  },
  {
    id: 'options_flow',
    name: 'Options Flow Analysis',
    description: 'Detect unusual options activity to predict stock movements',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Real-time',
      edge: '+4.1% avg return',
      riskLevel: 'high',
      data_sources: ['options_chain', 'unusual_volume', 'institutional_flow']
    },
    algorithm: {
      type: 'options_sentiment',
      signals: [
        'unusual_volume_ratio',
        'put_call_ratio_anomaly',
        'institutional_flow_direction',
        'implied_volatility_skew'
      ],
      parameters: {
        volume_threshold: 5.0, // 5x average
        min_contract_value: 1000000,
        sentiment_weight: 0.6,
        flow_weight: 0.4
      }
    }
  },
  {
    id: 'sentiment_analysis',
    name: 'Sentiment Analysis',
    description: 'Analyze news and social media sentiment for trading signals',
    category: 'alpha_engine',
    metadata: {
      cadence: 'Hourly',
      edge: '+2.3% avg return',
      riskLevel: 'medium',
      data_sources: ['news', 'twitter', 'reddit', 'analyst_ratings']
    },
    algorithm: {
      type: 'sentiment_scoring',
      signals: [
        'news_sentiment_score',
        'social_media_momentum',
        'analyst_consensus_shift',
        'earnings_surprise_impact'
      ],
      parameters: {
        sentiment_threshold: 0.3,
        news_weight: 0.4,
        social_weight: 0.3,
        analyst_weight: 0.3,
        decay_period: 24 // hours
      }
    }
  }
]
