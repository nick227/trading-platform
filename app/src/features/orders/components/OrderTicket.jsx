import { useState, useMemo } from 'react'
import { calculateOrderPreview } from '../../../utils/orderPreview.js'
import DateTimePicker from '../../../components/DateTimePicker.jsx'
import { usePendingOrders } from '../../../hooks/usePendingOrders.js'
import { isMarketClosed } from '../../../utils/market.js'

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
  const [orderType, setOrderType] = useState('BUY')
  const [fillType, setFillType] = useState('MARKET')
  const [orderAmount, setOrderAmount] = useState('')
  const [orderQuantity, setOrderQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState(null)

  const { pendingOrders } = usePendingOrders({ enabled: true, pollIntervalMs: 10000 })

  const quantityNum = Number(orderQuantity)
  const hasMeaningfulInput = Number.isFinite(quantityNum) && quantityNum > 0

  const currentShares = bootstrapData?.userOwnership?.currentShares ?? 0

  const preview = useMemo(
    () =>
      calculateOrderPreview({
        orderType,
        quantity: orderQuantity,
        amount: orderAmount,
        price: selectedStock?.price ?? 0,
        bankBalance: bankBalance ?? 0,
        currentShares,
        pendingOrders,
      }),
    [orderType, orderQuantity, orderAmount, selectedStock?.price, bankBalance, currentShares, pendingOrders]
  )

  const handleSubmit = () => {
    if (!selectedStock || !preview) return
    if (scheduleForLater && !scheduledDateTime) return

    onSubmit({
      id: Date.now(),
      type: orderType,
      asset: selectedStock.symbol,
      assetName: selectedStock.name,
      quantity: preview.quantity,
      amount: preview.totalValue,
      price: selectedStock.price,
      fillType,
      limitPrice: fillType === 'LIMIT' ? parseFloat(limitPrice) || null : null,
      stopPrice: fillType === 'STOP' ? parseFloat(stopPrice) || null : null,
      timestamp: new Date().toISOString(),
      scheduledFor: scheduleForLater ? scheduledDateTime : null,
    })
  }

  const marketIsClosed = isMarketClosed()
  const canSubmit = Boolean(
    preview?.canAfford &&
      hasMeaningfulInput &&
      (!scheduleForLater || scheduledDateTime) &&
      !marketIsClosed
  )
  const showInsufficientWarning = Boolean(hasMeaningfulInput && preview?.canAfford === false)

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Place Order</h3>
      </div>

      {!selectedStock ? (
        <div className="panel-empty">Select a stock to place an order</div>
      ) : (
        <div className="stack-md">
          <div className="stack-sm">
            <div className="text-xs font-600 muted">Order Type</div>
            <div className="l-grid-2">
              {['BUY', 'SELL'].map((side) => (
                <button
                  key={side}
                  className={`btn btn-sm btn-block ${orderType === side ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setOrderType(side)}
                  type="button"
                >
                  {side === 'BUY' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>

          <div className="stack-sm">
            <div className="text-xs font-600 muted">Fill Type</div>
            <div className="l-grid-3fixed">
              {['MARKET', 'LIMIT', 'STOP'].map((type) => (
                <button
                  key={type}
                  className={`btn btn-xs btn-block ${fillType === type ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFillType(type)}
                  type="button"
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {fillType === 'LIMIT' && (
            <div className="field">
              <label className="field-label" htmlFor="limit-price">
                Limit Price
              </label>
              <input
                id="limit-price"
                className="field-input"
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={`$${selectedStock.price?.toFixed(2) ?? '0.00'}`}
              />
            </div>
          )}

          {fillType === 'STOP' && (
            <div className="field">
              <label className="field-label" htmlFor="stop-price">
                Stop Price
              </label>
              <input
                id="stop-price"
                className="field-input"
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder={`$${selectedStock.price?.toFixed(2) ?? '0.00'}`}
              />
            </div>
          )}

          <div className="stack-sm">
            <div className="text-xs font-600 muted">
              {orderType === 'BUY' ? 'Number of Shares to Buy' : 'Number of Shares to Sell'}
            </div>
            <div className="l-grid-2">
              <input
                className="field-input"
                type="number"
                value={orderQuantity}
                onChange={(e) => {
                  setOrderQuantity(e.target.value)
                  setOrderAmount('')
                }}
                placeholder="0 shares"
                min={0}
              />
              <div className="subcard subcard-sm text-center text-xs muted">
                {orderType === 'BUY'
                  ? `Max: ${preview?.maxQuantity ?? '—'} shares`
                  : `Available: ${preview?.maxQuantity ?? 0} shares`}
              </div>
            </div>
          </div>

          <div className="stack-sm">
            <div className="hstack">
              <input
                type="checkbox"
                id="schedule-later"
                checked={scheduleForLater}
                onChange={(e) => setScheduleForLater(e.target.checked)}
              />
              <label className="text-xs font-600 muted" htmlFor="schedule-later">
                Schedule for later
              </label>
            </div>
            {scheduleForLater && (
              <div className="stack-sm">
                <div className="text-xs muted">Execution Time (ET)</div>
                <DateTimePicker
                  value={scheduledDateTime}
                  onChange={setScheduledDateTime}
                  minDate={new Date()}
                  disabled={!scheduleForLater}
                />
                <div className="text-xs muted">Orders execute during market hours (9:30 AM – 4:00 PM ET)</div>
              </div>
            )}
          </div>

          <div className="subcard">
            <div className="stack-sm">
              <div className="l-row text-sm">
                <span className="muted">Est. {orderType === 'BUY' ? 'Cost' : 'Proceeds'}:</span>
                <span className="font-600">${(preview?.totalValue ?? 0).toFixed(2)}</span>
              </div>

              {orderType === 'BUY' && preview?.pendingBuyValue > 0 && (
                <div className="l-row text-xs">
                  <span className="muted">Pending Orders:</span>
                  <span className="text-warning font-600">-${preview.pendingBuyValue.toFixed(2)}</span>
                </div>
              )}

              <div className="l-row text-sm">
                <span className="muted">
                  {orderType === 'BUY' && preview?.pendingBuyValue > 0 ? 'Effective Balance After:' : 'Balance After:'}
                </span>
                <span className={`${preview?.canAfford !== false ? 'text-positive' : 'text-negative'} font-600`}>
                  ${(preview?.afterBalance ?? bankBalance).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {showInsufficientWarning && (
            <div className="alert alert-error">
              {orderType === 'BUY' ? 'Insufficient funds for this order' : 'Insufficient shares for this sale'}
            </div>
          )}

          {marketIsClosed && (
            <div className="alert alert-warn">
              <div className="alert-title">Market currently closed</div>
              <div className="text-sm">
                Immediate orders are only available during market hours (9:30 AM – 4:00 PM ET). Use the “Trading
                Options” panel below to schedule this order for later.
              </div>
            </div>
          )}

          <button className="btn btn-sm btn-primary btn-block" onClick={handleSubmit} disabled={!canSubmit} type="button">
            Review {orderType === 'BUY' ? 'Buy' : 'Sell'} Order
          </button>
        </div>
      )}
    </article>
  )
}

