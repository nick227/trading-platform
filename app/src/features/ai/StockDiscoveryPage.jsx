import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../api/client'
import StockDiscoveryPanel from './StockDiscoveryPanel'

export default function StockDiscoveryPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'loading', data: null })

  const load = useCallback(() => {
    setState(s => ({ ...s, status: 'loading' }))
    get('/public/ai-stock-trader/discovery?limit=30')
      .then(data => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', data: null }))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <main className="tl-page tl-flow-page" data-testid="stock-discovery-page">
      <section className="tl-section">
        <div className="tl-section-head">
          <h1 className="tl-section-title">AI Stock Discovery</h1>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <a
              href="/ai-stock-trader"
              className="tl-link-btn"
              onClick={e => {
                e.preventDefault()
                navigate('/ai-stock-trader')
              }}
            >
              ← Flagship AI Trader
            </a>
            <button type="button" className="tl-link-btn" onClick={load} disabled={state.status === 'loading'}>
              Refresh scan
            </button>
          </div>
        </div>
        <p className="tl-lead-sentence">
          Cross-sector opportunity scanner ranking companies outside static watchlists using deterministic relative strength, sector breadth, and verified SEC/news disclosures.
        </p>
        <p className="tl-section-note">
          Read-only research surface for paper strategy discovery. Rankings are not investment advice or real-money trade recommendations.
        </p>
      </section>

      {state.status === 'loading' && (
        <section className="tl-section" role="status">Scanning cross-sector market bars and point-in-time disclosures…</section>
      )}
      {state.status === 'error' && (
        <section className="tl-section" role="alert">Discovery scan is temporarily unavailable. Retry when market data is reachable.</section>
      )}
      {state.status === 'ready' && state.data && (
        <StockDiscoveryPanel discovery={state.data} compact={false} />
      )}
    </main>
  )
}
