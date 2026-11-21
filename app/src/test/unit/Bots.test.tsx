import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Bots from '../../features/Bots'
import { mockBots, mockTemplates } from '../fixtures/botFixtures'

// Mock the API service
const { mockGetBots, mockGetBotCatalog, mockDeleteBot, mockUpdateBot } = vi.hoisted(() => ({
  mockGetBots: vi.fn(),
  mockGetBotCatalog: vi.fn(),
  mockDeleteBot: vi.fn(),
  mockUpdateBot: vi.fn()
}))

vi.mock('../../api/services/botCatalogService', () => ({
  getBotCatalog: mockGetBotCatalog,
  getBots: mockGetBots,
  deleteBot: mockDeleteBot,
  updateBot: mockUpdateBot
}))

// Mock AuthProvider and strategiesService
vi.mock('../../app/AuthProvider', () => ({
  useAuth: () => ({ brokerStatus: { connected: true } })
}))

vi.mock('../../api/services/strategiesService', () => ({
  default: {
    getPlatformStrategies: vi.fn().mockResolvedValue([])
  }
}))

// Mock React Router
const { MockNavigate } = vi.hoisted(() => ({
  MockNavigate: vi.fn()
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => MockNavigate,
    useParams: () => ({}),
    useLocation: () => ({ state: null })
  }
})

const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  )
}

describe('Bots Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '')
  })

  it('should render loading state initially', () => {
    mockGetBots.mockResolvedValue([])
    mockGetBotCatalog.mockResolvedValue({ ruleBased: [], strategyBased: [] })

    renderWithRouter(<Bots />)

    expect(screen.getByText('Loading bots...')).toBeInTheDocument()
  })

  it('should display bots after loading', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
      expect(screen.getByText('AAPL Momentum Bot')).toBeInTheDocument()
    })
  })

  it('should display bot status counts correctly', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('1 Running')).toBeInTheDocument()
      expect(screen.getByText('2 Paused')).toBeInTheDocument()
      expect(screen.getByText('1 Archived')).toBeInTheDocument()
      expect(screen.getByText('3 Bots')).toBeInTheDocument()
    })
  })

  it('should filter bots by status', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
      expect(screen.getByText('AAPL Momentum Bot')).toBeInTheDocument()
      expect(screen.getByText('Archived Test Bot')).toBeInTheDocument()
    })

    // Filter to running bots only
    fireEvent.click(screen.getByRole('button', { name: /1 running/i }))

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
      expect(screen.queryByText('AAPL Momentum Bot')).not.toBeInTheDocument()
      expect(screen.queryByText('Archived Test Bot')).not.toBeInTheDocument()
    })
  })

  it('should handle bot status toggle', async () => {
    const updatedBots = mockBots.map(bot => 
      bot.id === 'bot-1' ? { ...bot, enabled: false } : bot
    )
    mockGetBots
      .mockResolvedValueOnce(mockBots)
      .mockResolvedValueOnce(updatedBots)
    mockUpdateBot.mockResolvedValue(mockBots[0])
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
    })

    // Find and click the pause button for the first bot
    const pauseButton = screen.getAllByText('Pause')[0]
    fireEvent.click(pauseButton)

    await waitFor(() => {
      expect(mockUpdateBot).toHaveBeenCalledWith('bot-1', { enabled: false })
    })
  })

  it('should handle bot deletion', async () => {
    const updatedBots = mockBots.filter(bot => bot.id !== 'bot-1')
    mockGetBots
      .mockResolvedValueOnce(mockBots)
      .mockResolvedValueOnce(updatedBots)
    mockDeleteBot.mockResolvedValue({ success: true })
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    // Mock window.confirm
    const mockConfirm = vi.fn(() => true)
    Object.defineProperty(window, 'confirm', {
      value: mockConfirm,
      writable: true
    })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
    })

    // Find and click the delete button for the first bot
    const deleteButtons = screen.getAllByText('Delete')
    fireEvent.click(deleteButtons[0])

    expect(mockConfirm).toHaveBeenCalledWith('Delete bot "SPY Trend Bot"? This will soft delete the bot but preserve all historical data.')

    await waitFor(() => {
      expect(mockDeleteBot).toHaveBeenCalledWith('bot-1')
    })
  })

  it('should display error message when API fails', async () => {
    mockGetBots.mockRejectedValue(new Error('API Error'))
    mockGetBotCatalog.mockResolvedValue({ ruleBased: [], strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument()
      expect(screen.getByText('Failed to load bots. Please try again.')).toBeInTheDocument()
    })
  })

  it('should display success message from navigation state', async () => {
    window.history.replaceState({ 
      success: true, 
      botName: 'Test Bot' 
    }, '')

    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument()
      expect(screen.getByText('Bot "Test Bot" created successfully!')).toBeInTheDocument()
    })
  })

  it('should navigate to bot details when Manage button is clicked', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
    })

    const manageButton = screen.getAllByText('View Details')[0]
    fireEvent.click(manageButton)

    expect(MockNavigate).toHaveBeenCalledWith('/bots/bot-1')
  })

  it('should navigate to bot history when History button is clicked', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('SPY Trend Bot')).toBeInTheDocument()
    })

    const historyButton = screen.getByText('View Bot History')
    fireEvent.click(historyButton)

    expect(MockNavigate).toHaveBeenCalledWith('/bots/bot-1/history')
  })

  it('should display bot configuration details correctly', async () => {
    mockGetBots.mockResolvedValue(mockBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: mockTemplates, strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getAllByText('Type: rule_based').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Portfolio: prt_stub_demo').length).toBeGreaterThan(0)
      expect(screen.getByText('Template: trend-template')).toBeInTheDocument()
      expect(screen.getAllByText(/SPY/).length).toBeGreaterThan(0)
    })
  })

  it('should show empty state when no bots match filter', async () => {
    const emptyBots = []
    mockGetBots.mockResolvedValue(emptyBots)
    mockGetBotCatalog.mockResolvedValue({ ruleBased: [], strategyBased: [] })

    renderWithRouter(<Bots />)

    await waitFor(() => {
      expect(screen.getByText('No bots found')).toBeInTheDocument()
      expect(screen.getByText('No bots match the selected filter.')).toBeInTheDocument()
    })
  })
})
