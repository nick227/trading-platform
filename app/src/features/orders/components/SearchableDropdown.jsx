import { useState, useMemo, useEffect } from 'react'

export default function SearchableDropdown({ stocks, selectedStock, onSelect, placeholder }) {
  const [isOpen,       setIsOpen]       = useState(false)
  const [searchTerm,   setSearchTerm]   = useState('')
  const [displayValue, setDisplayValue] = useState('')

  const stockList = useMemo(() => {
    if (Array.isArray(stocks)) return stocks
    if (Array.isArray(stocks?.tickers)) return stocks.tickers
    return []
  }, [stocks])

  useEffect(() => {
    if (selectedStock) {
      setDisplayValue(`${selectedStock.symbol} - ${selectedStock.name}`)
      setSearchTerm('')
    }
  }, [selectedStock])

  const filteredStocks = useMemo(() => {
    if (!searchTerm) return stockList
    const term = searchTerm.toLowerCase()
    return stockList.filter(s => {
      const symbol = String(s?.symbol ?? '').toLowerCase()
      const name = String(s?.name ?? '').toLowerCase()
      return symbol.includes(term) || name.includes(term)
    })
  }, [stockList, searchTerm])

  const handleSelect = (stock) => {
    onSelect(stock)
    setIsOpen(false)
    setDisplayValue(`${stock.symbol} - ${stock.name}`)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={isOpen ? searchTerm : displayValue}
        onChange={e => { setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true) }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '0.75rem',
          border: '1px solid #e9ecef', borderRadius: '8px',
          fontSize: '14px', background: 'white',
        }}
      />

      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: 'white', border: '1px solid #e9ecef', borderRadius: '8px',
          marginTop: '0.25rem', maxHeight: '200px', overflowY: 'auto',
          zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {filteredStocks.map(stock => (
            <div
              key={stock.symbol}
              onClick={() => handleSelect(stock)}
              style={{
                padding: '0.75rem', cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8f9fa'}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{stock.symbol}</div>
                <div className="muted" style={{ fontSize: '12px' }}>{stock.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>${stock.price?.toFixed(2)}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: (stock.change ?? 0) >= 0 ? '#0a7a47' : '#c0392b' }}>
                  {(stock.change ?? 0) >= 0 ? '+' : ''}{stock.change}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
