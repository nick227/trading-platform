import { useEffect, useRef, useState } from 'react'
import { getAvailableStocks } from '../services/marketData.js'

export default function TickerSelector({ selectedTickers, onChange, maxTickers = 5 }) {
  const [availableStocks, setAvailableStocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const loadStocks = async () => {
      try {
        setLoading(true)
        const stocks = await getAvailableStocks()
        setAvailableStocks(Array.isArray(stocks) ? stocks : [])
        setError(null)
      } catch (err) {
        setError('Failed to load available stocks')
        console.error('Error loading stocks:', err)
      } finally {
        setLoading(false)
      }
    }
    loadStocks()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredStocks = useMemo(() => {
    if (!searchTerm) return availableStocks
    const searchLower = searchTerm.toLowerCase()
    return availableStocks.filter(stock => 
      stock.symbol.toLowerCase().includes(searchLower) ||
      stock.name.toLowerCase().includes(searchLower)
    )
  }, [availableStocks, searchTerm])

  const handleAddTicker = (stock) => {
    if (selectedTickers.length >= maxTickers) {
      setError(`Maximum ${maxTickers} tickers allowed`)
      return
    }

    const existingSymbols = new Set(selectedTickers.map(t => t.symbol))
    if (!existingSymbols.has(stock.symbol)) {
      onChange([...selectedTickers, stock])
      setSearchTerm('')
      setDropdownOpen(false)
      setError(null)
    }
  }

  const handleRemoveTicker = (symbol) => {
    onChange(selectedTickers.filter((t) => t.symbol !== symbol))
  }

  return (
    <div className="stack-sm">
      <div className="wrap">
        {selectedTickers.map((ticker) => (
          <div key={ticker.symbol} className="pill pill-accent">
            <span className="font-600">{ticker.symbol}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => handleRemoveTicker(ticker.symbol)}
              aria-label={`Remove ${ticker.symbol}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {selectedTickers.length < maxTickers && (
        <div className="dropdown" ref={dropdownRef}>
          <div className="stack-sm">
            <input
              type="text"
              placeholder="Search stocks..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setDropdownOpen(true)
              }}
              onFocus={() => setDropdownOpen(true)}
              className="field-input"
            />
            {loading && <div className="text-xs muted">Loading…</div>}
          </div>

          {dropdownOpen && !loading && (
            <div className="menu">
              {error ? (
                <div className="panel-empty">{error}</div>
              ) : filteredStocks.length === 0 ? (
                <div className="panel-empty">No stocks found</div>
              ) : (
                <div>
                  {filteredStocks.slice(0, 10).map((stock) => (
                    <button
                      type="button"
                      key={stock.symbol}
                      className="menu-item"
                      onClick={() => handleAddTicker(stock)}
                    >
                      <div className="stack-sm">
                        <span className="text-sm font-600">{stock.symbol}</span>
                        <span className="muted text-xs">{stock.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-600">${stock.price}</span>
                        <span className={`text-xs font-600 ${stock.change >= 0 ? 'text-positive' : 'text-negative'}`}>
                          {stock.change >= 0 ? '+' : ''}
                          {stock.change}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-xs text-negative">{error}</div>}

      <div className="text-xs muted">
        Select up to {maxTickers} stocks. Each bot will trade all selected tickers independently.
      </div>
    </div>
  )
}

