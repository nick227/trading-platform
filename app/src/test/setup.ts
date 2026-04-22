import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock API client
vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn()
}))

// Mock React Router
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ botId: 'test-bot-id' }),
  useLocation: () => ({ state: null })
}))

// Mock App Provider
vi.mock('../app/AppProvider', () => ({
  useApp: () => ({
    state: { bots: [] },
    dispatch: vi.fn()
  })
}))

// Global test utilities
declare global {
  var testUtils: {
    createMockBot: (overrides?: any) => any
    createMockTemplate: (overrides?: any) => any
  }
}

global.testUtils = {
  createMockBot: (overrides = {}) => ({
    id: 'test-bot-id',
    name: 'Test Bot',
    botType: 'rule_based',
    enabled: true,
    config: {
      tickers: ['SPY'],
      quantity: 10,
      direction: 'buy'
    },
    portfolioId: 'prt_stub_demo',
    templateId: 'test-template',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides
  }),
  
  createMockTemplate: (overrides = {}) => ({
    id: 'test-template',
    name: 'Test Template',
    description: 'A test template',
    botType: 'rule_based',
    config: {
      tickers: ['SPY'],
      quantity: 10,
      direction: 'buy'
    },
    rules: [],
    tags: ['test'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  })
};
