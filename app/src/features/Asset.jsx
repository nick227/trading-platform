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
      <div className="page container" style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 className="hero">No data for {symbol}</h1>
        <p className="muted">No positions found for this ticker.</p>
        <Link className="primary pressable" to="/assets/NVDA" style={{ display: 'inline-block', marginTop: '1rem' }}>
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
    <div className="page container" style={{ maxWidth: 1040, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>{asset.symbol} · {asset.name}</h1>
        <div style={{ fontSize: '1.7rem', fontWeight: 700 }}>${currentPrice.toFixed(2)}</div>
        <div style={{ color: dailyChange >= 0 ? '#0a7a47' : '#b21f3d', fontWeight: 600 }}>
          {dailyChange >= 0 ? '+' : ''}{dailyChange.toFixed(2)}% today
        </div>
      </header>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1.7fr 1fr', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1.2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.7rem' }}>
            <strong>Hero Chart</strong>
            <span className="muted">1W price action</span>
          </div>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: 170 }}>
            <polyline fill="none" stroke="#111" strokeWidth="2.7" points={chartPath(asset.series)} />
          </svg>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.7rem', marginTop: '0.2rem' }}>
            <div><div className="muted">Sector</div><strong>Semiconductors</strong></div>
            <div><div className="muted">Market cap</div><strong>$3.76T</strong></div>
            <div><div className="muted">Volume</div><strong>49.2M</strong></div>
          </div>
        </article>

        <article style={{ background: 'linear-gradient(140deg, #111, #2a2a2a)', color: '#fff', borderRadius: 24, padding: '1.2rem' }}>
          <div className="eyebrow" style={{ color: '#d9d9d9' }}>Position Summary</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.4rem' }}>{holdings} shares</div>
          <div style={{ opacity: 0.84 }}>Entry ${entry.toFixed(2)}</div>
          <div style={{ marginTop: '1rem', fontSize: '1.5rem', fontWeight: 700, color: pnl >= 0 ? '#6effb6' : '#ff9aa8' }}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div style={{ opacity: 0.8 }}>Unrealized P&L</div>
        </article>
      </section>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1.2fr 1fr 1fr', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Quick Actions</strong>
          <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button className="primary pressable">Buy {asset.symbol}</button>
            <button className="ghost pressable">Sell {asset.symbol}</button>
            <button className="ghost pressable" onClick={handleRunBot}>Run Bot</button>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Prediction Summary</strong>
          <div style={{ marginTop: '0.7rem' }}><span className="eyebrow" style={{ marginBottom: 0 }}>Direction</span><div style={{ fontWeight: 700 }}>Bullish continuation</div></div>
          <div style={{ marginTop: '0.7rem' }}><span className="eyebrow" style={{ marginBottom: 0 }}>Confidence</span><div style={{ fontWeight: 700 }}>78%</div></div>
        </article>

        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Risk Metrics</strong>
          <div style={{ marginTop: '0.7rem' }} className="muted">Drawdown: <strong style={{ color: '#111' }}>-5.4%</strong></div>
          <div className="muted">Volatility (30d): <strong style={{ color: '#111' }}>31.2%</strong></div>
          <div className="muted">Expected range: <strong style={{ color: '#111' }}>$147.00 - $159.50</strong></div>
        </article>
      </section>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1.2fr 1fr', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Trade History</strong>
          <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.5rem' }}>
            {trades.map((trade) => (
              <div key={trade.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', paddingBottom: '0.45rem', borderBottom: '1px solid #eee' }}>
                <strong>{trade.side}</strong>
                <span>{trade.amount}</span>
                <span className="muted" style={{ textAlign: 'right' }}>{trade.time}</span>
              </div>
            ))}
            {orders.map((order) => (
              <div key={order.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', color: '#666' }}>
                <strong>{order.type}</strong>
                <span>${order.amount.toLocaleString()}</span>
                <span style={{ textAlign: 'right' }}>Order</span>
              </div>
            ))}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Bot Status</strong>
          <div style={{ marginTop: '0.7rem', display: 'grid', gap: '0.55rem' }}>
            {bots.map((bot) => (
              <div key={bot.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{bot.name}</span>
                <span style={{ color: bot.status === 'running' ? '#0a7a47' : '#aa7a00' }}>{bot.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr 1fr' }}>
        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Strategy Comparison</strong>
          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.55rem' }}>
            {strategyRows.map((row) => (
              <div key={row.name} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.45rem' }}>
                <div style={{ fontWeight: 600 }}>{row.name}</div>
                <div className="muted">{row.horizon} · Win {row.winRate} · Edge {row.edge}</div>
              </div>
            ))}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Performance vs Market</strong>
          <div style={{ marginTop: '0.75rem' }} className="muted">Asset return: <strong style={{ color: '#111' }}>+{assetPerformance}%</strong></div>
          <div className="muted">Market baseline: <strong style={{ color: '#111' }}>+{marketPerformance}%</strong></div>
          <div style={{ marginTop: '0.5rem', fontWeight: 700, color: '#0a7a47' }}>Alpha: +{alpha.toFixed(1)}%</div>
        </article>

        <article style={{ background: 'white', borderRadius: 20, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Signal Explanation</strong>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1rem', color: '#555', lineHeight: 1.5 }}>
            {predictionNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </article>
      </section>
    </div>
  )
}
