import { useState, useMemo } from 'react'
import { calculateOrderPreview } from '../../../utils/orderPreview.js'

const INPUT_STYLE = {
  width: '100%', padding: '0.75rem',
  border: '1px solid #e9ecef', borderRadius: '8px', fontSize: '14px',
}

/**
 * OrderTicket — self-contained order entry form.
 * Manages form state internally and calls onSubmit(orderData) on confirm.
 *
 * Props:
 *   selectedStock  — { symbol, name, price }
 *   bankBalance    — number
 *   onSubmit       — (orderData) => void
 *   bootstrapData  — optional bootstrap payload (currently unused; available for extensions)
 */
export default function OrderTicket({ selectedStock, bankBalance, onSubmit, bootstrapData }) {
  const [orderType,     setOrderType]     = useState('BUY')
  const [fillType,      setFillType]      = useState('MARKET')
  const [orderAmount,   setOrderAmount]   = useState('')
  const [orderQuantity, setOrderQuantity] = useState('')
  const [limitPrice,    setLimitPrice]    = useState('')
  const [stopPrice,     setStopPrice]     = useState('')

  const preview = useMemo(() => calculateOrderPreview({
    orderType,
    quantity:    orderQuantity,
    amount:      orderAmount,
    price:       selectedStock?.price ?? 0,
    bankBalance: bankBalance ?? 0,
  }), [orderType, orderQuantity, orderAmount, selectedStock?.price, bankBalance])

  const handleSubmit = () => {
    if (!selectedStock || !preview) return
    onSubmit({
      id:        Date.now(),
      type:      orderType,
      asset:     selectedStock.symbol,
      assetName: selectedStock.name,
      quantity:  preview.quantity,
      amount:    preview.totalValue,
      price:     selectedStock.price,
      fillType,
      limitPrice: fillType === 'LIMIT' ? parseFloat(limitPrice) || null : null,
      stopPrice:  fillType === 'STOP'  ? parseFloat(stopPrice)  || null : null,
      timestamp:  new Date().toISOString(),
    })
  }

  const canSubmit = !!preview?.canAfford && (!!orderAmount || !!orderQuantity)

  return (
    <article style={{
      background: 'white', borderRadius: '8px', padding: '1rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '16px', fontWeight: 600 }}>Place Order</h3>

      {!selectedStock ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#666', fontSize: '13px' }}>
          Select a stock to place an order
        </div>
      ) : (
        <>
          {/* Buy / Sell toggle */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Order Type</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {['BUY', 'SELL'].map(side => (
                <button
                  key={side}
                  className={`pressable ${orderType === side ? 'primary' : 'ghost'}`}
                  onClick={() => setOrderType(side)}
                  style={{ padding: '0.75rem', fontWeight: 600 }}
                >
                  {side === 'BUY' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>

          {/* Fill type */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Fill Type</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {['MARKET', 'LIMIT', 'STOP'].map(type => (
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

          {/* Limit price input */}
          {fillType === 'LIMIT' && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Limit Price</div>
              <input
                type="number"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder={`$${selectedStock.price?.toFixed(2) ?? '0.00'}`}
                style={INPUT_STYLE}
              />
            </div>
          )}

          {/* Stop price input */}
          {fillType === 'STOP' && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Stop Price</div>
              <input
                type="number"
                value={stopPrice}
                onChange={e => setStopPrice(e.target.value)}
                placeholder={`$${selectedStock.price?.toFixed(2) ?? '0.00'}`}
                style={INPUT_STYLE}
              />
            </div>
          )}

          {/* Amount / Quantity */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              {orderType === 'BUY' ? 'Amount to Invest' : 'Quantity to Sell'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {orderType === 'BUY' ? (
                <input
                  type="number"
                  value={orderAmount}
                  onChange={e => { setOrderAmount(e.target.value); setOrderQuantity('') }}
                  placeholder="$0.00"
                  style={INPUT_STYLE}
                />
              ) : (
                <input
                  type="number"
                  value={orderQuantity}
                  onChange={e => { setOrderQuantity(e.target.value); setOrderAmount('') }}
                  placeholder="0 shares"
                  min={0}
                  style={INPUT_STYLE}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#7a7a7a' }}>
                {orderType === 'BUY'
                  ? `Max: ${preview?.maxQuantity ?? '—'} shares`
                  : 'Validated at broker'}
              </div>
            </div>
          </div>

          {/* Order summary */}
          <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '13px' }}>
              <span className="muted">Est. {orderType === 'BUY' ? 'Cost' : 'Proceeds'}:</span>
              <span style={{ fontWeight: 600 }}>${(preview?.totalValue ?? 0).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span className="muted">Balance After:</span>
              <span style={{ fontWeight: 600, color: preview?.canAfford !== false ? '#0a7a47' : '#c0392b' }}>
                ${(preview?.afterBalance ?? bankBalance).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Insufficient funds warning */}
          {preview?.canAfford === false && (
            <div style={{
              background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: '8px',
              padding: '0.75rem', marginBottom: '1rem', color: '#c0392b', fontSize: '13px',
            }}>
              {orderType === 'BUY' ? 'Insufficient funds for this order' : 'Insufficient shares for this sale'}
            </div>
          )}

          {/* Actions */}
          <button
            className="primary pressable"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ width: '100%', padding: '0.875rem', fontWeight: 600, opacity: canSubmit ? 1 : 0.5 }}
          >
            Review {orderType === 'BUY' ? 'Buy' : 'Sell'} Order
          </button>
        </>
      )}
    </article>
  )
}
