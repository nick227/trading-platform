import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { get } from '../../../../api/client'
import { PerformanceHistory } from '../BotDashboard'

const pts = (pnls) => pnls.map((pnl, i) => ({ date: `2026-11-0${i + 2}`, pnl, equity: 5000 + pnl, fills: i === 0 ? 1 : 0 }))

describe('PerformanceHistory', () => {
  it('shows return, drawdown and win rate, and a chart once there are 5 sessions', async () => {
    get.mockResolvedValue({ data: { allocation: 5000, returnPct: 2.8, maxDrawdown: { amount: 200, pct: 3.92, peakDate: '2026-11-03', troughDate: '2026-11-04' }, points: pts([0, 100, -100, 50, 140]) } })
    render(<PerformanceHistory botId="bot_1" winRate={0.5} closedTrades={2} />)
    expect(await screen.findByTestId('bot-return')).toHaveTextContent('+2.80%')
    expect(screen.getByTestId('bot-drawdown')).toHaveTextContent('−$200.00')
    expect(screen.getByTestId('bot-win-rate')).toHaveTextContent('50%of 2 closed trades')
    expect(screen.getByRole('img', { name: /Bot P&L at each daily close/ })).toBeInTheDocument()
  })
  it('explains when there is not enough history for a chart', async () => {
    get.mockResolvedValue({ data: { allocation: 5000, returnPct: 0, maxDrawdown: null, points: pts([0, 10]) } })
    render(<PerformanceHistory botId="bot_1" winRate={null} closedTrades={0} />)
    expect(await screen.findByText(/A P&L chart appears after 5 sessions \(2 so far\)/)).toBeInTheDocument()
    expect(screen.getByTestId('bot-win-rate')).toHaveTextContent('no closed trades yet')
  })
})
