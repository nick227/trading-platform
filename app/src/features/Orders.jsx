import { useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../app/AppProvider'
import { getAvailableStocks, getAlphaPredictions, generatePriceHistory } from '../services/marketData.js'
import { GlobalCaches } from '../services/robustCache.js'

// User portfolio holdings for sell validation - will be derived from real executions
const userHoldings = {}

// Searchable Dropdown Component
function SearchableDropdown({ stocks, selectedStock, onSelect, placeholder }) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [displayValue, setDisplayValue] = useState('')

  useEffect(() => {
    if (selectedStock) {
      setDisplayValue(`${selectedStock.symbol} - ${selectedStock.name}`)
      setSearchTerm('')
    }
  }, [selectedStock])

  const filteredStocks = useMemo(() => {
    if (!searchTerm) return stocks
    const term = searchTerm.toLowerCase()
    return stocks.filter(stock => 
      stock.symbol.toLowerCase().includes(term) || 
      stock.name.toLowerCase().includes(term)
    )
  }, [stocks, searchTerm])

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
        onChange={(e) => {
          setSearchTerm(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.75rem',
          border: '1px solid #e9ecef',
          borderRadius: '8px',
          fontSize: '14px',
          background: 'white'
        }}
      />
      
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #e9ecef',
          borderRadius: '8px',
          marginTop: '0.25rem',
          maxHeight: '200px',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          {filteredStocks.map((stock) => (
            <div
              key={stock.symbol}
              onClick={() => handleSelect(stock)}
              style={{
                padding: '0.75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{stock.symbol}</div>
                <div className="muted" style={{ fontSize: '12px' }}>{stock.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>${stock.price.toFixed(2)}</div>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600,
                  color: stock.change >= 0 ? '#0a7a47' : '#c0392b' 
                }}>
                  {stock.change >= 0 ? '+' : ''}{stock.change}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Reusable Order Form Component
function OrderForm({ 
  selectedStock, 
  orderType, 
  setOrderType, 
  orderAmount, 
  setOrderAmount, 
  orderQuantity, 
  setOrderQuantity, 
  fillType, 
  setFillType, 
  limitPrice, 
  setLimitPrice, 
  stopPrice, 
  setStopPrice, 
  orderDetails, 
  bankBalance,
  onSubmit,
  submitLabel,
  onCancel,
  mode = 'STOCK' // STOCK or BOT
}) {
  return (
    <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <h3 style={{ margin: '0 0 1.5rem', fontSize: '18px', fontWeight: 600 }}>
        {mode === 'BOT' ? 'Configure Bot' : 'Place Order'}
      </h3>
      
      {/* Order Type Selection */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          {mode === 'BOT' ? 'Bot Strategy' : 'Order Type'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'BOT' ? 'repeat(2, 1fr)' : '1fr 1fr', gap: '0.75rem' }}>
          {mode === 'BOT' ? (
            <>
              <button
                className={`pressable ${orderType === 'BUY' ? 'primary' : 'ghost'}`}
                onClick={() => setOrderType('BUY')}
                style={{ padding: '0.75rem', fontWeight: 600 }}
              >
                Accumulate
              </button>
              <button
                className={`pressable ${orderType === 'SELL' ? 'primary' : 'ghost'}`}
                onClick={() => setOrderType('SELL')}
                style={{ padding: '0.75rem', fontWeight: 600 }}
              >
                Distribute
              </button>
            </>
          ) : (
            <>
              <button
                className={`pressable ${orderType === 'BUY' ? 'primary' : 'ghost'}`}
                onClick={() => setOrderType('BUY')}
                style={{ padding: '0.75rem', fontWeight: 600 }}
              >
                Buy
              </button>
              <button
                className={`pressable ${orderType === 'SELL' ? 'primary' : 'ghost'}`}
                onClick={() => setOrderType('SELL')}
                style={{ padding: '0.75rem', fontWeight: 600 }}
              >
                Sell
              </button>
            </>
          )}
        </div>
      </div>

      {/* Fill Type Selection */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          {mode === 'BOT' ? 'Execution Style' : 'Fill Type'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {(mode === 'BOT' ? ['IMMEDIATE', 'GRADUAL', 'SMART'] : ['MARKET', 'LIMIT', 'STOP']).map((type) => (
            <button
              key={type}
              className={`pressable ${fillType === type ? 'primary' : 'ghost'}`}
              onClick={() => setFillType(type)}
              style={{ padding: '0.5rem', fontSize: '12px', fontWeight: 600 }}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Conditional Price Inputs */}
      {fillType === 'LIMIT' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
            {mode === 'BOT' ? 'Target Price' : 'Limit Price'}
          </div>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={`$${selectedStock?.price?.toFixed(2) || '0.00'}`}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '1px solid #e9ecef',
              borderRadius: '8px',
              fontSize: '14px'
            }}
          />
        </div>
      )}

      {fillType === 'STOP' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
            {mode === 'BOT' ? 'Trigger Price' : 'Stop Price'}
          </div>
          <input
            type="number"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            placeholder={`$${selectedStock?.price?.toFixed(2) || '0.00'}`}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '1px solid #e9ecef',
              borderRadius: '8px',
              fontSize: '14px'
            }}
          />
        </div>
      )}

      {/* Order Amount/Quantity */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>
          {mode === 'BOT' 
            ? (orderType === 'BUY' ? 'Investment Amount' : 'Allocation %')
            : (orderType === 'BUY' ? 'Amount to Invest' : 'Quantity to Sell')
          }
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {mode === 'BOT' ? (
            <input
              type="number"
              value={orderAmount}
              onChange={(e) => {
                setOrderAmount(e.target.value)
                setOrderQuantity('')
              }}
              placeholder={orderType === 'BUY' ? '$0.00' : '0%'}
              style={{
                padding: '0.75rem',
                border: '1px solid #e9ecef',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
          ) : orderType === 'BUY' ? (
            <input
              type="number"
              value={orderAmount}
              onChange={(e) => {
                setOrderAmount(e.target.value)
                setOrderQuantity('')
              }}
              placeholder="$0.00"
              style={{
                padding: '0.75rem',
                border: '1px solid #e9ecef',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
          ) : (
            <input
              type="number"
              value={orderQuantity}
              onChange={(e) => {
                setOrderQuantity(e.target.value)
                setOrderAmount('')
              }}
              placeholder="0"
              max={userHoldings[selectedStock?.symbol]?.shares || 0}
              style={{
                padding: '0.75rem',
                border: '1px solid #e9ecef',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
          )}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontSize: '12px',
            color: '#7a7a7a'
          }}>
            {mode === 'BOT' 
              ? (orderType === 'BUY' ? 'Max: $10,000' : 'Max: 100%')
              : (orderType === 'BUY' 
                ? `Max: ${orderDetails?.maxQuantity || 0} shares`
                : `Available: ${orderDetails?.maxQuantity || 0} shares`
              )
            }
          </div>
        </div>
      </div>

      {/* Order Summary */}
      <div style={{ 
        background: '#f8f9fa', 
        borderRadius: '8px', 
        padding: '1rem', 
        marginBottom: '1.5rem' 
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span className="muted">
            {mode === 'BOT' ? 'Estimated Value' : `Estimated ${orderType === 'BUY' ? 'Cost' : 'Proceeds'}`}:
          </span>
          <span style={{ fontWeight: 600 }}>
            ${orderDetails?.estimatedValue?.toFixed(2) || '0.00'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="muted">
            {mode === 'BOT' ? 'Bot Budget Impact' : `After ${orderType === 'BUY' ? 'Order' : 'Sale'} Balance`}:
          </span>
          <span style={{ 
            fontWeight: 600,
            color: orderDetails?.canAfford !== false ? '#0a7a47' : '#c0392b'
          }}>
            ${mode === 'BOT' 
              ? (bankBalance - (orderDetails?.estimatedValue || 0)).toFixed(2)
              : (orderType === 'BUY' 
                ? bankBalance - (orderDetails?.estimatedValue || 0)
                : bankBalance + (orderDetails?.estimatedValue || 0)
              ).toFixed(2)
            }
          </span>
        </div>
      </div>

      {/* Error/Warning Messages */}
      {orderDetails?.canAfford === false && (
        <div style={{ 
          background: '#fff5f5', 
          border: '1px solid #fed7d7', 
          borderRadius: '8px', 
          padding: '0.75rem', 
          marginBottom: '1.5rem',
          color: '#c0392b',
          fontSize: '14px'
        }}>
          {mode === 'BOT' 
            ? 'Insufficient budget for this bot configuration'
            : (orderType === 'BUY' 
              ? 'Insufficient funds for this order'
              : 'Insufficient shares for this sale'
            )
          }
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <button
          className="primary pressable"
          onClick={onSubmit}
          disabled={!orderDetails?.canAfford || (!orderAmount && !orderQuantity)}
          style={{ 
            padding: '1rem',
            fontWeight: 600,
            opacity: (!orderDetails?.canAfford || (!orderAmount && !orderQuantity)) ? 0.5 : 1
          }}
        >
          {submitLabel}
        </button>
        <button
          className="ghost pressable"
          onClick={onCancel}
          style={{ padding: '1rem' }}
        >
          Cancel
        </button>
      </div>
    </article>
  )
}

export default function Orders() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { state, dispatch } = useApp()
  
  // State for order form
  const [selectedStock, setSelectedStock] = useState(getAvailableStocks()[0])
  const [orderType, setOrderType] = useState('BUY')
  const [orderAmount, setOrderAmount] = useState('')
  const [orderQuantity, setOrderQuantity] = useState('')
  const [fillType, setFillType] = useState('MARKET')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [priceHistory, setPriceHistory] = useState([])
const [priceRange, setPriceRange] = useState({ min: 0, max: 0, range: 0 })
  
  // User bank balance and account info
  const bankBalance = 4200
  const bankConnected = true
  const accountNumber = '...039'
  const buyingPower = bankBalance * 1.25 // Margin power
  const dayTradesRemaining = 3
  const patternDayTrader = false
  
  // Market data
  const marketStatus = 'CLOSED'
  const lastUpdate = '07:59:03 PM ET, 04/16/2026'
  const nextOpen = '09:30:00 AM ET'
  
  // Preload stock from URL params (e.g., from portfolio)
  useEffect(() => {
    const ticker = searchParams.get('ticker')
    if (ticker) {
      const stock = getAvailableStocks().find(s => s.symbol === ticker)
      if (stock) {
        setSelectedStock(stock)
      }
    }
  }, [searchParams])
  
  // Update price history when stock selection changes
  useEffect(() => {
    const history = generatePriceHistory(selectedStock.price)
    setPriceHistory(history)
    
    // Pre-calculate min/max for performance
    if (history.length > 0) {
      const prices = history.map(p => p.price)
      const minPrice = Math.min(...prices)
      const maxPrice = Math.max(...prices)
      const priceRange = maxPrice - minPrice
      setPriceRange({ min: minPrice, max: maxPrice, range: priceRange })
    }
  }, [selectedStock])
  
  // Calculate order details
  const calculateOrderDetails = () => {
    const quantity = parseFloat(orderQuantity) || 0
    const amount = parseFloat(orderAmount) || 0
    const price = selectedStock.price
    
    if (orderType === 'SELL') {
      const maxShares = userHoldings[selectedStock.symbol]?.shares || 0
      return {
        canAfford: quantity <= maxShares,
        maxQuantity: maxShares,
        estimatedValue: quantity * price,
        commission: Math.max(quantity * price * 0.001, 1.95) // Min $1.95 or 0.1%
      }
    } else {
      const maxAffordableQuantity = Math.floor(bankBalance / price)
      return {
        canAfford: amount <= bankBalance || (quantity * price) <= bankBalance,
        maxQuantity: maxAffordableQuantity,
        estimatedValue: amount || (quantity * price),
        commission: Math.max((amount || (quantity * price)) * 0.001, 1.95)
      }
    }
  }
  
  const orderDetails = calculateOrderDetails()
  
  const handleProceedToConfirmation = () => {
    const orderData = {
      id: Date.now(),
      type: orderType,
      asset: selectedStock.symbol,
      assetName: selectedStock.name,
      quantity: parseFloat(orderQuantity) || Math.floor(parseFloat(orderAmount) / selectedStock.price),
      amount: parseFloat(orderAmount) || (parseFloat(orderQuantity) * selectedStock.price),
      price: selectedStock.price,
      fillType,
      limitPrice: fillType === 'LIMIT' ? parseFloat(limitPrice) : null,
      stopPrice: fillType === 'STOP' ? parseFloat(stopPrice) : null,
      commission: orderDetails.commission,
      timestamp: new Date().toISOString()
    }
    
    dispatch({ type: 'SELECT_ORDER', payload: orderData.id })
    navigate('/orders/confirm', { state: { order: orderData } })
  }
  
  const alphaData = getAlphaPredictions()[selectedStock.symbol]
  
  // Calculate additional market data
  const dayHigh = selectedStock.price * 1.02
  const dayLow = selectedStock.price * 0.98
  const bidAskSpread = selectedStock.price * 0.0001
  const week52High = selectedStock.price * 1.25
  const week52Low = selectedStock.price * 0.75
  
  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      {/* Compact Header with Account Info */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '1rem',
        padding: '1rem',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Account</div>
            <div style={{ fontWeight: 600 }}>Individual {accountNumber}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Available Funds</div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#0a7a47' }}>
              ${bankBalance.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '12px' }}>Buying Power</div>
            <div style={{ fontWeight: 600 }}>${buyingPower.toLocaleString()}</div>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: '12px' }}>Day Trades</div>
            <div style={{ fontWeight: 600, color: dayTradesRemaining > 0 ? '#0a7a47' : '#c0392b' }}>
              {dayTradesRemaining} left
            </div>
          </div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            padding: '0.25rem 0.75rem',
            borderRadius: '4px',
            background: patternDayTrader ? '#fff3cd' : '#f8f9fa'
          }}>
            <div style={{ 
              width: '6px', 
              height: '6px', 
              borderRadius: '50%', 
              background: bankConnected ? '#0a7a47' : '#c0392b' 
            }} />
            <span style={{ fontSize: '12px' }}>
              {bankConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Trading Interface */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '1rem' }}>
        {/* Left Column - Stock Info and Chart */}
        <section style={{ display: 'grid', gap: '1rem' }}>
          {/* Stock Selector and Basic Info */}
          <article style={{ background: 'white', borderRadius: '8px', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <SearchableDropdown
                  stocks={getAvailableStocks()}
                  selectedStock={selectedStock}
                  onSelect={setSelectedStock}
                  placeholder="Search symbols or companies..."
                />
              </div>
              <div style={{ marginLeft: '1rem', textAlign: 'right' }}>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>${selectedStock.price.toFixed(2)}</div>
                <div style={{ 
                  fontSize: '14px', 
                  fontWeight: 600,
                  color: selectedStock.change >= 0 ? '#0a7a47' : '#c0392b' 
                }}>
                  {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change}%
                </div>
              </div>
            </div>
            
            {/* Market Data Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', fontSize: '13px' }}>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>Market Status</div>
                <div style={{ fontWeight: 600, color: marketStatus === 'CLOSED' ? '#c0392b' : '#0a7a47' }}>
                  {marketStatus}
                </div>
                <div className="muted" style={{ fontSize: '10px' }}>{lastUpdate}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>Day Range</div>
                <div style={{ fontWeight: 600 }}>
                  ${dayLow.toFixed(2)} - ${dayHigh.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>52W Range</div>
                <div style={{ fontWeight: 600 }}>
                  ${week52Low.toFixed(2)} - ${week52High.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>Volume</div>
                <div style={{ fontWeight: 600 }}>{selectedStock.volume}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>Bid/Ask</div>
                <div style={{ fontWeight: 600 }}>
                  ${(selectedStock.price - bidAskSpread).toFixed(2)} / ${(selectedStock.price + bidAskSpread).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '11px', marginBottom: '0.25rem' }}>P/E Ratio</div>
                <div style={{ fontWeight: 600 }}>{selectedStock.pe}</div>
              </div>
            </div>
          </article>

          {/* Compact Chart */}
          <article style={{ background: 'white', borderRadius: '8px', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                {selectedStock.symbol} - {selectedStock.name}
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ghost pressable" style={{ padding: '0.25rem 0.5rem', fontSize: '12px' }}>
                  Chart
                </button>
                <button className="ghost pressable" style={{ padding: '0.25rem 0.5rem', fontSize: '12px' }}>
                  News
                </button>
              </div>
            </div>
            
            <div style={{ height: '180px', background: '#f8f9fa', borderRadius: '4px', padding: '0.75rem', position: 'relative' }}>
              <div style={{ 
                position: 'absolute', 
                top: '50%', 
                left: '0', 
                right: '0', 
                height: '1px', 
                background: '#e9ecef',
                transform: 'translateY(-50%)'
              }} />
              <div style={{ 
                display: 'flex', 
                alignItems: 'flex-end', 
                height: '100%', 
                gap: '1px',
                padding: '0.25rem 0'
              }}>
                {priceHistory.slice(-40).map((point, index) => {
                  const heightPercent = priceRange.range > 0 
                    ? ((point.price - priceRange.min) / priceRange.range) * 85 + 8
                    : 50
                  return (
                    <div
                      key={index}
                      style={{
                        flex: 1,
                        height: `${heightPercent}%`,
                        background: point.price >= selectedStock.price ? '#0a7a47' : '#c0392b',
                        borderRadius: '1px',
                        opacity: 0.9
                      }}
                    />
                  )
                })}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '11px', color: '#7a7a7a' }}>
              <span>40 Day History</span>
              <span>Next Open: {nextOpen}</span>
            </div>
          </article>

          {/* Alpha Predictions */}
          <article style={{ 
            background: alphaData?.signal === 'STRONG_BUY' ? 'linear-gradient(135deg, #e8f5e8, #f0f9f4)' : 
                       alphaData?.signal === 'BUY' ? '#f0f9f4' : 
                       alphaData?.signal === 'SELL' ? '#fff5f5' : '#f8f9fa',
            borderRadius: '8px', 
            padding: '1rem', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)' 
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px', fontWeight: 600 }}>Alpha Engine</h3>
            {alphaData && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '12px' }}>
                <div>
                  <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Signal</div>
                  <div style={{ 
                    fontWeight: 700,
                    color: alphaData.signal === 'STRONG_BUY' ? '#0a7a47' : 
                           alphaData.signal === 'BUY' ? '#2d7a2d' : 
                           alphaData.signal === 'SELL' ? '#c0392b' : '#666'
                  }}>
                    {alphaData.signal.replace('_', ' ')}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Confidence</div>
                  <div style={{ fontWeight: 600 }}>{alphaData.confidence}%</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Target</div>
                  <div style={{ fontWeight: 600 }}>${alphaData.target.toFixed(2)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Timeframe</div>
                  <div style={{ fontWeight: 600 }}>{alphaData.timeframe}</div>
                </div>
                <div style={{ 
                  gridColumn: '1 / -1', 
                  marginTop: '0.5rem', 
                  paddingTop: '0.5rem', 
                  borderTop: '1px solid rgba(0,0,0,0.1)',
                  fontSize: '11px',
                  lineHeight: '1.3'
                }}>
                  <div className="muted" style={{ marginBottom: '0.25rem' }}>Reasoning:</div>
                  <div>{alphaData.reasoning}</div>
                </div>
              </div>
            )}
          </article>
        </section>

        {/* Right Column - Order Form */}
        <section>
          <OrderForm
            selectedStock={selectedStock}
            orderType={orderType}
            setOrderType={setOrderType}
            orderAmount={orderAmount}
            setOrderAmount={setOrderAmount}
            orderQuantity={orderQuantity}
            setOrderQuantity={setOrderQuantity}
            fillType={fillType}
            setFillType={setFillType}
            limitPrice={limitPrice}
            setLimitPrice={setLimitPrice}
            stopPrice={stopPrice}
            setStopPrice={setStopPrice}
            orderDetails={orderDetails}
            bankBalance={bankBalance}
            onSubmit={handleProceedToConfirmation}
            submitLabel={`${orderType === 'BUY' ? 'Buy' : 'Sell'} ${selectedStock.symbol}`}
            onCancel={() => navigate('/portfolio')}
            mode="STOCK"
          />
          
          {/* Order Summary */}
          <article style={{ 
            background: 'white', 
            borderRadius: '8px', 
            padding: '1rem', 
            marginTop: '1rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)' 
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px', fontWeight: 600 }}>Order Summary</h3>
            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Estimated {orderType === 'BUY' ? 'Cost' : 'Proceeds'}:</span>
                <span style={{ fontWeight: 600 }}>
                  ${orderDetails.estimatedValue.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Commission:</span>
                <span style={{ fontWeight: 600 }}>${orderDetails.commission.toFixed(2)}</span>
              </div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                paddingTop: '0.5rem',
                borderTop: '1px solid #e9ecef',
                fontWeight: 700
              }}>
                <span>Total:</span>
                <span style={{ color: orderType === 'BUY' ? '#c0392b' : '#0a7a47' }}>
                  ${(orderDetails.estimatedValue + orderDetails.commission).toFixed(2)}
                </span>
              </div>
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
