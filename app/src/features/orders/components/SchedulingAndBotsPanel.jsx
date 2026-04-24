import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DateTimePicker from '../../../components/DateTimePicker.jsx'
import executionsService from '../../../api/services/executionsService.js'

export default function SchedulingAndBotsPanel({ selectedStock }) {
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState(null)
  const [botEnabled, setBotEnabled] = useState(false)
  const [botCondition, setBotCondition] = useState('price_above')
  const [botPrice, setBotPrice] = useState('')
  const navigate = useNavigate()

  const handleScheduleTrade = () => {
    if (!selectedStock || !scheduleForLater || !scheduledDateTime) return
    
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
    
    // Create the scheduled order directly (no confirmation needed for scheduling)
    executionsService.create({
      portfolioId: 'default', // This should come from user context
      ticker: selectedStock.symbol,
      side: 'BUY',
      quantity: 1,
      price: selectedStock.price,
      scheduledFor: scheduledUTC,
    }).then(() => {
      // Navigate to orders page to show the queued order
      navigate('/orders')
    }).catch(err => {
      console.error('Failed to schedule order:', err)
    })
  }

  const handleCreateBot = () => {
    if (!selectedStock || !botEnabled || !botPrice) return
    
    const botData = {
      id: Date.now(),
      name: `${selectedStock.symbol} ${botCondition} ${botPrice}`,
      ticker: selectedStock.symbol,
      condition: botCondition,
      price: parseFloat(botPrice),
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    
    // Navigate to bot creation/confirmation
    navigate('/bots/create', { state: { bot: botData } })
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
              <button className="btn btn-sm btn-primary btn-block" onClick={handleScheduleTrade}>
                Schedule {selectedStock?.symbol} Trade
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bot Trading Section */}
      <div className="stack-md">
        <div className="hstack">
          <input
            type="checkbox"
            id="bot-enabled"
            checked={botEnabled}
            onChange={(e) => setBotEnabled(e.target.checked)}
          />
          <label className="font-600" htmlFor="bot-enabled">
            Create Trading Bot
          </label>
        </div>

        {botEnabled && (
          <div className="stack-sm">
            <div className="field">
              <label className="field-label" htmlFor="bot-condition">
                Condition
              </label>
              <select
                id="bot-condition"
                className="field-select"
                value={botCondition}
                onChange={(e) => setBotCondition(e.target.value)}
              >
                <option value="price_above">Price Above</option>
                <option value="price_below">Price Below</option>
                <option value="percent_change">Percent Change</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="bot-price">
                {botCondition === 'price_above'
                  ? 'Price Above'
                  : botCondition === 'price_below'
                    ? 'Price Below'
                    : 'Percent Change'}
              </label>
              <input
                id="bot-price"
                className="field-input"
                type="number"
                value={botPrice}
                onChange={(e) => setBotPrice(e.target.value)}
                placeholder={`$${selectedStock?.price?.toFixed(2) ?? '0.00'}`}
              />
            </div>

            {botPrice && (
              <button className="btn btn-sm btn-ghost btn-block" onClick={handleCreateBot}>
                Create {selectedStock?.symbol} Bot
              </button>
            )}
          </div>
        )}
      </div>
      
    </article>
  )
}
