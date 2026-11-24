import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { get } from '../../../../api/client'
import SymbolContext from '../SymbolContext'

describe('SymbolContext (Watch)', () => {
  it('toggles supported symbols and shows company details fetched on demand', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/market/assets/AAPL') return { success: true, data: { status: 'available', symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', tradable: true } }
      const e = new Error('HTTP 404'); e.status = 404; throw e
    })
    const onToggle = vi.fn()
    render(<SymbolContext selected={['AAPL', 'TSLA']} supported={['SPY', 'AAPL']} onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'AAPL' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'SPY' }))
    expect(onToggle).toHaveBeenCalledWith('SPY')
    await waitFor(() => expect(screen.getByTestId('asset-AAPL')).toHaveTextContent('AAPL · Apple Inc. Common Stock · NASDAQ'))
    await waitFor(() => expect(screen.getByTestId('asset-TSLA')).toHaveTextContent('not available in paper trading'))
  })
})
