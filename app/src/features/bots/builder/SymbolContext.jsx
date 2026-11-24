import { useEffect, useState } from 'react'
import { get } from '../../../api/client'

const cache = new Map() // symbol -> promise of asset metadata (one lookup per symbol per page load)

export function loadAsset(symbol) {
  const key = String(symbol).toUpperCase()
  if (!cache.has(key)) {
    cache.set(key, get(`/market/assets/${encodeURIComponent(key)}`)
      .then((r) => r?.data ?? r)
      .catch((err) => { cache.delete(key); return { symbol: key, status: err?.status === 404 ? 'unsupported' : 'unavailable' } }))
  }
  return cache.get(key)
}

function AssetLine({ symbol }) {
  const [a, setA] = useState(null)
  useEffect(() => {
    let live = true
    loadAsset(symbol).then((d) => live && setA(d))
    return () => { live = false }
  }, [symbol])
  return (
    <li className="tl-asset-line" data-testid={`asset-${symbol}`}>
      <strong>{symbol}</strong>
      {!a && <span className="tl-muted"> · looking up…</span>}
      {a?.status === 'available' && (
        <span> · {a.name}{a.exchange ? <span className="tl-muted"> · {a.exchange}</span> : null}{a.tradable === false ? <span className="tl-neg"> · not tradable</span> : null}</span>
      )}
      {a?.status === 'unsupported' && <span className="tl-neg"> · not available in paper trading</span>}
      {a?.status === 'unavailable' && <span className="tl-muted"> · company details unavailable</span>}
    </li>
  )
}

/**
 * Watch-step context: tap a supported symbol to add or remove it, and see who each chosen
 * symbol is (company name, exchange — fetched on demand from Alpaca). No browsing, no lists
 * beyond the supported universe.
 */
export default function SymbolContext({ selected, supported, onToggle }) {
  const chosen = selected.slice(0, 5)
  return (
    <div className="tl-symbol-context">
      {supported?.length > 0 && (
        <div className="tl-symbol-picks" role="group" aria-label="Supported symbols">
          {supported.map((s) => (
            <button key={s} type="button" className="tl-symbol-pick" aria-pressed={selected.includes(s)} onClick={() => onToggle(s)}>{s}</button>
          ))}
        </div>
      )}
      {chosen.length > 0 && (
        <ul className="tl-asset-lines" aria-label="Chosen symbols">
          {chosen.map((s) => <AssetLine key={s} symbol={s} />)}
        </ul>
      )}
    </div>
  )
}
