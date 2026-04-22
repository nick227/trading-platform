import { useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../app/AppProvider'

const predictionNotes = [
  'Momentum accelerated after earnings-guidance revisions.',
  'Order-flow skew stayed buyer-heavy for three sessions.',
  'Sector beta is favorable while volatility is still contained.'
]

const strategyRows = [
  { name: 'Momentum Swing', horizon: '3-5 days', winRate: '64%', edge: '+2.1%' },
  { name: 'Mean Reversion', horizon: '1-2 days', winRate: '57%', edge: '+0.8%' },
  { name: 'Breakout Continuation', horizon: 'Intraday', winRate: '61%', edge: '+1.4%' }
]

const scale = (value, min, max) => 100 - ((value - min) / (max - min)) * 100
const chartPath = (series) => {
  const min = Math.min(...series)
  const max = Math.max(...series)
  return series.map((point, index) => `${(index / (series.length - 1)) * 100},${scale(point, min, max)}`).join(' ')
}

export default function Asset() {
  const { ticker } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const symbol = String(ticker ?? '').toUpperCase()

  const handleRunBot = () => {
    navigate('/bots/create', { 
      state: { 
        defaultConfig: { 
          tickers: [symbol],
          quantity: 10,
          direction: 'buy'
        }
      } 
    })
  }

  useEffect(() => {
    if (symbol) dispatch({ type: 'SELECT_ASSET', payload: symbol })
  }, [symbol, dispatch])

  const asset = state.assets.find((item) => item.symbol === symbol)
  if (!asset) {
    return (
      <div className="l-page l-container-sm">
        <h1 className="hero">No data for {symbol}</h1>
        <p className="muted">No positions found for this ticker.</p>
        <Link className="btn btn-sm btn-primary inline-block mt-3" to="/assets/NVDA">
          Open NVDA
        </Link>
      </div>
    )
  }

  const bots = state.bots.filter((bot) => bot.asset === asset.symbol)
  const orders = state.orders.filter((order) => order.asset === asset.symbol)
  const trades = state.trades.filter((trade) => trade.symbol === asset.symbol)
  const currentPrice = 152.84
  const dailyChange = 2.37
  const holdings = 94
  const entry = 131.2
  const pnl = (currentPrice - entry) * holdings
  const marketPerformance = 7.8
  const assetPerformance = 11.9
  const alpha = assetPerformance - marketPerformance

  return (
    <div className="l-page l-container-content">
      <header className="stack-sm mb-6">
        <h1 className="hero mb-1">{asset.symbol} · {asset.name}</h1>
        <div className="text-xl font-700">${currentPrice.toFixed(2)}</div>
        <div className={`${dailyChange >= 0 ? 'text-positive' : 'text-negative'} font-600`}>
          {dailyChange >= 0 ? '+' : ''}{dailyChange.toFixed(2)}% today
        </div>
      </header>

      <section className="l-grid-hero mb-3">
        <article className="card card-lg card-pad-md">
          <div className="l-row mb-3">
            <strong>Hero Chart</strong>
            <span className="muted">1W price action</span>
          </div>
          <svg viewBox="0 0 100 100" className="chart-170">
            <polyline fill="none" stroke="#111" strokeWidth="2.7" points={chartPath(asset.series)} />
          </svg>
          <div className="l-grid-3cols mt-2">
            <div><div className="muted">Sector</div><strong>Semiconductors</strong></div>
            <div><div className="muted">Market cap</div><strong>$3.76T</strong></div>
            <div><div className="muted">Volume</div><strong>49.2M</strong></div>
          </div>
        </article>

        <article className="card card-lg card-inverse card-pad-md">
          <div className="eyebrow text-muted-inverse mb-1">Position Summary</div>
          <div className="text-xl font-700 mb-1">{holdings} shares</div>
          <div className="opacity-84">Entry ${entry.toFixed(2)}</div>
          <div className={`mt-3 text-lg font-700 ${pnl >= 0 ? 'text-positive' : 'text-negative'}`}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="opacity-80">Unrealized P&L</div>
        </article>
      </section>

      <section className="l-grid-3lead mb-3">
        <article className="card card-pad-sm">
          <strong>Quick Actions</strong>
          <div className="stack-sm mt-3">
            <button className="btn btn-primary btn-block">Buy {asset.symbol}</button>
            <button className="btn btn-ghost btn-block">Sell {asset.symbol}</button>
            <button className="btn btn-ghost btn-block" onClick={handleRunBot}>Run Bot</button>
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Prediction Summary</strong>
          <div className="stack-sm mt-3">
            <div>
              <span className="eyebrow mb-0">Direction</span>
              <div className="font-700">Bullish continuation</div>
            </div>
            <div>
              <span className="eyebrow mb-0">Confidence</span>
              <div className="font-700">78%</div>
            </div>
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Risk Metrics</strong>
          <div className="stack-sm mt-3">
            <div className="muted">Drawdown: <strong className="text-primary">-5.4%</strong></div>
            <div className="muted">Volatility (30d): <strong className="text-primary">31.2%</strong></div>
            <div className="muted">Expected range: <strong className="text-primary">$147.00 - $159.50</strong></div>
          </div>
        </article>
      </section>

      <section className="l-grid-2lead mb-3">
        <article className="card card-pad-sm">
          <strong>Trade History</strong>
          <div className="data-rows">
            {trades.map((trade) => (
              <div key={trade.id} className="data-row-3 data-row-divider">
                <strong>{trade.side}</strong>
                <span>{trade.amount}</span>
                <span className="muted text-right">{trade.time}</span>
              </div>
            ))}
            {orders.map((order) => (
              <div key={order.id} className="data-row-3 muted">
                <strong>{order.type}</strong>
                <span>${order.amount.toLocaleString()}</span>
                <span className="text-right">Order</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Bot Status</strong>
          <div className="data-rows">
            {bots.map((bot) => (
              <div key={bot.id} className="l-row">
                <span>{bot.name}</span>
                <span className={bot.status === 'running' ? 'text-positive' : 'text-muted'}>{bot.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="l-grid-3">
        <article className="card card-pad-sm">
          <strong>Strategy Comparison</strong>
          <div className="data-rows">
            {strategyRows.map((row) => (
              <div key={row.name} className="data-row-divider">
                <div className="font-600">{row.name}</div>
                <div className="muted">{row.horizon} · Win {row.winRate} · Edge {row.edge}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Performance vs Market</strong>
          <div className="stack-sm mt-3">
            <div className="muted">Asset return: <strong className="text-primary">+{assetPerformance}%</strong></div>
            <div className="muted">Market baseline: <strong className="text-primary">+{marketPerformance}%</strong></div>
            <div className="font-700 text-positive">Alpha: +{alpha.toFixed(1)}%</div>
          </div>
        </article>

        <article className="card card-pad-sm">
          <strong>Signal Explanation</strong>
          <ul className="list mt-3">
            {predictionNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </article>
      </section>
    </div>
  )
}
