import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DateTimePicker from '../../../components/DateTimePicker.jsx'
import executionsService from '../../../api/services/executionsService.js'

export default function SchedulingAndBotsPanel({ selectedStock, brokerConnected = true }) {
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState(null)
  const navigate = useNavigate()


  const handleScheduleTrade = () => {
    if (!selectedStock || !scheduleForLater || !scheduledDateTime || !brokerConnected) return
    
    // Convert scheduled datetime to UTC for server processing
    const scheduledDate = new Date(scheduledDateTime)
    const scheduledUTC = scheduledDate.toISOString()
    
    const orderData = {
      id: Date.now(),
      type: 'BUY',
      asset: selectedStock.symbol,
      assetName: selectedStock.name,
      quantity: 1, // Default to 1 share, user can modify
      amount: selectedStock.price,
      price: selectedStock.price,
      fillType: 'MARKET',
      timestamp: new Date().toISOString(),
      scheduledFor: scheduledUTC, // Store in UTC
      scheduledForLocal: scheduledDateTime, // Keep local for display
    }
    
    // Navigate to order confirmation screen with order details
    navigate('/orders/confirm', { state: { order: orderData } })
  }


  const isMarketClosed = () => {
    const now = new Date()
    const day = now.getDay()
    const hours = now.getHours()
    const minutes = now.getMinutes()
    
    // Weekend
    if (day === 0 || day === 6) return true
    
    // Before 9:30 AM ET or after 4:00 PM ET (convert to local time)
    const etHours = (hours - 5 + 24) % 24 // Simplified ET conversion
    return etHours < 9 || etHours > 16 || (etHours === 9 && minutes < 30) || (etHours === 16 && minutes > 0)
  }

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Trading Options</h3>
      </div>

      {!brokerConnected && (
        <div className="alert alert-error mb-4">
          Connect your Alpaca credentials in Profile → Broker to schedule trades or create bots.
        </div>
      )}

      {/* Scheduling Section */}
      <div className="stack-md mb-5">
        <div className="hstack">
          <input
            type="checkbox"
            id="schedule-later-panel"
            checked={scheduleForLater}
            onChange={(e) => setScheduleForLater(e.target.checked)}
          />
          <label className="font-600" htmlFor="schedule-later-panel">
            Schedule Trade for Later
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
            <div className="text-xs muted">
              Orders execute during market hours (9:30 AM – 4:00 PM ET)
            </div>

            {scheduledDateTime && (
              <button className="btn btn-sm btn-primary btn-block" onClick={handleScheduleTrade} disabled={!brokerConnected}>
                Schedule {selectedStock?.symbol} Trade
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bots are created in one place: /bots/new (prefilled with this symbol). */}
      <div className="stack-sm">
        <div className="font-600">Automate this symbol</div>
        <div className="text-xs muted">Set up a paper-trading bot that trades {selectedStock?.symbol ?? 'this symbol'}.</div>
        <Link
          className="btn btn-sm btn-ghost btn-block"
          to={selectedStock?.symbol ? `/bots/new?ticker=${encodeURIComponent(selectedStock.symbol)}` : '/bots/new'}
        >
          Create a bot
        </Link>
      </div>
      
    </article>
  )
}
