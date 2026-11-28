import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BrokerTab from '../BrokerTab'
import * as AuthProviderModule from '../../../app/AuthProvider.jsx'
import * as ProfileClientModule from '../../../api/profileClient.js'

vi.mock('../../../app/AuthProvider.jsx', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../../api/profileClient.js', () => ({
  fetchReconcileStatus: vi.fn(),
  triggerReconcile: vi.fn(),
}))

describe('BrokerTab', () => {
  const saveAlpacaKeys = vi.fn()
  const refreshBrokerStatus = vi.fn().mockResolvedValue({})
  const disconnectBroker = vi.fn().mockResolvedValue({ ok: true })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders disconnected state when not connected', () => {
    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: { connected: false },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker,
    })

    render(<BrokerTab />)

    expect(screen.getByText('Not Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Alpaca' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live (Disabled)' })).toBeDisabled()
    expect(screen.queryByText('Verified Alpaca Paper Balances')).not.toBeInTheDocument()
  })

  it('renders verified balances and disconnect button when connected to paper trading', () => {
    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: {
        connected: true,
        paper: true,
        status: 'active',
        accountNumber: 'PA12345678',
        equity: 100000,
        cash: 95000,
        buyingPower: 200000,
        lastVerifiedAt: '2026-11-21T01:00:00Z',
      },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker,
    })

    render(<BrokerTab />)

    expect(screen.getByText('Paper Trading — Connected')).toBeInTheDocument()
    expect(screen.getByText('Verified Alpaca Paper Balances')).toBeInTheDocument()
    expect(screen.getByText('$100,000.00')).toBeInTheDocument()
    expect(screen.getByText('$95,000.00')).toBeInTheDocument()
    expect(screen.getByText('$200,000.00')).toBeInTheDocument()
    expect(screen.getByText('PA12345678')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect Account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update Credentials' })).toBeInTheDocument()
  })

  it('calls disconnectBroker when Disconnect Account is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: {
        connected: true,
        paper: true,
        status: 'active',
        equity: 50000,
      },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker,
    })

    render(<BrokerTab />)

    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect Account' })
    fireEvent.click(disconnectBtn)

    await waitFor(() => {
      expect(disconnectBroker).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Alpaca broker account disconnected.')).toBeInTheDocument()
    })
  })

  it('saves new Alpaca credentials on submit', async () => {
    saveAlpacaKeys.mockResolvedValue({ ok: true })

    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: { connected: false },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker,
    })

    render(<BrokerTab />)

    const keyInput = screen.getByLabelText(/API Key/i)
    const secretInput = screen.getByLabelText(/API Secret/i)
    const connectBtn = screen.getByRole('button', { name: 'Connect Alpaca' })

    fireEvent.change(keyInput, { target: { value: 'PKTESTKEY123' } })
    fireEvent.change(secretInput, { target: { value: 'SKTESTSECRET456' } })
    fireEvent.click(connectBtn)

    await waitFor(() => {
      expect(saveAlpacaKeys).toHaveBeenCalledWith('PKTESTKEY123', 'SKTESTSECRET456', true)
      expect(screen.getByText(/Alpaca paper account connected/i)).toBeInTheDocument()
    })
  })

  it('renders in-sync ledger status and triggers manual reconciliation', async () => {
    ProfileClientModule.fetchReconcileStatus.mockResolvedValue({
      synced: true,
      lastSyncStatus: 'ok',
      lastSyncedAt: '2026-11-26T04:00:00Z',
      inSync: true,
      mismatchCount: 0,
      mismatchDetails: [],
      positionSource: 'db'
    })
    ProfileClientModule.triggerReconcile.mockResolvedValue({
      imported: 3,
      scannedOrders: 10,
      inSync: true
    })

    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: { connected: true, paper: true, status: 'active', equity: 100000 },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker
    })

    render(<BrokerTab />)

    await waitFor(() => {
      expect(screen.getByText(/Broker Ledger & Position Reconciliation/i)).toBeInTheDocument()
      expect(screen.getByText(/✓ Ledger In Sync/i)).toBeInTheDocument()
    })

    const reconcileBtn = screen.getByRole('button', { name: /Reconcile Activity Now/i })
    fireEvent.click(reconcileBtn)

    await waitFor(() => {
      expect(ProfileClientModule.triggerReconcile).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Reconciliation complete. Scanned 10 orders \(imported 3\)/i)).toBeInTheDocument()
    })
  })

  it('renders position drift warning and mismatch details table when ledger is drifted', async () => {
    ProfileClientModule.fetchReconcileStatus.mockResolvedValue({
      synced: true,
      lastSyncStatus: 'ok',
      lastSyncedAt: '2026-11-26T04:00:00Z',
      inSync: false,
      mismatchCount: 2,
      mismatchDetails: [
        { symbol: 'AAPL', localQty: 10, brokerQty: 0, brokerAvgPrice: 0 },
        { symbol: 'SPY', localQty: 50, brokerQty: 45, brokerAvgPrice: 590.5 }
      ],
      positionSource: 'broker'
    })

    AuthProviderModule.useAuth.mockReturnValue({
      brokerStatus: { connected: true, paper: true, status: 'active', equity: 100000 },
      saveAlpacaKeys,
      refreshBrokerStatus,
      disconnectBroker
    })

    render(<BrokerTab />)

    await waitFor(() => {
      expect(screen.getByText(/⚠ Position Drift \(2 mismatches\)/i)).toBeInTheDocument()
      expect(screen.getByText('AAPL')).toBeInTheDocument()
      expect(screen.getByText('SPY')).toBeInTheDocument()
      expect(screen.getByText('$590.50')).toBeInTheDocument()
    })
  })
})
