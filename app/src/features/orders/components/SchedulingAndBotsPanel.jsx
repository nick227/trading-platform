import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DateTimePicker from '../../../components/DateTimePicker.jsx'
import executionsService from '../../../api/services/executionsService.js'
import { getBotCatalog } from '../../../api/services/botCatalogService.js'

export default function SchedulingAndBotsPanel({ selectedStock }) {
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledDateTime, setScheduledDateTime] = useState(null)
  const [botEnabled, setBotEnabled] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [botTemplates, setBotTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const navigate = useNavigate()

  // Load bot templates on mount
  useEffect(() => {
    const loadTemplates = async () => {
      setTemplatesLoading(true)
      try {
        const catalog = await getBotCatalog()
        setBotTemplates(catalog.ruleBased || [])
      } catch (err) {
        console.error('Failed to load bot templates:', err)
      } finally {
        setTemplatesLoading(false)
      }
    }
    loadTemplates()
  }, [])

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
    
    // Navigate to order confirmation screen with order details
    navigate('/orders/confirm', { state: { order: orderData } })
  }

  const handleCreateBot = () => {
    if (!selectedStock || !botEnabled || !selectedTemplate) return
    
    const botData = {
      id: Date.now(),
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name,
      templateDescription: selectedTemplate.description,
      ticker: selectedStock.symbol,
      assetName: selectedStock.name,
      price: selectedStock.price,
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    
    // Navigate to order confirmation screen with bot details
    navigate('/orders/confirm', { state: { order: null, bot: botData } })
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
            {templatesLoading ? (
              <div className="text-xs muted">Loading bot templates...</div>
            ) : botTemplates.length === 0 ? (
              <div className="text-xs muted">No bot templates available</div>
            ) : (
              <>
                <div className="text-xs muted mb-2">Select a Bot Template</div>
                <div className="stack-sm">
                  {botTemplates.map((template) => (
                    <div key={template.id} className="hstack">
                      <input
                        type="radio"
                        id={`template-${template.id}`}
                        name="bot-template"
                        value={template.id}
                        checked={selectedTemplate?.id === template.id}
                        onChange={() => setSelectedTemplate(template)}
                      />
                      <label htmlFor={`template-${template.id}`} className="flex-1">
                        <div className="font-600">{template.name}</div>
                        <div className="text-xs muted">{template.description}</div>
                      </label>
                    </div>
                  ))}
                </div>

                {selectedTemplate && (
                  <button className="btn btn-sm btn-ghost btn-block" onClick={handleCreateBot}>
                    Create {selectedTemplate.name} Bot for {selectedStock?.symbol}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      
    </article>
  )
}
