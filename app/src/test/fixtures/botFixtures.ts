export const mockBots = [
  {
    id: 'bot-1',
    name: 'SPY Trend Bot',
    botType: 'rule_based',
    enabled: true,
    config: {
      tickers: ['SPY'],
      quantity: 100,
      direction: 'buy'
    },
    portfolioId: 'prt_stub_demo',
    templateId: 'trend-template',
    strategyId: null,
    userId: 'user-1',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    deletedAt: null
  },
  {
    id: 'bot-2',
    name: 'AAPL Momentum Bot',
    botType: 'strategy_based',
    enabled: false,
    config: {
      tickers: ['AAPL'],
      quantity: 50,
      direction: 'buy'
    },
    portfolioId: 'prt_stub_demo',
    templateId: null,
    strategyId: 'strategy-1',
    userId: 'user-1',
    createdAt: '2024-01-14T15:30:00Z',
    updatedAt: '2024-01-14T15:30:00Z',
    deletedAt: null
  },
  {
    id: 'bot-3',
    name: 'Archived Test Bot',
    botType: 'rule_based',
    enabled: false,
    config: {
      tickers: ['TSLA'],
      quantity: 25,
      direction: 'sell'
    },
    portfolioId: 'prt_stub_demo',
    templateId: 'momentum-template',
    strategyId: null,
    userId: 'user-1',
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-12T16:00:00Z',
    deletedAt: '2024-01-13T10:00:00Z'
  }
]

export const mockTemplates = [
  {
    id: 'trend-template',
    name: 'SPY Trend Filter',
    description: 'Trend following strategy for SPY with risk management',
    botType: 'rule_based',
    config: {
      tickers: ['SPY'],
      quantity: 100,
      direction: 'buy'
    },
    rules: [
      {
        name: 'Market Hours',
        type: 'market_hours',
        config: {}
      },
      {
        name: 'Trend Filter',
        type: 'trend_filter',
        config: {
          symbol: 'SPY',
          confirmationBars: 2,
          maxSnapshotAgeHours: 90
        }
      }
    ],
    tags: ['trend', 'risk_management'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'momentum-template',
    name: 'Momentum Swing',
    description: 'Momentum-based swing trading strategy',
    botType: 'rule_based',
    config: {
      tickers: ['AAPL', 'MSFT'],
      quantity: 50,
      direction: 'buy'
    },
    rules: [
      {
        name: 'Price Threshold',
        type: 'price_threshold',
        config: {
          minPrice: 100,
          maxPrice: 500
        }
      }
    ],
    tags: ['momentum', 'swing'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  }
]

export const mockBotEvents = [
  {
    id: 'event-1',
    botId: 'bot-1',
    portfolioId: 'prt_stub_demo',
    ruleId: 'rule-1',
    executionId: 'exec-1',
    type: 'rule_triggered',
    detail: 'Trend filter rule triggered - risk_on regime detected',
    metadata: {
      regime: 'risk_on',
      confidence: 0.85
    },
    createdAt: '2024-01-15T10:30:00Z'
  },
  {
    id: 'event-2',
    botId: 'bot-1',
    portfolioId: 'prt_stub_demo',
    ruleId: null,
    executionId: 'exec-1',
    type: 'execution_created',
    detail: 'Buy execution created for SPY',
    metadata: {
      ticker: 'SPY',
      quantity: 100,
      price: 450.25
    },
    createdAt: '2024-01-15T10:31:00Z'
  }
]

export const mockBotRules = [
  {
    id: 'rule-1',
    botId: 'bot-1',
    name: 'Market Hours',
    type: 'market_hours',
    config: {},
    enabled: true,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z'
  },
  {
    id: 'rule-2',
    botId: 'bot-1',
    name: 'Trend Filter',
    type: 'trend_filter',
    config: {
      symbol: 'SPY',
      confirmationBars: 2,
      maxSnapshotAgeHours: 90
    },
    enabled: true,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z'
  }
]
