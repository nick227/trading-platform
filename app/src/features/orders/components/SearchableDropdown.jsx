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
    <div className="dropdown">
      <input
        type="text"
        value={isOpen ? searchTerm : displayValue}
        onChange={e => { setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true) }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="field-input"
      />

      {isOpen && (
        <div className="menu">
          {filteredStocks.map(stock => (
            <button
              type="button"
              key={stock.symbol}
              onClick={() => handleSelect(stock)}
              className="menu-item"
            >
              <div className="stack-sm">
                <div className="text-sm font-600">{stock.symbol}</div>
                <div className="muted text-xs">{stock.name}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-600">${stock.price?.toFixed(2)}</div>
                <div className={`text-xs font-600 ${(stock.change ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {Number.isFinite(stock.change)
                    ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%`
                    : '—'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
