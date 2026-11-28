import { useEffect, useState } from 'react'
import { alphaFetch } from '../../../api/services/alphaEngineService.js'

const normalize = symbol => String(symbol || '').trim().toUpperCase()
const list = data => Array.isArray(data) ? data : Array.isArray(data?.tickers) ? data.tickers : []

/** Search is discovery only. The builder and server still validate tradability. */
export default function StockSelector({ selected = [], supported = null, onSelect }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle')
  const [matches, setMatches] = useState([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setMatches([]); setStatus('idle'); return }
    let active = true
    const timer = setTimeout(() => {
      setStatus('loading')
      alphaFetch('/api/tickers?q=' + encodeURIComponent(q)).then(data => {
        if (!active) return
        setMatches(list(data).slice(0, 8))
        setStatus('ready')
      }).catch(() => {
        if (!active) return
        setStatus('error')
        setMatches([])
      })
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [query])
  const supportedSet = Array.isArray(supported) ? new Set(supported.map(normalize)) : null
  return <div className="tl-stock-selector">
    <label htmlFor="tl-stock-selector-search">Find a stock to automate</label>
    <input id="tl-stock-selector-search" type="search" value={query}
      onChange={event => setQuery(event.target.value)}
      placeholder="Search company or symbol (e.g. Apple or AAPL)" autoComplete="off" />
    {status === 'loading' && <p role="status" className="tl-small">Searching available symbols…</p>}
    {status === 'error' && <p role="alert" className="tl-small">Company search is unavailable. You can still enter a known symbol above.</p>}
    {status === 'ready' && matches.length === 0 && <p className="tl-small">No matching symbols were found.</p>}
    {matches.length > 0 && <ul className="tl-stock-selector-results" aria-label="Stock search results">
      {matches.map((item, index) => {
        const symbol = normalize(item.ticker || item.symbol || item.tkr)
        if (!symbol) return null
        const chosen = selected.includes(symbol)
        const allowed = !supportedSet || supportedSet.has(symbol)
        return <li key={symbol + index}>
          <button type="button" disabled={!allowed || chosen} onClick={() => {
            onSelect(symbol); setQuery(''); setMatches([]); setStatus('idle')
          }}>
            <strong>{symbol}</strong>
            <span>{item.name || item.companyName || item.company_name || 'Company name unavailable'}</span>
            <small>{chosen ? 'Selected' : allowed ? 'Add stock' : 'Not available for this paper account'}</small>
          </button>
        </li>
      })}
    </ul>}
    <p className="tl-small tl-muted">Finding a ticker does not confirm trading eligibility. Your account and the server validate symbols when you save the bot.</p>
  </div>
}
