import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StockSelector from '../StockSelector'
import { alphaFetch } from '../../../../api/services/alphaEngineService.js'

vi.mock('../../../../api/services/alphaEngineService.js', () => ({ alphaFetch: vi.fn() }))
beforeEach(() => { vi.clearAllMocks() })
describe('bot stock selector', () => {
  it('queries ticker registry and restricts unsupported account symbols', async () => {
    alphaFetch.mockResolvedValue([{ticker:'AAPL', name:'Apple'}, {ticker:'MSFT', name:'Microsoft'}])
    const onSelect = vi.fn()
    render(<StockSelector supported={['AAPL']} selected={[]} onSelect={onSelect}/>)
    fireEvent.change(screen.getByRole('searchbox'), {target:{value:'app'}})
    const apple = await screen.findByRole('button', {name:/AAPL/})
    expect(apple).toBeEnabled()
    expect(screen.getByRole('button', {name:/MSFT/})).toBeDisabled()
    fireEvent.click(apple)
    expect(onSelect).toHaveBeenCalledWith('AAPL')
    await waitFor(()=>expect(screen.getByRole('searchbox')).toHaveValue(''))
  })
  it('keeps network failures explicit without selecting a stock', async () => {
    alphaFetch.mockRejectedValue(new Error('offline'))
    render(<StockSelector selected={[]} supported={null} onSelect={vi.fn()}/>)
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'apple'}})
    expect(await screen.findByRole('alert')).toHaveTextContent('search is unavailable')
  })
})
